import { describe, expect, it } from 'vitest';
import {
  CLAVE_FIREBASE_MIN,
  consultarInvitacionCorreoResponseSchema,
  crearCuentaInvitacionResponseSchema,
  crearCuentaInvitacionSchema,
  invitacionCorreoCuentaErrorCodeSchema,
  invitarPersonalBoosterCorreoResponseSchema,
  invitarPersonalBoosterCorreoSchema,
  tipoInvitacionCorreoCuentaSchema,
} from './invitar-correo-cuenta.js';

/** ADR-093 / `.specs/auth-correo-clave-booster-stakeholder` §4–§6. */

const TOKEN = 'a'.repeat(43);

describe('invitarPersonalBoosterCorreoSchema', () => {
  it('normaliza el correo a minúsculas sin espacios', () => {
    expect(
      invitarPersonalBoosterCorreoSchema.parse({ email: '  Gerencia@BoosterChile.com ' }),
    ).toEqual({ email: 'gerencia@boosterchile.com' });
  });

  it.each([
    ['correo inválido', { email: 'no-es-correo' }],
    ['correo vacío', { email: '' }],
    ['sin email', {}],
  ])('rechaza %s', (_caso, body) => {
    expect(invitarPersonalBoosterCorreoSchema.safeParse(body).success).toBe(false);
  });
});

describe('invitarPersonalBoosterCorreoResponseSchema', () => {
  it('acepta la respuesta sin token ni clave', () => {
    const r = invitarPersonalBoosterCorreoResponseSchema.parse({
      ok: true,
      invitacion_id: '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d',
      email: 'gerencia@boosterchile.com',
      expira_en: '2026-11-23T12:00:00.000Z',
    });
    expect(r.ok).toBe(true);
    expect('token' in r).toBe(false);
  });
});

describe('crearCuentaInvitacionSchema', () => {
  const base = {
    token: TOKEN,
    full_name: '  Ana Soto ',
    password: 'Secreta99',
    password_confirm: 'Secreta99',
    rut: '12.345.678-5',
  };

  it('normaliza nombre y RUT; exige clave distinta de 6 dígitos', () => {
    const r = crearCuentaInvitacionSchema.parse(base);
    expect(r.full_name).toBe('Ana Soto');
    expect(r.rut).toBe('12345678-5');
    expect(r.password.length).toBeGreaterThanOrEqual(CLAVE_FIREBASE_MIN);
  });

  it('rechaza si las claves no coinciden', () => {
    const r = crearCuentaInvitacionSchema.safeParse({
      ...base,
      password_confirm: 'OtraClave1',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === 'password_confirm')).toBe(true);
  });

  it('rechaza clave de solo 6 dígitos (evita confusión con RUT+clave)', () => {
    expect(
      crearCuentaInvitacionSchema.safeParse({
        ...base,
        password: '123456',
        password_confirm: '123456',
      }).success,
    ).toBe(false);
  });

  it('rechaza token corto o nombre de un carácter', () => {
    expect(crearCuentaInvitacionSchema.safeParse({ ...base, token: 'corto' }).success).toBe(false);
    expect(crearCuentaInvitacionSchema.safeParse({ ...base, full_name: 'A' }).success).toBe(false);
  });
});

describe('consultarInvitacionCorreoResponseSchema + crear respuesta', () => {
  it('consulta trae email precargado y tipo', () => {
    expect(
      consultarInvitacionCorreoResponseSchema.parse({
        email: 'sandoval.felipe@gmail.com',
        tipo: 'personal_booster',
        expira_en: '2026-11-23T12:00:00.000Z',
      }).tipo,
    ).toBe('personal_booster');
  });

  it('creación puede devolver custom_token null', () => {
    expect(
      crearCuentaInvitacionResponseSchema.parse({
        ok: true,
        user_id: '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d',
        email: 'a@b.cl',
        tipo: 'personal_booster',
        custom_token: null,
      }).custom_token,
    ).toBeNull();
  });
});

describe('enums de error y tipo', () => {
  it('tipos de invitación', () => {
    expect(tipoInvitacionCorreoCuentaSchema.parse('personal_booster')).toBe('personal_booster');
    expect(tipoInvitacionCorreoCuentaSchema.parse('stakeholder')).toBe('stakeholder');
  });

  it('códigos de error conocidos', () => {
    for (const code of [
      'email_already_registered',
      'rut_already_registered',
      'invitacion_invalida',
      'invitacion_not_found',
    ] as const) {
      expect(invitacionCorreoCuentaErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
