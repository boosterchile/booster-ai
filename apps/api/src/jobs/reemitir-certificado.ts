// =============================================================================
// Job manual — reemisión de un certificado (`.specs/reemision-certificado/`
// parte 5, §3.5)
// =============================================================================
// Reemite UN certificado: corrige el dato que estaba mal, genera la versión
// siguiente con la línea de reemplazo, la firma, la sube a su propia ruta y la
// registra. La lógica vive en services/reemitir-certificado.ts.
//
// En seco por defecto: hace todas las comprobaciones y genera el PDF en
// memoria, sin firmar, sin subir y sin escribir en la base. No reemite en
// lote (§3.3): un viaje por corrida.
//
// Variables:
//   DATABASE_URL            conexión (la ejecuta el PO; el agente no escribe en prod)
//   CODIGO_SEGUIMIENTO      viaje a reemitir (p. ej. BOO-YWKZWR)
//   MOTIVO                  de la lista cerrada: factor_impreso_no_corresponde o
//                           distancia_medida_no_plausible (este exige haber corrido antes
//                           corregir-distancia-no-plausible.ts sobre el viaje o su ruta)
//   FACTOR_ANTERIOR         solo con el factor: factor guardado hoy, kg CO2e/L (p. ej. 3.25)
//   FACTOR_NUEVO            solo con el factor: el que explica la cifra publicada (p. ej. 3.24)
//   SOLICITADO_POR_USER_ID  opcional: usuario que queda en el evento del viaje
//   DRY_RUN                 "false" para escribir; cualquier otro valor = en seco (default)
//   CONFIRMAR_DESTINO       <host>:<port>/<db> que imprime la corrida en seco;
//                           obligatorio con DRY_RUN=false
//   Solo para escribir:
//   CERTIFICATE_SIGNING_KEY_ID  resource ID de la llave KMS
//   CERTIFICATES_BUCKET         bucket de certificados
//   VERIFY_BASE_URL             opcional, default https://api.boosterchile.com
//
// Sale con código 1 si el certificado no se reemitiría (o no se reemitió): el
// motivo va en la salida.
// =============================================================================

import { pathToFileURL } from 'node:url';
import { MOTIVOS_REEMISION, esBucketLocal, esKeyLocal } from '@booster-ai/certificate-generator';
import { createLogger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import { trips } from '../db/schema.js';
import {
  type Correccion,
  type ResultadoReemision,
  type ResultadoSimulacion,
  reemitirCertificado,
  simularReemision,
} from '../services/reemitir-certificado.js';
import { destinoDe, formatoDestino } from './hc001-fuente-combustible-can.js';

const VERIFY_BASE_URL_DEFAULT = 'https://api.boosterchile.com';

/** Un factor de emisión: número positivo escrito con punto decimal. */
const factor = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'el factor va con punto decimal, p. ej. 3.24')
  .transform(Number)
  .refine((n) => n > 0 && n < 100, 'factor fuera de rango');

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
    // Los códigos se generan en mayúsculas (BOO-XXXXXX).
    CODIGO_SEGUIMIENTO: z
      .string()
      .trim()
      .min(1, 'CODIGO_SEGUIMIENTO es requerido')
      .transform((c) => c.toUpperCase()),
    MOTIVO: z.enum(MOTIVOS_REEMISION),
    FACTOR_ANTERIOR: factor.optional(),
    FACTOR_NUEVO: factor.optional(),
    SOLICITADO_POR_USER_ID: z.string().uuid().optional(),
    DRY_RUN: z.string().optional(),
    CONFIRMAR_DESTINO: z.string().optional(),
    CERTIFICATE_SIGNING_KEY_ID: z.string().min(1).optional(),
    CERTIFICATES_BUCKET: z.string().min(1).optional(),
    VERIFY_BASE_URL: z.string().url().optional(),
  })
  .superRefine((e, ctx) => {
    // Solo la corrección del factor lleva los dos factores; la de distancia no corrige ningún dato.
    if (e.MOTIVO === 'factor_impreso_no_corresponde') {
      for (const k of ['FACTOR_ANTERIOR', 'FACTOR_NUEVO'] as const) {
        if (e[k] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: `${k} es requerido con MOTIVO=${e.MOTIVO}`,
          });
        }
      }
    }
  });

/** La corrección que pide el entorno, ya validada. */
function correccionDe(p: z.infer<typeof envSchema>): Correccion {
  if (p.MOTIVO === 'factor_impreso_no_corresponde') {
    if (p.FACTOR_ANTERIOR === undefined || p.FACTOR_NUEVO === undefined) {
      throw new Error('FACTOR_ANTERIOR y FACTOR_NUEVO son requeridos con el motivo del factor');
    }
    return { motivo: p.MOTIVO, factorAnterior: p.FACTOR_ANTERIOR, factorNuevo: p.FACTOR_NUEVO };
  }
  return { motivo: p.MOTIVO };
}

export type ResultadoJobReemision =
  | ({ readonly dryRun: true; readonly codigoSeguimiento: string } & ResultadoSimulacion)
  | ({ readonly dryRun: false; readonly codigoSeguimiento: string } & ResultadoReemision);

const escribir = (linea: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify(linea)}\n`);

/** CLI. Imprime el destino real (sin password); para escribir exige CONFIRMAR_DESTINO y la llave. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<ResultadoJobReemision> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const p = parsed.data;
  const dryRun = p.DRY_RUN !== 'false';
  const destino = formatoDestino(destinoDe(p.DATABASE_URL));
  escribir({ msg: 'reemitir-certificado destino', destino, dryRun });

  // Todo lo que impide escribir se rechaza antes de conectarse.
  if (!dryRun) {
    if (p.CONFIRMAR_DESTINO !== destino) {
      throw new Error(`CONFIRMAR_DESTINO debe ser '${destino}' para escribir; no se escribió nada`);
    }
    const faltan = (['CERTIFICATE_SIGNING_KEY_ID', 'CERTIFICATES_BUCKET'] as const).filter(
      (k) => !p[k],
    );
    if (faltan.length > 0) {
      throw new Error(`para escribir faltan ${faltan.join(' y ')}; no se escribió nada`);
    }
    // El backend local del E2E (`local:` / `file:`) firma con una clave
    // efímera y guarda en disco. Contra la base de producción dejaría una
    // versión vigente sin PDF verificable. Este job solo escribe con KMS y GCS.
    if (
      esKeyLocal(p.CERTIFICATE_SIGNING_KEY_ID ?? '') ||
      esBucketLocal(p.CERTIFICATES_BUCKET ?? '')
    ) {
      throw new Error(
        'para escribir se exige la llave de Cloud KMS y el bucket GCS (local:/file: son del E2E); no se escribió nada',
      );
    }
  }

  const logger = createLogger({ service: 'job-reemitir-certificado', level: 'info' });
  const { db, pool } = createDb({
    databaseUrl: p.DATABASE_URL,
    poolMax: 1,
    connectTimeoutMs: 10_000,
  });
  try {
    const codigoSeguimiento = p.CODIGO_SEGUIMIENTO;
    // rls-allowlist: job manual del PO, un viaje por código de seguimiento
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.trackingCode, codigoSeguimiento))
      .limit(1);
    const verifyBaseUrl = p.VERIFY_BASE_URL ?? VERIFY_BASE_URL_DEFAULT;

    let r: ResultadoJobReemision;
    if (trip) {
      const comun = {
        db,
        logger,
        tripId: trip.id,
        correccion: correccionDe(p),
        solicitadoPorUserId: p.SOLICITADO_POR_USER_ID ?? null,
      };
      r = dryRun
        ? {
            dryRun: true,
            codigoSeguimiento,
            ...(await simularReemision({ ...comun, verifyBaseUrl })),
          }
        : {
            dryRun: false,
            codigoSeguimiento,
            ...(await reemitirCertificado({
              ...comun,
              config: {
                ...(p.CERTIFICATE_SIGNING_KEY_ID ? { kmsKeyId: p.CERTIFICATE_SIGNING_KEY_ID } : {}),
                ...(p.CERTIFICATES_BUCKET ? { certificatesBucket: p.CERTIFICATES_BUCKET } : {}),
                verifyBaseUrl,
              },
            })),
          };
    } else {
      const fallo = { ok: false, code: 'trip_not_found' } as const;
      r = dryRun
        ? { dryRun: true, codigoSeguimiento, ...fallo }
        : { dryRun: false, codigoSeguimiento, ...fallo };
    }
    escribir({ msg: 'reemitir-certificado resultado', ...r });
    return r;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((r) => {
      if (!r.ok) {
        process.exit(1);
      }
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
