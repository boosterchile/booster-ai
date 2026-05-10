/**
 * Backfill one-shot de certificados de huella de carbono.
 *
 * Encuentra todos los trips con status='entregado' que NO tienen
 * certificateIssuedAt poblado todavía y dispara `emitirCertificadoViaje`
 * sobre cada uno. Idempotente: el servicio mismo skipea si el cert ya
 * existe, así que correrlo dos veces no duplica nada.
 *
 * Casos de uso:
 *   1. Trips entregados ANTES del deploy de P2 (no tenían el wire
 *      fire-and-forget). Una pasada de este job emite los certs faltantes.
 *   2. Recuperación post-incidente: si KMS o GCS tuvieron downtime durante
 *      una ventana de entregas, los wires fire-and-forget loggearon el
 *      error pero no reintentaron. Este job los retoma.
 *   3. Validación end-to-end manual: correrlo en dev contra un trip de
 *      prueba para verificar que el pipeline KMS+GCS+PDF funciona sin
 *      depender de la UI.
 *
 * Ejecución (desde apps/api):
 *
 *   # Asegurarte que tu shell tiene:
 *   #   - DATABASE_URL apuntando al Cloud SQL Auth Proxy local (ver scripts/db/connect.sh)
 *   #   - GOOGLE_APPLICATION_CREDENTIALS apuntando a una SA con cloudkms.signer + storage.objectUser
 *   #     sobre el bucket documents (en local: usar `gcloud auth application-default login`)
 *   #   - CERTIFICATE_SIGNING_KEY_ID = projects/.../keyRings/.../cryptoKeys/certificate-carbono-signing
 *   #   - CERTIFICATES_BUCKET = booster-ai-documents
 *   #   - VERIFY_BASE_URL (opcional, default https://api.boosterchile.com)
 *
 *   pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts
 *
 *   # Con dry-run para ver qué emitiría sin tocar KMS/GCS:
 *   pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts --dry-run
 *
 *   # Limitando cantidad (útil para probar incremental):
 *   pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts --limit=10
 *
 * Concurrencia:
 *   Procesamos secuencialmente (no en paralelo) por defecto. Las firmas
 *   KMS son ~50ms y GCS uploads ~200ms, así que un trip toma ~300ms. 100
 *   trips = ~30s. Si el backfill grande es un problema, pasar
 *   --concurrency=N (cap 10 para no saturar quotas KMS).
 */

import { createLogger } from '@booster-ai/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { createDb } from '../db/client.js';
import { tripMetrics, trips } from '../db/schema.js';
import {
  type EmitirCertificadoConfig,
  emitirCertificadoViaje,
} from '../services/emitir-certificado-viaje.js';

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, limit: null, concurrency: 1 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    const [k, v] = arg.split('=');
    if (k === '--limit' && v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--limit inválido: ${v}`);
      }
      opts.limit = n;
    }
    if (k === '--concurrency' && v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        throw new Error(`--concurrency inválido (1-10): ${v}`);
      }
      opts.concurrency = n;
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv);

  const logger = createLogger({
    service: 'backfill-certificados',
    version: config.SERVICE_VERSION,
    level: config.LOG_LEVEL,
    pretty: true,
  });

  const certConfig: Partial<EmitirCertificadoConfig> = {
    ...(config.CERTIFICATE_SIGNING_KEY_ID ? { kmsKeyId: config.CERTIFICATE_SIGNING_KEY_ID } : {}),
    ...(config.CERTIFICATES_BUCKET ? { certificatesBucket: config.CERTIFICATES_BUCKET } : {}),
    verifyBaseUrl:
      process.env.VERIFY_BASE_URL ?? config.API_AUDIENCE[0] ?? 'https://api.boosterchile.com',
  };

  if (!certConfig.kmsKeyId || !certConfig.certificatesBucket) {
    logger.error(
      {
        hasKey: !!certConfig.kmsKeyId,
        hasBucket: !!certConfig.certificatesBucket,
      },
      'Falta CERTIFICATE_SIGNING_KEY_ID o CERTIFICATES_BUCKET en env. Aborto.',
    );
    process.exit(1);
  }

  logger.info(
    { dryRun: cli.dryRun, limit: cli.limit, concurrency: cli.concurrency },
    'backfill-certificados iniciando',
  );

  const { db, pool } = createDb({
    databaseUrl: config.DATABASE_URL,
    poolMax: config.DATABASE_POOL_MAX,
    connectTimeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
  });

  try {
    // Trips entregados sin certificado emitido. LEFT JOIN porque puede no
    // haber row en tripMetrics todavía (trips muy viejos pre-carbon-calculator).
    const candidatesQuery = db
      .select({
        tripId: trips.id,
        trackingCode: trips.trackingCode,
        empresaId: trips.generadorCargaEmpresaId,
        hasMetrics: sql<boolean>`${tripMetrics.tripId} IS NOT NULL`,
      })
      .from(trips)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(and(eq(trips.status, 'entregado'), isNull(tripMetrics.certificateIssuedAt)))
      .orderBy(trips.createdAt);

    const candidates = cli.limit ? await candidatesQuery.limit(cli.limit) : await candidatesQuery;

    logger.info({ count: candidates.length }, 'trips candidatos a backfill encontrados');

    if (candidates.length === 0) {
      logger.info('nada para hacer — todos los entregados ya tienen cert o no hay metrics');
      return;
    }

    if (cli.dryRun) {
      for (const c of candidates) {
        logger.info(
          {
            tripId: c.tripId,
            trackingCode: c.trackingCode,
            empresaId: c.empresaId,
            hasMetrics: c.hasMetrics,
          },
          'DRY-RUN — emitiría',
        );
      }
      logger.info({ totalCandidates: candidates.length }, 'DRY-RUN completo');
      return;
    }

    // Procesamiento. Para concurrency=1 (default), serial. Para >1, hacemos
    // batches de N. Sin librería externa de pool — Promise.all sobre slices
    // mantiene el código simple y suficiente para el volumen esperado
    // (~decenas de trips por backfill).
    let processed = 0;
    let emitted = 0;
    let skipped = 0;
    let errored = 0;

    for (let i = 0; i < candidates.length; i += cli.concurrency) {
      const batch = candidates.slice(i, i + cli.concurrency);
      const results = await Promise.allSettled(
        batch.map((c) =>
          emitirCertificadoViaje({
            db,
            logger,
            tripId: c.tripId,
            config: certConfig,
          }),
        ),
      );

      for (let j = 0; j < results.length; j += 1) {
        processed += 1;
        const r = results[j];
        const c = batch[j];
        if (!r || !c) {
          continue; // ts-narrowing — nunca pasa, batch.length === results.length
        }

        if (r.status === 'rejected') {
          errored += 1;
          logger.error({ err: r.reason, tripId: c.tripId }, 'emitirCertificadoViaje throwed');
          continue;
        }
        if (r.value.skipped) {
          skipped += 1;
          logger.warn({ tripId: c.tripId, reason: r.value.reason }, 'skipped');
        } else {
          emitted += 1;
          logger.info(
            {
              tripId: c.tripId,
              trackingCode: c.trackingCode,
              pdfSha256: r.value.pdfSha256,
              kmsKeyVersion: r.value.kmsKeyVersion,
            },
            'certificado emitido',
          );
        }
      }

      // Progress periódico cada 10 procesados.
      if (processed % 10 === 0 || processed === candidates.length) {
        logger.info(
          {
            processed,
            total: candidates.length,
            emitted,
            skipped,
            errored,
          },
          'progress',
        );
      }
    }

    logger.info(
      {
        total: candidates.length,
        emitted,
        skipped,
        errored,
      },
      'backfill-certificados completo',
    );

    if (errored > 0) {
      // Exit code 1 si hubo errores — útil para CI / cron alerting.
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  const bootstrapLogger = createLogger({
    service: '@booster-ai/api/jobs/backfill-certificados',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal job error');
  process.exit(1);
});
