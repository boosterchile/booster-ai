import type { Logger } from '@booster-ai/logger';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas } from '../db/schema.js';
import { zValidator } from '../lib/validation.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { indicadoresNegocio } from '../services/indicadores-negocio.js';

/**
 * Indicadores del negocio para el Inicio del panel de administración
 * (`.specs/una-sola-verdad-por-dato`). Solo lectura.
 *
 *   GET /admin/plataforma/indicadores                 toda la plataforma
 *   GET /admin/plataforma/indicadores?empresa_id=…    una empresa
 *
 * La respuesta trae además la lista de empresas activas, para elegir una.
 */
const consultaSchema = z.object({ empresa_id: z.string().uuid().optional() });
const consultas = getBusinessCounter('indicadores_negocio_consultas_total');

export function createAdminIndicadoresRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  app.get('/', zValidator('query', consultaSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const { empresa_id: empresaId } = c.req.valid('query');
    return withBusinessSpan({ name: 'indicadores_negocio.leer' }, async (span) => {
      // rls-allowlist: lista de empresas activas para el selector del panel de administración (requirePlatformAdmin).
      const lista = await opts.db
        .select({ id: empresas.id, nombre: empresas.legalName })
        .from(empresas)
        .where(eq(empresas.status, 'activa'))
        .orderBy(asc(empresas.legalName));
      if (empresaId && !lista.some((empresa) => empresa.id === empresaId)) {
        return c.json({ error: 'empresa_no_encontrada', code: 'empresa_no_encontrada' }, 404);
      }
      const indicadores = await indicadoresNegocio({ db: opts.db, empresaId });
      const alcance = empresaId ? 'empresa' : 'plataforma';
      setResultAttributes(span, { 'booster.indicadores.alcance': alcance });
      consultas.add(1, { alcance });
      return c.json({ empresa_id: empresaId ?? null, empresas: lista, indicadores });
    });
  });

  return app;
}
