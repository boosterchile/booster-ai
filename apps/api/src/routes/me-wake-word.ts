import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';

/**
 * GET /me/wake-word — config de Picovoice Porcupine para la PWA del
 * conductor (ADR-036, T10-22).
 *
 * La AccessKey y las URLs de los modelos se entregan en runtime para que el
 * PO active el wake-word sin rebuild de la web: carga la clave en Secret
 * Manager, publica los modelos, enciende `WAKE_WORD_VOICE_ACTIVATED`.
 *
 * La AccessKey de Picovoice para web está pensada para vivir en el navegador
 * (el SDK la usa en el cliente); este endpoint autenticado evita dejarla en
 * el bundle estático. Si falta algo, responde `disponible: false` con el
 * motivo y nunca la clave.
 */

export interface ConfigWakeWord {
  activado: boolean;
  accessKey: string | undefined;
  keywordUrl: string | undefined;
  modelUrl: string | undefined;
  sensibilidad: number;
}

type Motivo = 'flag_apagado' | 'sin_access_key' | 'sin_modelo';

/** Mientras siga el placeholder de Terraform, no hay clave real. */
const PREFIJO_PLACEHOLDER = 'ROTATE_ME_';

type Resolucion =
  | { disponible: true; accessKey: string; keywordUrl: string; modelUrl: string }
  | { disponible: false; motivo: Motivo };

function resolver(config: ConfigWakeWord): Resolucion {
  if (!config.activado) {
    return { disponible: false, motivo: 'flag_apagado' };
  }
  const { accessKey, keywordUrl, modelUrl } = config;
  if (!accessKey || accessKey.startsWith(PREFIJO_PLACEHOLDER)) {
    return { disponible: false, motivo: 'sin_access_key' };
  }
  if (!keywordUrl || !modelUrl) {
    return { disponible: false, motivo: 'sin_modelo' };
  }
  return { disponible: true, accessKey, keywordUrl, modelUrl };
}

export function createMeWakeWordRoutes(opts: { logger: Logger; config: ConfigWakeWord }) {
  const app = new Hono();

  app.get('/wake-word', async (c) => {
    if (!c.get('userContext')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return await withBusinessSpan({ name: 'wake_word.config' }, async (span) => {
      const r = resolver(opts.config);
      setResultAttributes(span, {
        'booster.wake_word.disponible': r.disponible,
        'booster.wake_word.motivo': r.disponible ? undefined : r.motivo,
      });
      getBusinessCounter('wake_word.config_servida').add(1, { disponible: r.disponible });
      c.header('Cache-Control', 'private, no-store');
      if (!r.disponible) {
        opts.logger.debug({ motivo: r.motivo }, 'wake-word: config no disponible');
        return c.json({ disponible: false, motivo: r.motivo });
      }
      return c.json({
        disponible: true,
        access_key: r.accessKey,
        keyword_url: r.keywordUrl,
        model_url: r.modelUrl,
        sensibilidad: opts.config.sensibilidad,
      });
    });
  });

  return app;
}
