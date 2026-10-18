import type { Logger } from '@booster-ai/logger';
import { serviciosPublicosSchema } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  type LectorConfiguracionComercial,
  SinConfiguracionPublicadaError,
} from '../services/configuracion-comercial.js';

/**
 * T10-29 / ADR-079 §4 — precios públicos: `GET /public/precios`, sin auth.
 *
 * Devuelve SOLO la sección `servicios` de la configuración comercial
 * publicada (suscripciones en UF y huella), proyectada con
 * `serviciosPublicosSchema`. Las comisiones no se publican (decisión del
 * PO del 2026-10-08: se le muestran al generador en la app al publicar).
 *
 * Con `PRICING_V3_ACTIVATED = false` responde 404: rige el contrato v2 y
 * no se anuncian precios v3 antes de encender el modelo.
 */
export function createPublicPreciosRoutes(opts: {
  logger: Logger;
  lector: LectorConfiguracionComercial;
}) {
  const app = new Hono();

  app.get('/precios', async (c) => {
    if (!appConfig.PRICING_V3_ACTIVATED) {
      return c.json({ error: 'precios_no_publicados' }, 404);
    }
    try {
      const vigente = await withBusinessSpan(
        { name: 'pricing.precios_publicos.leer' },
        async (span) => {
          const v = await opts.lector.obtener();
          setResultAttributes(span, { 'booster.configuracion_comercial.version': v.version });
          return v;
        },
      );
      getBusinessCounter('pricing.precios_publicos_consultados').add(1);
      c.header('Cache-Control', 'public, max-age=60');
      return c.json({
        version: vigente.version,
        vigente_desde: vigente.vigenteDesde.toISOString(),
        // parse (no passthrough): una clave nueva en `servicios` no se
        // publica hasta que el schema público la incluya.
        servicios: serviciosPublicosSchema.parse(vigente.config.servicios),
      });
    } catch (err) {
      if (err instanceof SinConfiguracionPublicadaError) {
        opts.logger.error({ err }, 'precios públicos sin configuración publicada');
        return c.json({ error: 'sin_configuracion_publicada' }, 503);
      }
      throw err;
    }
  });

  return app;
}
