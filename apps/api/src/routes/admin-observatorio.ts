import type { Logger } from '@booster-ai/logger';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  type LectorObservatorio,
  SECCIONES_OBSERVATORIO,
} from '../services/observatorio/bigquery.js';
import { filtrarK } from '../services/observatorio/proyeccion.js';
import type { UserContext } from '../services/user-context.js';

/**
 * T10-24 / ADR-012 Capa 2 — observatorio urbano, vista interna:
 *
 *   GET /admin/observatorio/:region → { region, k_min_vehiculos, franjas,
 *       emisiones, od, activos }
 *
 * Solo platform-admin (allowlist ADR-076). `:region` es el código romano de
 * `viajes` (IV = Coquimbo). Los datos salen de las vistas materializadas
 * `urban_flow_metrics_*` (k ≥ 10 vehículos por bucket); esta ruta vuelve a
 * aplicar `filtrarK` antes de responder. Sin dataset configurado, 503.
 */
const regionSchema = z.string().regex(/^[IVX]{1,4}$/, 'región: código romano');

export function createAdminObservatorioRoutes(opts: {
  logger: Logger;
  /** null cuando `BIGQUERY_OBSERVATORY_DATASET` no está configurado. */
  lector: Pick<LectorObservatorio, 'porRegion'> | null;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    if (!email || !appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const };
  }

  app.get('/:region', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const region = regionSchema.safeParse(c.req.param('region'));
    if (!region.success) {
      return c.json({ error: 'region_invalida' }, 400);
    }
    const lector = opts.lector;
    if (!lector) {
      return c.json({ error: 'observatorio_no_configurado' }, 503);
    }
    const datos = await withBusinessSpan({ name: 'observatorio.consultar' }, async (span) => {
      const d = await lector.porRegion(region.data);
      setResultAttributes(span, { 'booster.observatorio.region': region.data });
      return d;
    });
    getBusinessCounter('observatorio.consultas').add(1, { audiencia: 'platform_admin' });
    // Defensa en profundidad: aunque el lector ya filtra, nada bajo k sale de aquí.
    const respuesta: Record<string, unknown> = {
      region: datos.region,
      k_min_vehiculos: datos.k_min_vehiculos,
    };
    for (const seccion of SECCIONES_OBSERVATORIO) {
      respuesta[seccion] = filtrarK(datos[seccion]);
    }
    return c.json(respuesta);
  });

  return app;
}
