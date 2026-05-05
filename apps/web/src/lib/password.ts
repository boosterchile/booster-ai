import { z } from 'zod';

/**
 * Política de contraseña Booster: mínimo 8 caracteres, con al menos
 * una mayúscula, una minúscula y un número.
 *
 * Aplica a operaciones que el usuario controla activamente: cambiar
 * contraseña desde /perfil. El registro y el link de email+password
 * existente siguen con el mínimo de 6 chars de Firebase hasta que se
 * eleven (FIX-011 Parte A solo cubre el cambio).
 *
 * Los mensajes son los que se muestran al usuario en el form, así que
 * están en tuteo y describen la regla, no el detalle técnico.
 */
export const passwordPolicySchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .regex(/[A-Z]/, 'Necesita al menos una mayúscula.')
  .regex(/[a-z]/, 'Necesita al menos una minúscula.')
  .regex(/\d/, 'Necesita al menos un número.');

/**
 * Devuelve el primer mensaje de error para un input dado, o null si
 * cumple la política. Útil para mostrar inline mientras el user tipea
 * sin tener que hacer un safeParse completo en cada keystroke.
 */
export function checkPasswordPolicy(input: string): string | null {
  const result = passwordPolicySchema.safeParse(input);
  if (result.success) {
    return null;
  }
  return result.error.issues[0]?.message ?? 'Contraseña inválida.';
}
