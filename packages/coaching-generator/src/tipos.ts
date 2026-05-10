/**
 * Tipos compartidos del package @booster-ai/coaching-generator.
 *
 * Espejo del breakdown que produce @booster-ai/driver-scoring (PR-I3).
 * Si cambia un lado, actualizar el otro.
 */

import type { NivelScore } from './nivel-score-types.js';

export interface DesgloseScore {
  aceleracionesBruscas: number;
  frenadosBruscos: number;
  curvasBruscas: number;
  excesosVelocidad: number;
  eventosPorHora: number;
}

export interface ContextoTrip {
  /** Distancia recorrida en km. Para personalizar mensaje (ej. "en 350 km"). */
  distanciaKm: number;
  /** Duración del viaje en minutos. */
  duracionMinutos: number;
  /** Tipo de carga (e.g. "carga_seca"). Para tono ("frágil", "perecible" pide mayor cuidado). */
  tipoCarga: string;
}

export interface ParametrosCoaching {
  /** Score numérico 0–100. */
  score: number;
  nivel: NivelScore;
  desglose: DesgloseScore;
  trip: ContextoTrip;
}

/** Foco principal del feedback — para analytics + UI tagging. */
export type FocoPrincipal =
  | 'felicitacion' // sin eventos relevantes, score alto
  | 'frenado'
  | 'aceleracion'
  | 'curvas'
  | 'velocidad'
  | 'multiple'; // varios tipos a la vez

export interface ResultadoCoaching {
  /**
   * Mensaje en español, 2–3 frases, ≤ 280 chars (cabe en SMS / WhatsApp
   * template). Tono: respetuoso, accionable, sin culpabilizar.
   */
  mensaje: string;
  /** Foco del feedback para tagging y analytics. */
  focoPrincipal: FocoPrincipal;
  /** Cómo se generó: 'gemini' | 'plantilla' (fallback determinístico). */
  fuente: 'gemini' | 'plantilla';
  /** Modelo Gemini usado (si fuente='gemini'). undefined si plantilla. */
  modelo?: string;
}

/**
 * Función inyectable que el caller provee para llamar al modelo.
 * Recibe el prompt formateado (system + user) y devuelve el texto
 * generado o un error. Diseño deliberadamente abstracto: hoy lo
 * implementamos contra Gemini API; mañana se podría swappear a
 * Vertex AI / Anthropic / local model sin tocar la lógica de
 * coaching.
 *
 * Retornar `null` o throw indica fallo → el caller cae al template
 * determinístico automáticamente.
 */
export type GenerarTextoFn = (params: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string | null>;
