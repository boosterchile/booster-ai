import { ArtefactoYaSubidoError, emitirCertificado } from '@booster-ai/certificate-generator';
import type { Logger } from '@booster-ai/logger';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripEvents, tripMetrics, trips } from '../db/schema.js';
import {
  VersionVigenteCambioError,
  crearVersionEnTx,
  obtenerVigente,
  siguienteVersion,
} from './certificados-versionados.js';
import { type EmitirCertificadoConfig, armarDatosEmision } from './emitir-certificado-viaje.js';

/**
 * Reemisión de un certificado emitido (`.specs/reemision-certificado/` §3).
 *
 * Corrige cómo se presenta un cálculo, no el cálculo: las emisiones impresas
 * no cambian. En este orden:
 *
 *   1. comprueba que la corrección corresponde al dato guardado y que el dato
 *      nuevo cuadra con el resto de la fila;
 *   2. genera el PDF con el dato corregido, en memoria;
 *   3. lo firma y lo sube a la ruta de su versión, sin tocar la anterior ni
 *      pisar un objeto que ya exista;
 *   4. en una transacción: corrige el dato con guarda sobre el valor
 *      anterior, registra la versión nueva (la anterior queda `reemplazado`)
 *      y deja el evento del viaje.
 *
 * Si 2 o 3 fallan, la base no cambia. Si la base cambió entre la lectura y
 * la transacción, la transacción se deshace y el PDF subido queda huérfano
 * en el bucket (spec §9); nunca una versión sin PDF.
 */

/**
 * Lista cerrada de motivos (spec §3.4). Vive en el generador, que imprime el
 * texto de cada uno; `ck_certificados_viaje_motivo` la repite en la base.
 */
export { MOTIVOS_REEMISION, type MotivoReemision } from '@booster-ai/certificate-generator';

/**
 * El factor de emisión guardado (y por lo tanto impreso) no es el que se usó
 * para calcular las emisiones (hallazgo del 2026-11-11, #926).
 */
export interface CorreccionFactor {
  readonly motivo: 'factor_impreso_no_corresponde';
  readonly factorAnterior: number;
  readonly factorNuevo: number;
}

export type CodigoNoReemitido =
  | 'config_missing'
  | 'trip_not_found'
  | 'trip_not_delivered'
  | 'certificate_not_issued'
  | 'sin_version_vigente'
  | 'vigente_inconsistente'
  | 'correccion_no_corresponde'
  | 'correccion_no_explica_cifra'
  | 'datos_insuficientes'
  | 'no_shipper';

export type ResultadoReemision =
  | {
      readonly ok: true;
      readonly version: number;
      readonly certificadoId: string;
      readonly sha256Anterior: string;
      readonly sha256Nuevo: string;
      readonly pdfUri: string;
    }
  | { readonly ok: false; readonly code: CodigoNoReemitido; readonly detalle?: string };

/** La base cambió mientras se generaba el PDF: no se registró nada. */
export class ReemisionConcurrenteError extends Error {}

/** `metricas_viaje.factor_emision_usado` es numeric(8,5). */
const ESCALA_FACTOR = 100_000;
const comoFactor = (n: number) => Math.round(n * ESCALA_FACTOR) / ESCALA_FACTOR;
const textoFactor = (n: number) => comoFactor(n).toFixed(5);

/**
 * ¿El factor explica la cifra impresa? Los litros se guardan con 2 decimales
 * y las emisiones con 3: la diferencia tolerada es la que deja ese redondeo.
 */
function explicaLaCifra(litros: number, emisionesKg: number, factor: number): boolean {
  const tolerancia = 0.005 * factor + 0.0005;
  return Math.abs(litros * factor - emisionesKg) <= tolerancia;
}

const numOrNull = (v: string | null): number | null => {
  if (v === null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function reemitirCertificado(opts: {
  readonly db: Db;
  readonly logger: Logger;
  readonly tripId: string;
  readonly correccion: CorreccionFactor;
  readonly solicitadoPorUserId: string | null;
  readonly config: Partial<EmitirCertificadoConfig>;
}): Promise<ResultadoReemision> {
  const { db, logger, tripId, correccion, solicitadoPorUserId, config } = opts;
  const noReemitido = (code: CodigoNoReemitido, detalle?: string): ResultadoReemision => {
    logger.warn({ tripId, code, detalle }, 'reemisión de certificado no realizada');
    return { ok: false, code, ...(detalle ? { detalle } : {}) };
  };

  if (!config.kmsKeyId || !config.certificatesBucket || !config.verifyBaseUrl) {
    return noReemitido('config_missing');
  }

  // rls-allowlist: reemisión de plataforma scoped por tripId (job manual del PO)
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) {
    return noReemitido('trip_not_found');
  }
  if (trip.status !== 'entregado') {
    return noReemitido('trip_not_delivered');
  }
  // rls-allowlist: métricas del viaje ya leído por tripId
  const [metrics] = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  if (!metrics?.certificateIssuedAt || !metrics.certificateSha256) {
    return noReemitido('certificate_not_issued');
  }

  const vigente = await obtenerVigente(db, tripId);
  if (!vigente) {
    return noReemitido('sin_version_vigente');
  }
  if (vigente.id !== metrics.certificadoVigenteId || vigente.sha256 !== metrics.certificateSha256) {
    return noReemitido(
      'vigente_inconsistente',
      'la versión vigente no es la que espejan las métricas del viaje',
    );
  }

  // (1) La corrección corresponde al dato guardado y lo explica.
  const factorGuardado = numOrNull(metrics.emissionFactorUsed);
  if (
    factorGuardado === null ||
    comoFactor(factorGuardado) !== comoFactor(correccion.factorAnterior)
  ) {
    return noReemitido(
      'correccion_no_corresponde',
      `el factor guardado es ${metrics.emissionFactorUsed ?? 'nulo'}, no ${textoFactor(correccion.factorAnterior)}`,
    );
  }
  if (comoFactor(correccion.factorNuevo) === comoFactor(correccion.factorAnterior)) {
    return noReemitido('correccion_no_corresponde', 'el factor nuevo es igual al anterior');
  }
  const litros =
    numOrNull(metrics.fuelConsumedLActual) ?? numOrNull(metrics.fuelConsumedLEstimated);
  const emisiones =
    numOrNull(metrics.carbonEmissionsKgco2eActual) ??
    numOrNull(metrics.carbonEmissionsKgco2eEstimated);
  if (litros === null || emisiones === null) {
    return noReemitido('datos_insuficientes', 'faltan litros o emisiones para comprobar el factor');
  }
  if (!explicaLaCifra(litros, emisiones, correccion.factorNuevo)) {
    return noReemitido(
      'correccion_no_explica_cifra',
      `${litros} L × ${textoFactor(correccion.factorNuevo)} no da ${emisiones} kg CO₂e`,
    );
  }

  // (2) y (3) Generar, firmar y subir con el dato corregido, sin tocar la base.
  const factorNuevoTexto = textoFactor(correccion.factorNuevo);
  const armado = await armarDatosEmision({
    db,
    logger,
    trip,
    metrics: { ...metrics, emissionFactorUsed: factorNuevoTexto },
  });
  if (!armado.ok) {
    return noReemitido(armado.reason);
  }
  // El número sale de la mayor versión registrada, no de la vigente: después
  // de una reversa la vigente es la 1 pero la 2 ya tiene su PDF en el bucket.
  const versionNueva = await siguienteVersion(db, tripId);
  let result: Awaited<ReturnType<typeof emitirCertificado>>;
  try {
    result = await emitirCertificado({
      ...armado.datos,
      // El certificado dice a qué versión reemplaza, de cuándo y por qué
      // (spec §8-2). Reemplaza a la vigente, que tras una reversa puede no
      // ser la de número anterior.
      viaje: {
        ...armado.datos.viaje,
        version: {
          numero: versionNueva,
          reemplazaA: vigente.version,
          reemplazaEmitidoEn: vigente.emitidoEn,
          motivo: correccion.motivo,
        },
      },
      infra: { kmsKeyId: config.kmsKeyId, certificatesBucket: config.certificatesBucket },
      verifyBaseUrl: config.verifyBaseUrl,
      version: versionNueva,
    });
  } catch (err) {
    if (err instanceof ArtefactoYaSubidoError) {
      // Otra reemisión subió esa versión primero; la subida no la pisa.
      logger.error(
        { tripId, versionNueva, ruta: err.ruta },
        'reemisión no realizada: el PDF de esa versión ya estaba en el bucket',
      );
      throw new ReemisionConcurrenteError(err.message);
    }
    throw err;
  }

  // (4) Corregir, versionar y dejar el evento, todo o nada.
  try {
    const creada = await db.transaction(async (tx) => {
      // rls-allowlist: métricas del viaje ya leído por tripId; guarda sobre el factor anterior
      const corregidas = await tx
        .update(tripMetrics)
        .set({ emissionFactorUsed: factorNuevoTexto })
        .where(
          and(
            eq(tripMetrics.tripId, tripId),
            eq(tripMetrics.emissionFactorUsed, textoFactor(correccion.factorAnterior)),
            eq(tripMetrics.certificateSha256, vigente.sha256),
          ),
        )
        .returning({ tripId: tripMetrics.tripId });
      if (corregidas.length !== 1) {
        throw new ReemisionConcurrenteError(
          `las métricas del viaje ${tripId} cambiaron mientras se generaba el PDF`,
        );
      }
      const nueva = await crearVersionEnTx(
        tx,
        {
          tripId,
          sha256: result.pdfSha256,
          pdfUrl: result.pdfGcsUri,
          kmsVersion: result.kmsKeyVersion,
          emitidoEn: result.issuedAt,
          fuenteDistancia: metrics.fuenteDistancia,
          motivoFallback: metrics.motivoFallback,
          decisionVersion: metrics.decisionVersion,
        },
        correccion.motivo,
        vigente.id,
      );
      if (nueva.version !== versionNueva) {
        throw new ReemisionConcurrenteError(
          `la versión registrada (${nueva.version}) no es la del PDF subido (${versionNueva})`,
        );
      }
      await tx.insert(tripEvents).values({
        tripId,
        eventType: 'certificado_reemitido',
        source: 'sistema',
        recordedByUserId: solicitadoPorUserId,
        payload: {
          motivo: correccion.motivo,
          version_anterior: vigente.version,
          version_nueva: nueva.version,
          sha256_anterior: vigente.sha256,
          sha256_nuevo: result.pdfSha256,
          pdf_uri: result.pdfGcsUri,
          correccion: {
            factor_emision_usado: {
              anterior: comoFactor(correccion.factorAnterior),
              nuevo: comoFactor(correccion.factorNuevo),
            },
          },
        },
      });
      return nueva;
    });

    logger.info(
      {
        tripId,
        motivo: correccion.motivo,
        versionAnterior: vigente.version,
        versionNueva: creada.version,
        pdfSha256: result.pdfSha256,
      },
      'certificado reemitido',
    );
    return {
      ok: true,
      version: creada.version,
      certificadoId: creada.id,
      sha256Anterior: vigente.sha256,
      sha256Nuevo: result.pdfSha256,
      pdfUri: result.pdfGcsUri,
    };
  } catch (err) {
    const concurrente =
      err instanceof ReemisionConcurrenteError || err instanceof VersionVigenteCambioError;
    if (concurrente) {
      logger.error(
        { tripId, pdfHuerfano: result.pdfGcsUri },
        'reemisión deshecha: la base cambió; el PDF subido queda huérfano en el bucket',
      );
      throw err instanceof ReemisionConcurrenteError
        ? err
        : new ReemisionConcurrenteError(err.message);
    }
    throw err;
  }
}
