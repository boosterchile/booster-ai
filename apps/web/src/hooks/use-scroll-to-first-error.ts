import { useEffect } from 'react';
import type { FieldErrors } from 'react-hook-form';

/**
 * Hace scroll suave + foco al primer campo con error después de un
 * intento de submit fallido. Mejora la UX en forms largos donde el
 * primer error puede quedar fuera del viewport.
 *
 * Estrategia para encontrar el elemento DOM:
 *   1. `document.getElementById(name)` — funciona si el FormField
 *      genera ids predecibles.
 *   2. `[name="${name}"]` — fallback usando el atributo `name` que
 *      `register('campo')` siempre setea.
 *
 * Para forms con campos anidados (`user.full_name`) el helper
 * navega el árbol de errores en orden de declaración del schema y
 * arma la path completa.
 *
 * Llamar desde el caller que ya tiene `formState.errors` y
 * `formState.submitCount` de `useForm`. El hook se dispara cada vez
 * que el submitCount cambia (incluso si los errors no cambiaron —
 * útil para reintentar scroll después de re-submit).
 */
export function useScrollToFirstError(errors: FieldErrors, submitCount: number): void {
  useEffect(() => {
    if (submitCount === 0) {
      return;
    }
    const firstPath = findFirstErrorPath(errors);
    if (!firstPath) {
      return;
    }
    const el =
      document.getElementById(firstPath) ??
      document.querySelector<HTMLElement>(`[name="${firstPath}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Pequeño delay para que el scroll inicie antes del foco — el
      // foco interrumpe el smooth scroll si se llama síncrono.
      setTimeout(() => el.focus({ preventScroll: true }), 50);
    }
  }, [errors, submitCount]);
}

/**
 * Recorre el árbol de errores de react-hook-form y devuelve la path
 * dot-notation del primer leaf con `message` (ej. `user.full_name`).
 * Devuelve null si no hay errores.
 */
function findFirstErrorPath(errors: unknown, prefix = ''): string | null {
  if (errors === null || typeof errors !== 'object') {
    return null;
  }
  const entries = Object.entries(errors as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key === 'ref' || key === 'type') {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && 'message' in value && 'type' in value) {
      return path;
    }
    const nested = findFirstErrorPath(value, path);
    if (nested) {
      return nested;
    }
  }
  return null;
}
