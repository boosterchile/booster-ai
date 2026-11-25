import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripMetrics, trips } from '../db/schema.js';

/**
 * Totales de certificados emitidos (`.specs/una-sola-verdad-por-dato`). Es la
 * única suma: la usan `GET /certificates` (la empresa generadora) y los
 * indicadores del panel (una empresa o toda la plataforma).
 *
 * - Un certificado es una fila de métricas con `certificado_emitido_en`.
 * - Su huella es la real si existe y, si no, la estimada: la misma regla
 *   del `kg_co2e` de cada fila de `GET /certificates`.
 * - «Medido» es el nivel `primario_verificable`; todo lo demás es «estimado»
 *   (decisión del PO del 2026-11-25 sobre el sello).
 */
export interface ResumenCertificados {
  certificados: number;
  medidos: number;
  estimados: number;
  kgco2e: number;
  ahorro_kgco2e: number;
}

export async function resumenCertificados(opts: {
  db: Db;
  /** Empresa generadora. Sin ella, toda la plataforma. */
  empresaId?: string | undefined;
}): Promise<ResumenCertificados> {
  const emitido = isNotNull(tripMetrics.certificateIssuedAt);
  // rls-allowlist: sin `empresaId` es el total de plataforma, que solo pide el panel de administración (requirePlatformAdmin).
  const filas = await opts.db
    .select({
      certificados: sql<string>`count(*)`,
      medidos: sql<string>`count(*) filter (where ${tripMetrics.certificationLevel} = 'primario_verificable')`,
      kgco2e: sql<
        string | null
      >`sum(coalesce(${tripMetrics.carbonEmissionsKgco2eActual}, ${tripMetrics.carbonEmissionsKgco2eEstimated}))`,
      ahorro: sql<string | null>`sum(${tripMetrics.ahorroCo2eVsSinMatchingKgco2e})`,
    })
    .from(tripMetrics)
    .innerJoin(trips, eq(trips.id, tripMetrics.tripId))
    .where(
      opts.empresaId ? and(eq(trips.generadorCargaEmpresaId, opts.empresaId), emitido) : emitido,
    );
  const fila = filas[0];
  const certificados = Number(fila?.certificados ?? 0);
  const medidos = Number(fila?.medidos ?? 0);
  return {
    certificados,
    medidos,
    estimados: certificados - medidos,
    kgco2e: Number(fila?.kgco2e ?? 0),
    ahorro_kgco2e: Number(fila?.ahorro ?? 0),
  };
}
