import type { RotarClaveInput } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * ADR-035 Wave 4 PR 3 — Mutation para setear o rotar la clave numérica
 * del usuario actual. Llama `POST /me/clave-numerica`.
 *
 * Casos cubiertos:
 *   - First-rotation: `clave_anterior = null` (usuario legacy migrando).
 *   - Rotation: `clave_anterior` matchea hash actual.
 *
 * Invalida `/me` automáticamente al success → `has_clave_numerica`
 * pasa a `true` en el cache y el modal forzado se cierra.
 *
 * Errores:
 *   - 403 invalid_clave_anterior — clave anterior incorrecta.
 *   - 404 user_not_found — caso raro, sesión Firebase activa pero user
 *     eliminado.
 *   - 400 invalid_body — Zod validation (clave_nueva no son 6 dígitos).
 */
export function useRotarClave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RotarClaveInput): Promise<void> => {
      await api.post<void>('/me/clave-numerica', input);
    },
    onSuccess: () => {
      // /me ahora devolverá has_clave_numerica=true.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/**
 * Devuelve mensaje humano para un error de rotación. Maneja los códigos
 * conocidos del backend; falls back a "error inesperado" para todo lo
 * demás. Útil para los componentes UI que muestren el error inline.
 */
export function humanizeRotarClaveError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'invalid_clave_anterior' || err.status === 403) {
      return 'La clave anterior no es correcta.';
    }
    if (err.status === 404) {
      return 'No encontramos tu cuenta. Vuelve a iniciar sesión.';
    }
    if (err.status === 400) {
      return 'La nueva clave debe ser exactamente 6 dígitos numéricos.';
    }
    return `Error inesperado (${err.status}). Intenta de nuevo.`;
  }
  return (err as Error).message;
}
