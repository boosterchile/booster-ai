// =============================================================================
// Job one-off (ADR-013 Capa 3) — HC-001: corrige vehiculos.fuente_combustible_can
// =============================================================================
// Alcance EXACTO firmado por Felipe (2026-11-02 11:08 CLT, datos-can.md §3):
//   KZXB64 '89' → '83' · LFGR63 '84' → '83' · KZBB26 '84' → 'sin_sensor'
// RCPC20, PLFL57 y KFKW23 no se tocan.
//
// Cada UPDATE tiene guarda sobre el valor previo (IS NOT DISTINCT FROM). En una
// sola transacción: exactamente 1 fila por patente (3 en total) o ROLLBACK y
// error. Un segundo `up` aborta por la guarda. `reversa` aplica nuevo → previo
// con la misma guarda y el mismo conteo. `vehiculos.actualizado_en` no se toca.
//
// Variables:
//   SENTIDO       'up' | 'reversa' (required)
//   DRY_RUN       "false" para commitear; cualquier otro valor = ROLLBACK (default)
//   DATABASE_URL  conexión (la ejecuta Ops Platform con OK de Felipe)
// =============================================================================

import { pathToFileURL } from 'node:url';
import pg from 'pg';

export const CAMBIOS = [
  { patente: 'KZXB64', previo: '89', nuevo: '83' },
  { patente: 'LFGR63', previo: '84', nuevo: '83' },
  { patente: 'KZBB26', previo: '84', nuevo: 'sin_sensor' },
] as const;

export type Sentido = 'up' | 'reversa';

export class GuardaFuenteCanError extends Error {}

/** Aplica el cambio en una transacción; lanza y hace ROLLBACK si no son exactamente 1 fila por patente. */
export async function aplicarFuenteCan(
  client: pg.ClientBase,
  sentido: Sentido,
  opts: { dryRun: boolean },
): Promise<string[]> {
  const desde = sentido === 'up' ? 'previo' : 'nuevo';
  const hacia = sentido === 'up' ? 'nuevo' : 'previo';
  await client.query('BEGIN');
  try {
    const afectadas: string[] = [];
    for (const c of CAMBIOS) {
      const r = await client.query<{ patente: string }>(
        `UPDATE vehiculos SET fuente_combustible_can = $1
         WHERE patente = $2 AND fuente_combustible_can IS NOT DISTINCT FROM $3
         RETURNING patente`,
        [c[hacia], c.patente, c[desde]],
      );
      if (r.rowCount !== 1) {
        throw new GuardaFuenteCanError(
          `${c.patente}: ${r.rowCount} filas con valor previo '${c[desde]}', se esperaba 1`,
        );
      }
      afectadas.push(c.patente);
    }
    if (afectadas.length !== CAMBIOS.length) {
      throw new GuardaFuenteCanError(`${afectadas.length} filas, se esperaban ${CAMBIOS.length}`);
    }
    await client.query(opts.dryRun ? 'ROLLBACK' : 'COMMIT');
    return afectadas;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  const sentido = process.env.SENTIDO;
  const dryRun = process.env.DRY_RUN !== 'false';
  if (sentido !== 'up' && sentido !== 'reversa') {
    throw new Error("SENTIDO debe ser 'up' o 'reversa'");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL es requerida');
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const afectadas = await aplicarFuenteCan(client, sentido, { dryRun });
    process.stdout.write(
      `${JSON.stringify({ msg: 'hc001 fuente_can', sentido, dryRun, afectadas })}\n`,
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
