import { describe, expect, it } from 'vitest';
import { invitarMiembroSchema } from '../auth.js';
import { invitarMiembroEmpresaSchema } from '../domain/empresa.js';
import { signupRequestSchema } from '../domain/signup-request.js';
import { empresaOnboardingInputSchema } from '../onboarding.js';
import { siteIdentitySchema } from '../site-settings.js';

const mensaje = (
  r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  campo: string,
) => r.error?.issues.find((i) => i.path.join('.') === campo)?.message;

describe('mensajes de validación en español', () => {
  it.each([
    [invitarMiembroSchema, {}, 'email', 'Completa este campo'],
    [invitarMiembroSchema, { email: 'a@b' }, 'email', 'Ingresa un correo válido'],
    [invitarMiembroSchema, { full_name: 'a' }, 'full_name', 'Escribe al menos 2 caracteres'],
    [invitarMiembroSchema, { rol: 'x' }, 'rol', 'Elige una opción válida'],
    [invitarMiembroSchema, {}, 'rol', 'Completa este campo'],
    [invitarMiembroSchema, {}, 'rut', 'Completa este campo'],
    [
      invitarMiembroEmpresaSchema,
      { full_name: 'x'.repeat(201) },
      'full_name',
      'Usa como máximo 200 caracteres',
    ],
    [
      signupRequestSchema.pick({ nombreCompleto: true }),
      { nombreCompleto: '' },
      'nombreCompleto',
      'Completa este campo',
    ],
    [
      empresaOnboardingInputSchema,
      { empresa: { contact_email: 'no' } },
      'empresa.contact_email',
      'Ingresa un correo válido',
    ],
    [
      siteIdentitySchema,
      { logo_url: 'logo' },
      'logo_url',
      'Ingresa una URL válida, como https://…',
    ],
  ])('caso %#', (schema, input, campo, esperado) => {
    expect(mensaje(schema.safeParse(input) as never, campo as string)).toBe(esperado);
  });
});
