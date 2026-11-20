// =============================================================================
// Job one-off — relleno de rutas (ADR-088, spec ruta-parada-servicio parte 3)
// =============================================================================
// Deja cada asignación con su ruta de dos paradas en el estado que le
// corresponde: crea la que falta y pone al día la que creó el accept y cuya
// asignación avanzó después. La lógica vive en services/rellenar-rutas.ts.
//
// Requiere la migración 0078 aplicada. Es idempotente: una segunda corrida
// informa 0 creadas y 0 conciliadas. Todo ocurre en una transacción; si la
// verificación final falla, no se escribe nada.
//
// Variables:
//   DATABASE_URL       conexión (la ejecuta el PO; el agente no escribe en prod)
//   DRY_RUN            "false" para commitear; cualquier otro valor = ROLLBACK (default)
//   CONFIRMAR_DESTINO  <host>:<port>/<db> que imprime la corrida en seco;
//                      obligatorio con DRY_RUN=false
//
// Sale con código 1 si alguna asignación quedó omitida: el detalle va en la
// salida, con el motivo de cada una.
// =============================================================================

import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import { type ResultadoRelleno, rellenarRutas } from '../services/rellenar-rutas.js';
import { destinoDe, formatoDestino } from './hc001-fuente-combustible-can.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  DRY_RUN: z.string().optional(),
  CONFIRMAR_DESTINO: z.string().optional(),
});

/** CLI. Imprime el destino real (sin password); para escribir exige CONFIRMAR_DESTINO. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<ResultadoRelleno> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const { DATABASE_URL, DRY_RUN, CONFIRMAR_DESTINO } = parsed.data;
  const dryRun = DRY_RUN !== 'false';
  const destino = formatoDestino(destinoDe(DATABASE_URL));
  process.stdout.write(`${JSON.stringify({ msg: 'rellenar-rutas destino', destino, dryRun })}\n`);
  if (!dryRun && CONFIRMAR_DESTINO !== destino) {
    throw new Error(`CONFIRMAR_DESTINO debe ser '${destino}' para escribir; no se escribió nada`);
  }
  const { db, pool } = createDb({
    databaseUrl: DATABASE_URL,
    poolMax: 1,
    connectTimeoutMs: 10_000,
  });
  try {
    const r = await rellenarRutas(db, { dryRun });
    process.stdout.write(
      `${JSON.stringify({
        msg: 'rellenar-rutas resultado',
        dryRun: r.dryRun,
        revisadas: r.revisadas,
        creadas: r.creadas.length,
        conciliadas: r.conciliadas.length,
        sinCambios: r.sinCambios,
        omitidas: r.omitidas.length,
        detalle: { creadas: r.creadas, conciliadas: r.conciliadas, omitidas: r.omitidas },
      })}\n`,
    );
    return r;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((r) => {
      if (r.omitidas.length > 0) {
        process.exit(1);
      }
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
