import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Coaching IA — Phase 3 PR-J3.
 * Consume GET /assignments/:id/coaching (PR-J2). Generado post-entrega
 * por @booster-ai/coaching-generator usando Gemini API o fallback de
 * plantilla determinística.
 */
export type CoachingFoco =
  | 'felicitacion'
  | 'frenado'
  | 'aceleracion'
  | 'curvas'
  | 'velocidad'
  | 'multiple';

export type CoachingFuente = 'gemini' | 'plantilla';

export type CoachingResponse =
  | {
      trip_id: string;
      message: string;
      focus: CoachingFoco;
      source: CoachingFuente;
      model: string | null;
      generated_at: string;
      status: 'disponible';
    }
  | {
      trip_id: string;
      message: null;
      focus: null;
      source: null;
      status: 'no_disponible';
      reason: string;
    };

export function useCoaching(assignmentId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<CoachingResponse>({
    queryKey: ['assignment', 'coaching', assignmentId],
    queryFn: () => api.get<CoachingResponse>(`/assignments/${assignmentId}/coaching`),
    enabled: opts.enabled ?? true,
    // Coaching post-entrega es inmutable salvo regeneración manual.
    // Cache largo para no re-pegar al endpoint en cada navegación.
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Behavior score de un trip — Phase 2 PR-I5.
 * Consume GET /assignments/:id/behavior-score (Phase 2 PR-I4).
 *
 * Espejo del shape del response del api. Si en una iteración futura
 * agregamos campos al endpoint, actualizar acá también o (mejor)
 * mover a shared-schemas.
 */
export type NivelScore = 'excelente' | 'bueno' | 'regular' | 'malo';

export interface BehaviorScoreBreakdown {
  aceleracionesBruscas: number;
  frenadosBruscos: number;
  curvasBruscas: number;
  excesosVelocidad: number;
  penalizacionTotal: number;
  eventosPorHora: number;
}

export type BehaviorScoreResponse =
  | {
      trip_id: string;
      score: number;
      nivel: NivelScore;
      breakdown: BehaviorScoreBreakdown;
      calculated_at: string;
      status: 'disponible';
    }
  | {
      trip_id: string;
      score: null;
      nivel: null;
      breakdown: null;
      status: 'no_disponible';
      reason: string;
    };

export function useBehaviorScore(assignmentId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<BehaviorScoreResponse>({
    queryKey: ['assignment', 'behavior-score', assignmentId],
    queryFn: () => api.get<BehaviorScoreResponse>(`/assignments/${assignmentId}/behavior-score`),
    enabled: opts.enabled ?? true,
    // El score post-entrega NO cambia salvo recálculo manual. Cache largo.
    staleTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      // 404 → assignment no existe; no reintentar.
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
