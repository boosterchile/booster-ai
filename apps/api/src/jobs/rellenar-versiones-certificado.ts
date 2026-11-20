// =============================================================================
// Job one-off — relleno de la versión 1 de los certificados emitidos
// (`.specs/reemision-certificado/` parte 2)
// =============================================================================
// Crea en `certificados_viaje` la versión 1 de cada certificado emitido antes
// de que la emisión versionara, copiada de `metricas_viaje`, y deja las
// métricas apuntando a ella. La lógica vive en
// services/rellenar-versiones-certificado.ts.
//
// No toca PDFs ni las columnas `certificado_*`. Idempotente: una segunda
// corrida informa 0 creadas y 0 enlazadas. Todo en una transacción; si la
// verificación final falla, no se escribe nada.
//
// Variables:
//   DATABASE_URL       conexión (la ejecuta el PO; el agente no escribe en prod)
//   DRY_RUN            "false" para commitear; cualquier otro valor = ROLLBACK (default)
//   CONFIRMAR_DESTINO  <host>:<port>/<db> que imprime la corrida en seco;
//                      obligatorio con DRY_RUN=false
//
// Sale con código 1 si algún certificado quedó omitido: el detalle va en la
// salida, con el motivo de cada uno.
// =============================================================================

import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import {
  type ResultadoRellenoVersiones,
  rellenarVersionesCertificado,
} from '../services/rellenar-versiones-certificado.js';
import { destinoDe, formatoDestino } from './hc001-fuente-combustible-can.js';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  DRY_RUN: z.string().optional(),
  CONFIRMAR_DESTINO: z.string().optional(),
});

/** CLI. Imprime el destino real (sin password); para escribir exige CONFIRMAR_DESTINO. */
export async function main(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResultadoRellenoVersiones> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const { DATABASE_URL, DRY_RUN, CONFIRMAR_DESTINO } = parsed.data;
  const dryRun = DRY_RUN !== 'false';
  const destino = formatoDestino(destinoDe(DATABASE_URL));
  process.stdout.write(
    `${JSON.stringify({ msg: 'rellenar-versiones-certificado destino', destino, dryRun })}\n`,
  );
  if (!dryRun && CONFIRMAR_DESTINO !== destino) {
    throw new Error(`CONFIRMAR_DESTINO debe ser '${destino}' para escribir; no se escribió nada`);
  }
  const { db, pool } = createDb({
    databaseUrl: DATABASE_URL,
    poolMax: 1,
    connectTimeoutMs: 10_000,
  });
  try {
    const r = await rellenarVersionesCertificado(db, { dryRun });
    process.stdout.write(
      `${JSON.stringify({
        msg: 'rellenar-versiones-certificado resultado',
        dryRun: r.dryRun,
        revisados: r.revisados,
        creadas: r.creadas.length,
        enlazadas: r.enlazadas.length,
        sinCambios: r.sinCambios,
        omitidas: r.omitidas.length,
        detalle: { omitidas: r.omitidas },
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
