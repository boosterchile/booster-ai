import type { Logger } from '@booster-ai/logger';
import { registrarEventoAdminSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import {
  calcularFloatActual,
  listarPagosMandato,
  registrarEventoPago,
} from '../services/mandato-cobro/eventos-pago.js';

/**
 * ADR-080 — conciliación del mandato de cobro (platform-admin, ADR-076):
 *
 *   GET  /admin/mandato-cobro → float de terceros, tope, conteos por estado y
 *        viajes en mandato con sus vencimientos.
 *   POST /admin/mandato-cobro/:asignacionId/eventos → registra cobro,
 *        liberación, anticipo del operador o resolución de disputa con su
 *        evidencia (referencia del abono, de la transferencia, id del
 *        adelanto o de la resolución).
 *
 * El sistema registra; no mueve dinero. Con MANDATO_COBRO_ACTIVATED apagado
 * responde 404 `mandato_cobro_desactivado` (después del guard de admin).
 */
const asignacionParamSchema = z.object({ asignacionId: z.string().uuid() });

export function createAdminMandatoCobroRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();
  const deps = () => ({
    db: opts.db,
    logger: opts.logger,
    topeFloatClp: appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP,
  });

  app.get('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!appConfig.MANDATO_COBRO_ACTIVATED) {
      return c.json({ error: 'mandato_cobro_desactivado' }, 404);
    }
    const [viajes, floatClp] = await Promise.all([
      listarPagosMandato(opts.db),
      calcularFloatActual(opts.db),
    ]);
    const cobro: Record<string, number> = {};
    const liberacion: Record<string, number> = {};
    for (const v of viajes) {
      cobro[v.cobro.estado] = (cobro[v.cobro.estado] ?? 0) + 1;
      liberacion[v.liberacion.estado] = (liberacion[v.liberacion.estado] ?? 0) + 1;
    }
    return c.json({
      float_clp: floatClp,
      tope_float_clp: appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP,
      conteos: { cobro, liberacion },
      viajes,
    });
  });

  app.post(
    '/:asignacionId/eventos',
    zValidator('param', asignacionParamSchema),
    zValidator('json', registrarEventoAdminSchema),
    async (c) => {
      const auth = requirePlatformAdmin(c);
      if (!auth.ok) {
        return auth.response;
      }
      if (!appConfig.MANDATO_COBRO_ACTIVATED) {
        return c.json({ error: 'mandato_cobro_desactivado' }, 404);
      }
      const { asignacionId } = c.req.valid('param');
      const body = c.req.valid('json');
      const r = await registrarEventoPago(deps(), {
        asignacionId,
        tipo: body.tipo,
        montoClp: body.monto_clp ?? null,
        evidenciaRef: body.evidencia_ref,
        detalle: body.detalle ?? null,
        ocurridoEn: new Date(body.ocurrido_en),
        registradoPor: auth.adminEmail,
      });
      if (!r.ok) {
        if (r.code === 'liquidacion_no_encontrada') {
          return c.json({ error: r.code }, 404);
        }
        if (r.code === 'tope_float_excedido') {
          return c.json({ error: r.code, disponible_clp: r.disponibleClp ?? 0 }, 422);
        }
        return c.json({ error: r.code }, 409);
      }
      return c.json({ pago: r.pago }, 201);
    },
  );

  return app;
}
