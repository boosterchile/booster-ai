import type { Context } from 'hono';

export const ROLES_COMERCIALES = ['dueno', 'admin'] as const;

/**
 * Devuelve un 403 `forbidden_role` si el rol de la membresía activa no está
 * en `permitidos`; `null` si puede seguir. Mismo formato que la asignación
 * de conductor en assignments.ts.
 */
export function exigirRol(
  c: Context,
  role: string,
  permitidos: readonly string[],
): Response | null {
  if (permitidos.includes(role)) {
    return null;
  }
  return c.json({ error: 'forbidden_role', code: 'forbidden_role', role }, 403);
}
