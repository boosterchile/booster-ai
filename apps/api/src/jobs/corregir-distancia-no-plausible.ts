// =============================================================================
// Job manual — corrección de una huella con distancia medida no plausible
// (`.specs/reemision-distancia-no-plausible/` §3.1, paso 1)
// =============================================================================
// Deja la huella guardada de la unidad del viaje (su ruta compartida, o el
// viaje solo) como la dejaría hoy el cierre cuando la distancia medida no cubre
// el recorrido: cifras reales en null, fuente `maps_directions`, cobertura 0,
// nivel e incertidumbre recalculados y la decisión de fuente registrada. No
// toca certificados: reemitirlos es el paso 2 (`reemitir-certificado.ts` con
// MOTIVO=distancia_medida_no_plausible, un viaje por corrida).
// La lógica vive en services/corregir-distancia-no-plausible.ts.
//
// En seco por defecto: hace todas las comprobaciones e imprime lo que
// escribiría, sin escribir. Una unidad por corrida: una ruta corrige todas sus
// cargas recogidas.
//
// Variables:
//   DATABASE_URL            conexión (la ejecuta el PO; el agente no escribe en prod)
//   CODIGO_SEGUIMIENTO      viaje a corregir (p. ej. BOO-4FF3XA); con ruta compartida
//                           corrige la ruta entera
//   SOLICITADO_POR_USER_ID  opcional: usuario que queda en los eventos del viaje
//   DRY_RUN                 "false" para escribir; cualquier otro valor = en seco (default)
//   CONFIRMAR_DESTINO       <host>:<port>/<db> que imprime la corrida en seco;
//                           obligatorio con DRY_RUN=false
//
// Sale con código 1 si no se corregiría (o no se corrigió): el motivo va en la salida.
// =============================================================================

import { pathToFileURL } from 'node:url';
import { createLogger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import { trips } from '../db/schema.js';
import {
  type ResultadoCorreccion,
  corregirDistanciaNoPlausible,
  prepararCorreccion,
} from '../services/corregir-distancia-no-plausible.js';
import { destinoDe, formatoDestino } from './hc001-fuente-combustible-can.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  // Los códigos se generan en mayúsculas (BOO-XXXXXX).
  CODIGO_SEGUIMIENTO: z
    .string()
    .trim()
    .min(1, 'CODIGO_SEGUIMIENTO es requerido')
    .transform((c) => c.toUpperCase()),
  SOLICITADO_POR_USER_ID: z.string().uuid().optional(),
  DRY_RUN: z.string().optional(),
  CONFIRMAR_DESTINO: z.string().optional(),
});

export type ResultadoJobCorreccion = {
  readonly dryRun: boolean;
  readonly codigoSeguimiento: string;
} & ResultadoCorreccion;

const escribir = (linea: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify(linea)}\n`);

/** CLI. Imprime el destino real (sin password); para escribir exige CONFIRMAR_DESTINO. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<ResultadoJobCorreccion> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const p = parsed.data;
  const dryRun = p.DRY_RUN !== 'false';
  const destino = formatoDestino(destinoDe(p.DATABASE_URL));
  escribir({ msg: 'corregir-distancia-no-plausible destino', destino, dryRun });
  if (!dryRun && p.CONFIRMAR_DESTINO !== destino) {
    throw new Error(`CONFIRMAR_DESTINO debe ser '${destino}' para escribir; no se escribió nada`);
  }

  const logger = createLogger({ service: 'job-corregir-distancia-no-plausible', level: 'info' });
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
    let resultado: ResultadoCorreccion;
    if (!trip) {
      resultado = { ok: false, code: 'trip_not_found' };
    } else if (dryRun) {
      resultado = await prepararCorreccion({ db, logger, tripId: trip.id });
    } else {
      resultado = await corregirDistanciaNoPlausible({
        db,
        logger,
        tripId: trip.id,
        solicitadoPorUserId: p.SOLICITADO_POR_USER_ID ?? null,
      });
    }
    const r: ResultadoJobCorreccion = { dryRun, codigoSeguimiento, ...resultado };
    escribir({ msg: 'corregir-distancia-no-plausible resultado', ...r });
    if (r.ok) {
      const conCertificado = r.plan.viajes.filter((v) => v.certificadoEmitido);
      if (conCertificado.length > 0) {
        escribir({
          msg: dryRun
            ? 'estos certificados quedarían pendientes de reemitir (paso 2)'
            : 'estos certificados quedan pendientes de reemitir (paso 2, uno por corrida)',
          codigos: conCertificado.map((v) => v.trackingCode),
          motivo: 'distancia_medida_no_plausible',
        });
      }
    }
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
