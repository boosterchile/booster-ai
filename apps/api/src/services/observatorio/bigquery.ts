import type { Writable } from 'node:stream';
import type { Logger } from '@booster-ai/logger';
import type { BigQuery } from '@google-cloud/bigquery';
import { getBusinessCounter } from '../../observability/business-metrics.js';
import { K_MIN_VEHICULOS, type ViajeEntregado, filtrarK, proyectarViaje } from './proyeccion.js';

/**
 * Observatorio urbano (ADR-012 Capa 2) — BigQuery.
 *
 * Escritura: `exportarObservatorio` reemplaza `observatory.viajes` con un
 * load job `WRITE_TRUNCATE` (NDJSON). Es idempotente: cada corrida sube la
 * foto completa de viajes entregados.
 *
 * Lectura: `crearLectorObservatorio` consulta las vistas materializadas
 * `urban_flow_metrics_*` (Terraform, `infrastructure/observatorio.tf`), que
 * ya aplican k ≥ 10, y vuelve a aplicar `filtrarK` como defensa.
 */

/** Subconjunto del cliente de `@google-cloud/bigquery` que usa el observatorio. */
export interface ClienteBigQuery {
  dataset(datasetId: string): {
    table(tableId: string): {
      createWriteStream(opts: {
        sourceFormat: 'NEWLINE_DELIMITED_JSON';
        writeDisposition: 'WRITE_TRUNCATE';
      }): Writable;
    };
  };
  query(opts: { query: string; params: Record<string, unknown> }): Promise<unknown[]>;
}

/** Adapta el cliente real a la interfaz mínima (los tipos de la librería son más anchos). */
export function clienteDesdeBigQuery(bq: BigQuery): ClienteBigQuery {
  return {
    dataset: (datasetId) => ({
      table: (tableId) => ({
        createWriteStream: (opts) => bq.dataset(datasetId).table(tableId).createWriteStream(opts),
      }),
    }),
    query: (opts) => bq.query({ query: opts.query, params: opts.params }),
  };
}

export interface CargadorBigQuery {
  reemplazarTabla(opts: {
    datasetId: string;
    tableId: string;
    filas: ReadonlyArray<object>;
  }): Promise<void>;
}

interface JobCarga {
  promise(): Promise<unknown>;
}

export function crearCargadorBigQuery(cliente: ClienteBigQuery): CargadorBigQuery {
  return {
    reemplazarTabla: ({ datasetId, tableId, filas }) =>
      new Promise<void>((resolve, reject) => {
        const stream = cliente.dataset(datasetId).table(tableId).createWriteStream({
          sourceFormat: 'NEWLINE_DELIMITED_JSON',
          writeDisposition: 'WRITE_TRUNCATE',
        });
        stream.on('error', reject);
        // La librería emite `job` cuando terminó la subida; `promise()`
        // espera a que BigQuery termine el load job (o lo rechaza).
        stream.on('job', (job: JobCarga) => {
          job.promise().then(() => resolve(), reject);
        });
        for (const fila of filas) {
          stream.write(`${JSON.stringify(fila)}\n`);
        }
        stream.end();
      }),
  };
}

export const TABLA_VIAJES = 'viajes';

export async function exportarObservatorio(opts: {
  logger: Logger;
  datasetId: string;
  leerViajes: () => Promise<ViajeEntregado[]>;
  cargador: CargadorBigQuery;
}): Promise<{ filas: number }> {
  const viajes = await opts.leerViajes();
  const filas = viajes.map(proyectarViaje);
  await opts.cargador.reemplazarTabla({
    datasetId: opts.datasetId,
    tableId: TABLA_VIAJES,
    filas,
  });
  getBusinessCounter('observatorio.viajes_exportados').add(filas.length);
  opts.logger.info({ filas: filas.length, datasetId: opts.datasetId }, 'observatorio exportado');
  return { filas: filas.length };
}

export const SECCIONES_OBSERVATORIO = ['franjas', 'emisiones', 'od', 'activos'] as const;
export type SeccionObservatorio = (typeof SECCIONES_OBSERVATORIO)[number];

/**
 * Filtro por región de cada vista. OD filtra por origen O destino: interesa
 * todo flujo que sale o entra de la región.
 */
const FILTRO_REGION: Record<SeccionObservatorio, string> = {
  franjas: 'region = @region',
  emisiones: 'region = @region',
  od: '(origen_region = @region OR destino_region = @region)',
  activos: 'region = @region',
};

export type ObservatorioRegion = Record<SeccionObservatorio, Array<Record<string, unknown>>> & {
  region: string;
  k_min_vehiculos: number;
};

export interface LectorObservatorio {
  porRegion(region: string): Promise<ObservatorioRegion>;
}

const REGION_VALIDA = /^[A-Z]{1,4}$/;

export function crearLectorObservatorio(opts: {
  cliente: ClienteBigQuery;
  datasetId: string;
  ttlMs?: number;
  ahora?: () => number;
}): LectorObservatorio {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const ahora = opts.ahora ?? Date.now;
  const cache = new Map<string, { valor: ObservatorioRegion; leidoEn: number }>();

  async function consultar(seccion: SeccionObservatorio, region: string) {
    const [filas] = (await opts.cliente.query({
      query: `SELECT * FROM \`${opts.datasetId}.urban_flow_metrics_${seccion}\` WHERE ${FILTRO_REGION[seccion]} ORDER BY mes DESC LIMIT 5000`,
      params: { region },
    })) as [Array<Record<string, unknown>> | undefined];
    return filtrarK(filas ?? []);
  }

  return {
    async porRegion(region) {
      if (!REGION_VALIDA.test(region)) {
        throw new Error(`región inválida: ${region}`);
      }
      const enCache = cache.get(region);
      if (enCache && ahora() - enCache.leidoEn < ttlMs) {
        return enCache.valor;
      }
      const [franjas, emisiones, od, activos] = await Promise.all([
        consultar('franjas', region),
        consultar('emisiones', region),
        consultar('od', region),
        consultar('activos', region),
      ]);
      const valor: ObservatorioRegion = {
        region,
        k_min_vehiculos: K_MIN_VEHICULOS,
        franjas,
        emisiones,
        od,
        activos,
      };
      cache.set(region, { valor, leidoEn: ahora() });
      return valor;
    },
  };
}
