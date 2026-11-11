import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { certificadosViaje, tripMetrics } from '../db/schema.js';
import { registrarPrimeraVersion } from './certificados-versionados.js';

/**
 * Relleno de la versión 1 de los certificados emitidos antes de que la
 * emisión versionara (`.specs/reemision-certificado/` parte 2).
 *
 * Por cada viaje con certificado emitido:
 * - sin ninguna versión: crea la versión 1 copiando las columnas
 *   `certificado_*` de `metricas_viaje` y deja las métricas apuntando a ella;
 * - con versión vigente que coincide con las métricas y sin puntero: enlaza;
 * - con versión vigente que no coincide con las métricas: no toca nada y lo
 *   informa (las métricas espejan la vigente; si difieren, alguien escribió
 *   a mano y hay que mirarlo);
 * - sin huella del PDF: no hay qué versionar; lo informa.
 *
 * No toca las columnas `certificado_*` ni ningún PDF. Todo en una
 * transacción; en seco se deshace al final. Idempotente.
 */

export interface ResultadoRellenoVersiones {
  readonly dryRun: boolean;
  /** Viajes con certificado emitido. */
  readonly revisados: number;
  readonly creadas: { tripId: string; certificadoId: string }[];
  /** Tenían versión vigente y las métricas no apuntaban a ella. */
  readonly enlazadas: { tripId: string; certificadoId: string }[];
  readonly sinCambios: number;
  readonly omitidas: { tripId: string; motivo: string }[];
}

/** La verificación final encontró algo que el relleno no debió dejar. */
export class VerificacionVersionesError extends Error {}

class Deshacer extends Error {}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Criterio 2 de la spec: fuera de las omitidas, ningún certificado emitido
 * queda sin versión vigente apuntada por sus métricas. Si no, se deshace todo.
 */
async function verificar(tx: Tx, omitidos: ReadonlySet<string>): Promise<void> {
  // rls-allowlist: verificación de plataforma sobre todos los certificados emitidos (job manual)
  const sueltos = await tx
    .select({ tripId: tripMetrics.tripId })
    .from(tripMetrics)
    .where(
      and(isNotNull(tripMetrics.certificateIssuedAt), isNull(tripMetrics.certificadoVigenteId)),
    );
  const faltan = sueltos.filter((s) => !omitidos.has(s.tripId));
  if (faltan.length > 0) {
    throw new VerificacionVersionesError(
      `verificación fallida: ${faltan.length} certificados emitidos sin versión vigente; no se escribió nada`,
    );
  }
}

export async function rellenarVersionesCertificado(
  db: Db,
  opts: { dryRun: boolean },
): Promise<ResultadoRellenoVersiones> {
  const creadas: ResultadoRellenoVersiones['creadas'] = [];
  const enlazadas: ResultadoRellenoVersiones['enlazadas'] = [];
  const omitidas: ResultadoRellenoVersiones['omitidas'] = [];
  let sinCambios = 0;
  let revisados = 0;

  try {
    await db.transaction(async (tx) => {
      // rls-allowlist: relleno de plataforma sobre todos los certificados emitidos (job manual, reemision-certificado parte 2)
      const emitidos = await tx
        .select({
          tripId: tripMetrics.tripId,
          sha256: tripMetrics.certificateSha256,
          pdfUrl: tripMetrics.certificatePdfUrl,
          kmsVersion: tripMetrics.certificateKmsKeyVersion,
          emitidoEn: tripMetrics.certificateIssuedAt,
          vigenteId: tripMetrics.certificadoVigenteId,
          fuenteDistancia: tripMetrics.fuenteDistancia,
          motivoFallback: tripMetrics.motivoFallback,
          decisionVersion: tripMetrics.decisionVersion,
        })
        .from(tripMetrics)
        .where(isNotNull(tripMetrics.certificateIssuedAt))
        .orderBy(asc(tripMetrics.certificateIssuedAt), asc(tripMetrics.tripId))
        .for('update');
      revisados = emitidos.length;

      for (const e of emitidos) {
        if (!e.sha256 || !e.emitidoEn) {
          omitidas.push({ tripId: e.tripId, motivo: 'certificado emitido sin huella del PDF' });
          continue;
        }
        // rls-allowlist: versiones del certificado del viaje en revisión (tripId)
        const versiones = await tx
          .select({
            id: certificadosViaje.id,
            estado: certificadosViaje.estado,
            sha256: certificadosViaje.sha256,
          })
          .from(certificadosViaje)
          .where(eq(certificadosViaje.tripId, e.tripId))
          .for('update');

        if (versiones.length === 0) {
          const creada = await registrarPrimeraVersion(tx, {
            tripId: e.tripId,
            sha256: e.sha256,
            pdfUrl: e.pdfUrl,
            kmsVersion: e.kmsVersion,
            emitidoEn: e.emitidoEn,
            fuenteDistancia: e.fuenteDistancia,
            motivoFallback: e.motivoFallback,
            decisionVersion: e.decisionVersion,
          });
          // rls-allowlist: métricas del viaje en revisión, tomadas con FOR UPDATE
          await tx
            .update(tripMetrics)
            .set({ certificadoVigenteId: creada.id })
            .where(eq(tripMetrics.tripId, e.tripId));
          creadas.push({ tripId: e.tripId, certificadoId: creada.id });
          continue;
        }

        const vigente = versiones.find((v) => v.estado === 'vigente');
        if (!vigente) {
          omitidas.push({ tripId: e.tripId, motivo: 'tiene versiones pero ninguna vigente' });
          continue;
        }
        if (vigente.sha256 !== e.sha256) {
          omitidas.push({
            tripId: e.tripId,
            motivo: 'la versión vigente no coincide con el certificado de las métricas',
          });
          continue;
        }
        if (e.vigenteId === vigente.id) {
          sinCambios += 1;
          continue;
        }
        // rls-allowlist: métricas del viaje en revisión, tomadas con FOR UPDATE
        await tx
          .update(tripMetrics)
          .set({ certificadoVigenteId: vigente.id, updatedAt: sql`now()` })
          .where(eq(tripMetrics.tripId, e.tripId));
        enlazadas.push({ tripId: e.tripId, certificadoId: vigente.id });
      }

      await verificar(tx, new Set(omitidas.map((o) => o.tripId)));
      if (opts.dryRun) {
        throw new Deshacer();
      }
    });
  } catch (err) {
    if (!(err instanceof Deshacer)) {
      throw err;
    }
  }

  return { dryRun: opts.dryRun, revisados, creadas, enlazadas, sinCambios, omitidas };
}
