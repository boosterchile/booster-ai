import { Mic, MicOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useWakeWord } from '../../hooks/use-wake-word.js';
import { api } from '../../lib/api-client.js';
import { logger } from '../../lib/logger.js';
import type { StoppedDetector } from '../../services/stopped-detector.js';
import { emitirWakeWord } from '../../services/wake-word-bus.js';
import type { WakeWordController, WakeWordState } from '../../services/wake-word.js';

/**
 * ADR-036 / T10-22 — Banner del wake-word "Oye Booster" en /app/conductor.
 *
 * Se muestra cuando el flag global y la preferencia del conductor están
 * encendidos. Pide la config de Picovoice a `GET /me/wake-word` y, si está
 * disponible, monta el listener real con los gates de vehículo y pestaña.
 *
 * El texto refleja el estado real del micrófono: solo dice "Escuchando"
 * cuando el controller está en `listening`. Afirmar que escucha cuando no lo
 * hace (o al revés) sería mentirle al conductor sobre su privacidad.
 */

const configSchema = z.discriminatedUnion('disponible', [
  z.object({
    disponible: z.literal(true),
    access_key: z.string().min(1),
    keyword_url: z.string().url(),
    model_url: z.string().url(),
    sensibilidad: z.number().min(0).max(1),
  }),
  z.object({ disponible: z.literal(false), motivo: z.string() }),
]);

type ConfigWakeWord = Extract<z.infer<typeof configSchema>, { disponible: true }>;

function useConfigWakeWord(activo: boolean): ConfigWakeWord | null {
  const [config, setConfig] = useState<ConfigWakeWord | null>(null);
  useEffect(() => {
    if (!activo) {
      setConfig(null);
      return undefined;
    }
    let cancelado = false;
    api
      .get<unknown>('/me/wake-word')
      .then((raw) => {
        const parsed = configSchema.safeParse(raw);
        if (!parsed.success) {
          logger.warn({ issues: parsed.error.issues.length }, 'wake-word: config inválida');
          return;
        }
        if (!cancelado && parsed.data.disponible) {
          setConfig(parsed.data);
        }
      })
      .catch((err: unknown) => {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          'wake-word: no se pudo leer la config',
        );
      });
    return () => {
      cancelado = true;
    };
  }, [activo]);
  return config;
}

function textoDe(state: WakeWordState, hayConfig: boolean): { texto: string; escuchando: boolean } {
  if (!hayConfig) {
    return {
      texto:
        'Activaste “Oye Booster”. Todavía lo estamos preparando: por ahora el micrófono no se usa. Te avisaremos cuando esté disponible.',
      escuchando: false,
    };
  }
  switch (state) {
    case 'listening':
      return {
        texto: 'Escuchando “Oye Booster”. El audio no sale de tu teléfono.',
        escuchando: true,
      };
    case 'detected':
      return { texto: 'Te escucho: di tu comando.', escuchando: true };
    case 'paused':
      return {
        texto:
          '“Oye Booster” en pausa: se activa con el vehículo detenido y la app en pantalla. Ahora el micrófono no se usa.',
        escuchando: false,
      };
    case 'error':
      return {
        texto: '“Oye Booster” no pudo activarse. Revisa el permiso del micrófono en tu navegador.',
        escuchando: false,
      };
    case 'unavailable':
      return {
        texto: '“Oye Booster” no está disponible en este navegador. El micrófono no se usa.',
        escuchando: false,
      };
    default:
      return {
        texto: 'Preparando “Oye Booster”… el micrófono todavía no se usa.',
        escuchando: false,
      };
  }
}

export interface WakeWordBannerProps {
  /** Flag global `wake_word_voice_activated` y preferencia del conductor. */
  activo: boolean;
  /** Inyectables para tests. */
  crearController?: () => WakeWordController;
  crearDetector?: () => StoppedDetector;
}

export function WakeWordBanner({ activo, crearController, crearDetector }: WakeWordBannerProps) {
  const config = useConfigWakeWord(activo);
  const { state } = useWakeWord({
    enabled: activo && config !== null,
    accessKey: config?.access_key ?? '',
    keywordPath: config?.keyword_url ?? '',
    modelPath: config?.model_url ?? '',
    ...(config ? { sensitivity: config.sensibilidad } : {}),
    onWake: () => {
      if (!emitirWakeWord()) {
        logger.info({}, 'wake-word: detección sin botón de voz en pantalla');
      }
    },
    ...(crearController ? { crearController } : {}),
    ...(crearDetector ? { crearDetector } : {}),
  });

  if (!activo) {
    return null;
  }
  const { texto, escuchando } = textoDe(state, config !== null);
  const Icono = escuchando ? Mic : MicOff;
  return (
    <output
      className="mt-3 flex items-center gap-2 rounded-md border border-primary-200 bg-primary-50 p-2 text-primary-900 text-xs"
      data-testid="wake-word-active-banner"
      data-estado={config ? state : 'sin_config'}
    >
      <Icono className={`h-4 w-4 shrink-0 ${escuchando ? 'animate-pulse' : ''}`} aria-hidden />
      <span>{texto}</span>
    </output>
  );
}
