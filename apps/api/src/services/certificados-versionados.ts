/**
 * HC-001 p3a (decision.md 14:10): versiones del certificado de un viaje.
 *
 * `certificados_viaje` guarda el historial y `metricas_viaje.certificado_vigente_id`
 * apunta a la vigente. Las 4 columnas `certificado_*` de metricas_viaje se
 * espejan con la vigente en la misma transacción, así los lectores actuales
 * (listado de certificados, assignments, trip-requests-v2) no cambian.
 * Sin notificaciones: si el cliente ve el reemplazo lo decide Felipe (punto 4).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { certificadosViaje, tripMetrics } from '../db/schema.js';

export type CertificadoViaje = typeof certificadosViaje.$inferSelect;

export interface NuevaVersionCertificado {
  tripId: string;
  sha256: string;
  pdfUrl: string | null;
  kmsVersion: string | null;
  emitidoEn: Date;
  fuenteDistancia: string | null;
  motivoFallback: string | null;
  decisionVersion: number | null;
}

type Consulta = Pick<Db, 'select'>;

const vigenteDe = (q: Consulta, tripId: string) =>
  q
    .select()
    .from(certificadosViaje)
    .where(and(eq(certificadosViaje.tripId, tripId), eq(certificadosViaje.estado, 'vigente')))
    .limit(1);

const espejo = (c: CertificadoViaje) => ({
  certificadoVigenteId: c.id,
  certificatePdfUrl: c.pdfUrl,
  certificateSha256: c.sha256,
  certificateKmsKeyVersion: c.kmsVersion,
  certificateIssuedAt: c.emitidoEn,
});

export async function obtenerVigente(
  db: Consulta,
  tripId: string,
): Promise<CertificadoViaje | null> {
  const [vigente] = await vigenteDe(db, tripId);
  return vigente ?? null;
}

/**
 * Crea la versión siguiente: la vigente pasa a 'reemplazado' (con fecha y
 * puntero a la nueva) y metricas_viaje apunta a la nueva. Todo o nada.
 */
export async function crearVersion(
  db: Db,
  nueva: NuevaVersionCertificado,
): Promise<CertificadoViaje> {
  return db.transaction(async (tx) => {
    const [anterior] = await vigenteDe(tx, nueva.tripId).for('update');
    if (!anterior) {
      throw new Error(`crearVersion: el viaje ${nueva.tripId} no tiene versión vigente`);
    }
    const [maxima] = await tx
      .select({ v: sql<number>`max(${certificadosViaje.version})::int` })
      .from(certificadosViaje)
      .where(eq(certificadosViaje.tripId, nueva.tripId));
    await tx
      .update(certificadosViaje)
      .set({ estado: 'reemplazado', reemplazadoEn: new Date() })
      .where(eq(certificadosViaje.id, anterior.id));
    const [creada] = await tx
      .insert(certificadosViaje)
      .values({ ...nueva, version: (maxima?.v ?? anterior.version) + 1, estado: 'vigente' })
      .returning();
    if (!creada) {
      throw new Error('crearVersion: el INSERT no devolvió fila');
    }
    await tx
      .update(certificadosViaje)
      .set({ reemplazadoPor: creada.id })
      .where(eq(certificadosViaje.id, anterior.id));
    await tx.update(tripMetrics).set(espejo(creada)).where(eq(tripMetrics.tripId, nueva.tripId));
    return creada;
  });
}

/**
 * Reversa (decision.md 14:10 punto 5): la vigente pasa a 'revertido' y la que
 * reemplazó vuelve a ser vigente. No borra filas ni el PDF de la revertida.
 */
export async function revertirVersion(db: Db, tripId: string): Promise<CertificadoViaje> {
  return db.transaction(async (tx) => {
    const [actual] = await vigenteDe(tx, tripId).for('update');
    if (!actual) {
      throw new Error(`revertirVersion: el viaje ${tripId} no tiene versión vigente`);
    }
    const [anterior] = await tx
      .select()
      .from(certificadosViaje)
      .where(
        and(
          eq(certificadosViaje.reemplazadoPor, actual.id),
          eq(certificadosViaje.estado, 'reemplazado'),
        ),
      )
      .limit(1)
      .for('update');
    if (!anterior) {
      throw new Error(`revertirVersion: la v${actual.version} no reemplazó a ninguna versión`);
    }
    await tx
      .update(certificadosViaje)
      .set({ estado: 'revertido' })
      .where(eq(certificadosViaje.id, actual.id));
    const [vuelta] = await tx
      .update(certificadosViaje)
      .set({ estado: 'vigente', reemplazadoEn: null, reemplazadoPor: null })
      .where(eq(certificadosViaje.id, anterior.id))
      .returning();
    if (!vuelta) {
      throw new Error('revertirVersion: el UPDATE no devolvió fila');
    }
    await tx.update(tripMetrics).set(espejo(vuelta)).where(eq(tripMetrics.tripId, tripId));
    return vuelta;
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Registra la versión 1 de un certificado recién emitido
 * (`.specs/reemision-certificado/` §3.1). Va en la transacción de la emisión:
 * quien llama espeja después `metricas_viaje` con el id que devuelve.
 *
 * Si el viaje ya tiene una versión, falla por las restricciones de la tabla
 * (una versión 1 y una sola vigente por viaje) y la emisión no se registra.
 */
export async function registrarPrimeraVersion(
  tx: Tx,
  nueva: NuevaVersionCertificado,
): Promise<CertificadoViaje> {
  // rls-allowlist: versión del certificado de un viaje ya validado por la emisión (tripId)
  const [creada] = await tx
    .insert(certificadosViaje)
    .values({ ...nueva, version: 1, estado: 'vigente' })
    .returning();
  if (!creada) {
    throw new Error('registrarPrimeraVersion: el INSERT no devolvió fila');
  }
  return creada;
}
