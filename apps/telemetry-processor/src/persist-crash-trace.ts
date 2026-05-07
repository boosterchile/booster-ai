import { randomUUID } from 'node:crypto';
import type { CrashTrace } from '@booster-ai/codec8-parser';
import type { Logger } from '@booster-ai/logger';
import { z } from 'zod';

/**
 * Persistencia del Crash Trace forense (Wave 2 Track B3).
 *
 * Flujo:
 *   1. Gateway recibe AVL packet con eventIoId=247 priority=panic.
 *   2. Gateway publica el packet completo (serializado) al topic Pub/Sub
 *      `crash-traces`.
 *   3. Processor consume del topic, deserializa, llama
 *      `extractCrashTrace()` del codec8-parser, y persiste vía esta
 *      función:
 *        a. Sube el trace serializado a GCS (`crash-traces` bucket).
 *        b. Inserta una fila en BigQuery `telemetry.crash_events`.
 *
 * Diseño:
 *   - Función pure-ish: el caller inyecta los uploader/indexer que
 *     pueden ser mocks en tests o adapters reales con GCS/BQ SDKs.
 *   - El JSON serializado conserva BigInt como string (necesario para
 *     timestamps epoch ms).
 *   - retry: en caso de fallo de upload, NACK al mensaje Pub/Sub para
 *     que el broker reintente. Tras N fallos, va a DLQ y dispara
 *     alerta `crash_trace_persistence_failures` (definida en
 *     infrastructure/monitoring.tf).
 */

/** Schema del mensaje publicado al topic crash-traces por el gateway. */
export const crashTraceMessageSchema = z.object({
  imei: z.string().min(8).max(20),
  vehicleId: z.string().uuid().nullable(),
  /** AVL packet completo serializado (todos los records del trace). */
  packet: z.object({
    codecId: z.union([z.literal(8), z.literal(142)]),
    recordCount: z.number().int().nonnegative(),
    records: z.array(
      z.object({
        timestampMs: z.string(), // BigInt serializado como string
        priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        gps: z.object({
          longitude: z.number(),
          latitude: z.number(),
          altitude: z.number(),
          angle: z.number(),
          satellites: z.number(),
          speedKmh: z.number(),
        }),
        io: z.object({
          eventIoId: z.number(),
          totalIo: z.number(),
          entries: z.array(
            z.object({
              id: z.number(),
              value: z.union([z.number(), z.string()]),
              byteSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.null()]),
            }),
          ),
        }),
      }),
    ),
  }),
});

export type CrashTraceMessage = z.infer<typeof crashTraceMessageSchema>;

/**
 * Adapter para subir el trace serializado a Cloud Storage. Implementación
 * real usa @google-cloud/storage; mocks en tests.
 */
export interface CrashTraceUploader {
  upload(opts: { bucketName: string; objectPath: string; jsonContent: string }): Promise<void>;
}

/**
 * Row insertada en BigQuery `telemetry.crash_events`. Keys en snake_case
 * porque BigQuery prefiere ese estilo y el dataset Booster lo usa
 * uniformemente.
 */
export interface CrashEventRow {
  crash_id: string;
  vehicle_id: string | null;
  imei: string;
  /** ISO 8601 con sufijo 'Z'. */
  timestamp: string;
  gcs_path: string;
  peak_g_force: number;
  duration_ms: number;
}

/**
 * Adapter para insertar la fila índice en BigQuery. Implementación real
 * usa @google-cloud/bigquery; mocks en tests.
 */
export interface CrashTraceIndexer {
  insertRow(opts: { datasetId: string; tableId: string; row: CrashEventRow }): Promise<void>;
}

export interface PersistCrashTraceResult {
  /** UUID generado para el evento. Lookup en BigQuery por este ID. */
  crashId: string;
  /** GCS path completo (`gs://{bucket}/{path}`) — devuelto al caller para logging. */
  gcsPath: string;
}

export interface PersistCrashTraceOpts {
  trace: CrashTrace;
  vehicleId: string | null;
  imei: string;
  uploader: CrashTraceUploader;
  indexer: CrashTraceIndexer;
  bucketName: string;
  bigQueryDatasetId: string;
  bigQueryTableId: string;
  logger: Logger;
}

/**
 * Persiste el Crash Trace en GCS + BigQuery.
 *
 * - GCS path: `{vehicleId or 'unassigned'}/{ISO timestamp}.json`.
 * - JSON: el `CrashTrace` completo, con BigInt → string (replacer abajo).
 * - BigQuery: una fila índice con peak G-force, duration, gcs_path.
 *
 * Si vehicleId es null (device pendiente de aprobación), el trace igual
 * se guarda bajo `unassigned/` con el IMEI como sub-path. Esto evita
 * perder forensics por timing de aprobación del device.
 */
export async function persistCrashTrace(
  opts: PersistCrashTraceOpts,
): Promise<PersistCrashTraceResult> {
  const {
    trace,
    vehicleId,
    imei,
    uploader,
    indexer,
    bucketName,
    bigQueryDatasetId,
    bigQueryTableId,
    logger,
  } = opts;

  const crashId = randomUUID();
  const tsIso = new Date(Number(trace.crashTimestampMs)).toISOString();
  const tsSafe = tsIso.replace(/[:.]/g, '-'); // GCS-friendly path component
  const objectPath = vehicleId
    ? `${vehicleId}/${tsSafe}.json`
    : `unassigned/${imei}/${tsSafe}.json`;
  const gcsPath = `gs://${bucketName}/${objectPath}`;

  const jsonContent = JSON.stringify(trace, bigintReplacer);

  logger.info(
    {
      crashId,
      vehicleId,
      imei,
      gcsPath,
      peakGForce: trace.peakGForce,
      accelSamples: trace.accelerometer.length,
      gnssSamples: trace.gnss.length,
      ioSnapshots: trace.io.length,
    },
    'persistiendo Crash Trace',
  );

  await uploader.upload({ bucketName, objectPath, jsonContent });

  const row: CrashEventRow = {
    crash_id: crashId,
    vehicle_id: vehicleId,
    imei,
    timestamp: tsIso,
    gcs_path: gcsPath,
    peak_g_force: trace.peakGForce,
    duration_ms: trace.durationMs,
  };

  await indexer.insertRow({
    datasetId: bigQueryDatasetId,
    tableId: bigQueryTableId,
    row,
  });

  return { crashId, gcsPath };
}

/**
 * JSON.stringify replacer que convierte BigInt a string. Usado para
 * serializar `CrashTrace.crashTimestampMs` (epoch ms BigInt) y los
 * `IoEntry.value` que pueden ser BigInt cuando byteSize === 8.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  // Buffer/Uint8Array no se serializan en el message canónico (los
  // crash trace IO entries son siempre numéricos según la spec).
  return value;
}
