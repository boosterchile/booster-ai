import type { Presentacion } from '@booster-ai/certificate-generator';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripMetrics, trips } from '../db/schema.js';
import { presentacionDesdeMetricas } from './presentacion-huella.js';

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
 * - `por_presentacion` separa conteo, kg y ahorro por presentación de ADR-091
 *   (`.specs/sello-huella-toda-la-web`): ningún total de la web mezcla clases.
 */
export interface TotalPresentacion {
  certificados: number;
  kgco2e: number;
  ahorro_kgco2e: number;
}

export interface ResumenCertificados {
  certificados: number;
  medidos: number;
  estimados: number;
  kgco2e: number;
  ahorro_kgco2e: number;
  por_presentacion: Record<Presentacion, TotalPresentacion>;
}

export const PRESENTACIONES: readonly Presentacion[] = ['primario', 'medido_teltonika', 'estimado'];

export async function resumenCertificados(opts: {
  db: Db;
  /** Empresa generadora. Sin ella, toda la plataforma. */
  empresaId?: string | undefined;
}): Promise<ResumenCertificados> {
  const emitido = isNotNull(tripMetrics.certificateIssuedAt);
  // rls-allowlist: sin `empresaId` es el total de plataforma, que solo pide el panel de administración (requirePlatformAdmin).
  const filas = await opts.db
    .select({
      certificationLevel: tripMetrics.certificationLevel,
      routeDataSource: tripMetrics.routeDataSource,
      coveragePct: tripMetrics.coveragePct,
      certificados: sql<string>`count(*)`,
      kgco2e: sql<
        string | null
      >`sum(coalesce(${tripMetrics.carbonEmissionsKgco2eActual}, ${tripMetrics.carbonEmissionsKgco2eEstimated}))`,
      ahorro: sql<string | null>`sum(${tripMetrics.ahorroCo2eVsSinMatchingKgco2e})`,
    })
    .from(tripMetrics)
    .innerJoin(trips, eq(trips.id, tripMetrics.tripId))
    .where(
      opts.empresaId ? and(eq(trips.generadorCargaEmpresaId, opts.empresaId), emitido) : emitido,
    )
    .groupBy(tripMetrics.certificationLevel, tripMetrics.routeDataSource, tripMetrics.coveragePct);

  const porPresentacion = Object.fromEntries(
    PRESENTACIONES.map((p) => [p, { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 }]),
  ) as Record<Presentacion, TotalPresentacion>;
  for (const fila of filas) {
    const total = porPresentacion[presentacionDesdeMetricas(fila)];
    total.certificados += Number(fila.certificados);
    total.kgco2e += Number(fila.kgco2e ?? 0);
    total.ahorro_kgco2e += Number(fila.ahorro ?? 0);
  }
  // Las sumas de `numeric` llegan como texto; se redondean a gramos para no
  // arrastrar el error de coma flotante de sumar en JS.
  const gramos = (kg: number) => Math.round(kg * 1000) / 1000;
  for (const total of Object.values(porPresentacion)) {
    total.kgco2e = gramos(total.kgco2e);
    total.ahorro_kgco2e = gramos(total.ahorro_kgco2e);
  }
  const totales = PRESENTACIONES.map((p) => porPresentacion[p]);
  const certificados = totales.reduce((s, t) => s + t.certificados, 0);
  const medidos = porPresentacion.primario.certificados;
  return {
    certificados,
    medidos,
    estimados: certificados - medidos,
    kgco2e: gramos(totales.reduce((s, t) => s + t.kgco2e, 0)),
    ahorro_kgco2e: gramos(totales.reduce((s, t) => s + t.ahorro_kgco2e, 0)),
    por_presentacion: porPresentacion,
  };
}
