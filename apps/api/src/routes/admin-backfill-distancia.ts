import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import type { BackfillReport } from '../services/backfill-distancia-real.js';

/**
 * Entrypoint del backfill de re-derivación de distancia real (F0-0 paso 1).
 *
 * **Inversión de la carga (seguridad):** el default es dry-run SIEMPRE. Escribir
 * exige una confirmación explícita e incómoda — `{confirmar:"ESCRIBIR",
 * trips_esperados:N}` — y el job aborta si el conteo real no coincide con N. Ese
 * segundo campo obliga a haber leído el dry-run antes de escribir: si el número
 * cambió entre simulación y ejecución, algo cambió y NO debe correr. El camino
 * fácil (POST sin body) es el seguro (dry-run).
 *
 * **Auth:** detrás de `requirePlatformAdmin` (regla única de acceso al panel),
 * NO del JWT genérico ni del SA de cron: reescribe la huella de toda la flota.
 */

/** Confirmación explícita para el modo escritura. La literal "ESCRIBIR" es
 *  deliberadamente incómoda (no un boolean que un cliente manda sin querer). */
export const confirmacionSchema = z.object({
  confirmar: z.literal('ESCRIBIR'),
  trips_esperados: z.number().int().nonnegative(),
});

export type ModoBackfill =
  | { modo: 'dry-run' }
  | { modo: 'escritura' }
  | { modo: 'rechazado'; razon: 'conteo_no_coincide'; tripsEsperados: number; tripsReales: number };

/**
 * Decide el modo de forma segura por default. `body` es el JSON crudo del
 * request; `tripsReales` es el conteo actual de candidatos.
 */
export function decidirModoBackfill(body: unknown, tripsReales: number): ModoBackfill {
  const parsed = confirmacionSchema.safeParse(body);
  if (!parsed.success) {
    // Cualquier cosa que no sea la confirmación exacta → dry-run seguro.
    return { modo: 'dry-run' };
  }
  if (parsed.data.trips_esperados !== tripsReales) {
    // El operador vio N en el dry-run; si el conteo cambió, algo se movió → abortar.
    return {
      modo: 'rechazado',
      razon: 'conteo_no_coincide',
      tripsEsperados: parsed.data.trips_esperados,
      tripsReales,
    };
  }
  return { modo: 'escritura' };
}

export function createAdminBackfillDistanciaRoutes(opts: {
  logger: Logger;
  /** Conteo actual de candidatos (teltonika + entregado + distancia_km_real IS NULL). */
  contarCandidatos: () => Promise<number>;
  /**
   * Corre el backfill. `dryRun=true` NO escribe pero **llama a Routes de verdad**
   * (dry-run fiel: mide costo real y aborts por routes_error). Devuelve el reporte.
   */
  correrBackfill: (dryRun: boolean) => Promise<BackfillReport>;
}) {
  const app = new Hono();

  app.post('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await c.req.json().catch(() => undefined);
    const tripsReales = await opts.contarCandidatos();
    const decision = decidirModoBackfill(body, tripsReales);

    if (decision.modo === 'rechazado') {
      opts.logger.warn(
        { adminEmail: auth.adminEmail, ...decision },
        'backfill distancia: escritura RECHAZADA (conteo no coincide con el dry-run)',
      );
      return c.json(
        {
          error: decision.razon,
          trips_esperados: decision.tripsEsperados,
          trips_reales: decision.tripsReales,
          hint: 'Corre el dry-run de nuevo y reintenta con el trips_esperados actualizado.',
        },
        409,
      );
    }

    const dryRun = decision.modo === 'dry-run';
    const report = await opts.correrBackfill(dryRun);
    opts.logger.info(
      { adminEmail: auth.adminEmail, modo: decision.modo, report },
      'backfill distancia ejecutado',
    );
    return c.json({ modo: decision.modo, trips_reales: tripsReales, report });
  });

  return app;
}
