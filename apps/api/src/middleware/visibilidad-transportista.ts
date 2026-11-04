import type { Logger } from '@booster-ai/logger';
import { CLAVES_PRIVADAS_GENERADOR } from '@booster-ai/shared-schemas';
import type { MiddlewareHandler } from 'hono';
import { getBusinessCounter } from '../observability/business-metrics.js';

/**
 * ADR-079 §5 — guardia runtime sobre rutas de transportista y conductor:
 * si una respuesta JSON contiene una clave privada del generador (comisión,
 * precio al generador, total de su factura), se reemplaza por 500 en vez de
 * filtrar el dato (fail-closed), se loguea y se cuenta en
 * `pricing.visibilidad_contrato_violaciones`, que debe ser 0.
 */
export function crearGuardiaVisibilidadTransportista(opts: { logger: Logger }): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (!c.res.headers.get('content-type')?.includes('application/json')) {
      return;
    }
    const cuerpo = await c.res.clone().text();
    const claves = CLAVES_PRIVADAS_GENERADOR.filter((k) => cuerpo.includes(`"${k}"`));
    if (claves.length === 0) {
      return;
    }
    opts.logger.error(
      { path: c.req.path, claves },
      'visibilidad: respuesta a transportista con claves del generador',
    );
    getBusinessCounter('pricing.visibilidad_contrato_violaciones').add(1, {
      ruta: c.req.routePath,
    });
    c.res = c.json({ error: 'internal_server_error' }, 500);
  };
}
