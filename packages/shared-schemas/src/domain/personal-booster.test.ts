import { describe, expect, it } from 'vitest';
import {
  altaPersonalBoosterResponseSchema,
  altaPersonalBoosterSchema,
  listaPersonalBoosterResponseSchema,
  personalBoosterErrorCodeSchema,
  personalBoosterEstadoSchema,
  reemitirCodigoPersonalBoosterResponseSchema,
  vinculoPersonalBoosterSchema,
} from './personal-booster.js';

/** `.specs/alta-personal-booster/spec.md` §4 — contratos del alta del personal. */

const USER_ID = '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const VENCE = '2026-11-06T15:00:00.000Z';

describe('altaPersonalBoosterSchema', () => {
  it('normaliza el correo a minúsculas sin espacios y el RUT a su forma canónica', () => {
    const r = altaPersonalBoosterSchema.parse({
      email: '  Ana.Soto@BoosterChile.com ',
      full_name: '  Ana Soto ',
      rut: '12.345.678-5',
    });
    expect(r).toEqual({
      email: 'ana.soto@boosterchile.com',
      full_name: 'Ana Soto',
      rut: '12345678-5',
    });
  });

  it.each([
    ['RUT con dígito verificador inválido', { rut: '12345678-9' }],
    ['RUT con formato inválido', { rut: '123' }],
    ['correo inválido', { email: 'no-es-correo' }],
    ['correo de más de 255 caracteres', { email: `${'a'.repeat(251)}@b.cl` }],
    ['nombre de un carácter', { full_name: 'A' }],
    ['nombre de solo espacios', { full_name: '   ' }],
    ['nombre de más de 200 caracteres', { full_name: 'a'.repeat(201) }],
  ])('rechaza %s', (_caso, cambio) => {
    const base = { email: 'ana.soto@boosterchile.com', full_name: 'Ana Soto', rut: '12345678-5' };
    expect(altaPersonalBoosterSchema.safeParse({ ...base, ...cambio }).success).toBe(false);
  });

  it('exige los tres campos', () => {
    expect(altaPersonalBoosterSchema.safeParse({ email: 'a@b.cl', full_name: 'Ana' }).success).toBe(
      false,
    );
  });

  it.each([
    ['falta el correo', { email: undefined }, 'email', 'Completa este campo'],
    ['el correo es inválido', { email: 'no-es-correo' }, 'email', 'Ingresa un correo válido'],
    [
      'el correo es largo',
      { email: `${'a'.repeat(251)}@b.cl` },
      'email',
      'Usa como máximo 255 caracteres',
    ],
    ['falta el nombre', { full_name: undefined }, 'full_name', 'Completa este campo'],
    ['el nombre es corto', { full_name: ' A ' }, 'full_name', 'Escribe al menos 2 caracteres'],
    [
      'el nombre es largo',
      { full_name: 'a'.repeat(201) },
      'full_name',
      'Usa como máximo 200 caracteres',
    ],
  ])('responde en español cuando %s', (_caso, cambio, campo, mensaje) => {
    const base = { email: 'ana.soto@boosterchile.com', full_name: 'Ana Soto', rut: '12345678-5' };
    const r = altaPersonalBoosterSchema.safeParse({ ...base, ...cambio });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === campo)?.message).toBe(mensaje);
  });
});

describe('listaPersonalBoosterResponseSchema', () => {
  it('acepta los tres estados con sus campos nulos', () => {
    const r = listaPersonalBoosterResponseSchema.parse({
      personal: [
        {
          email: 'ana.soto@boosterchile.com',
          en_lista: true,
          user_id: USER_ID,
          nombre: 'Ana Soto',
          rut: '12345678-5',
          estado: 'pendiente_activacion',
          expira_en: VENCE,
          ultimo_login_en: null,
        },
        {
          email: 'bruno.diaz@boosterchile.com',
          en_lista: true,
          user_id: null,
          nombre: null,
          rut: null,
          estado: 'sin_cuenta',
          expira_en: null,
          ultimo_login_en: null,
        },
        {
          email: 'dev@boosterchile.com',
          en_lista: true,
          user_id: USER_ID,
          nombre: 'Felipe Vicencio',
          rut: '11111111-1',
          estado: 'activa',
          expira_en: null,
          ultimo_login_en: '2026-10-29T13:00:00.000Z',
        },
      ],
    });
    expect(r.personal).toHaveLength(3);
  });

  it('rechaza un estado desconocido', () => {
    expect(personalBoosterEstadoSchema.safeParse('suspendida').success).toBe(false);
  });
});

describe('altaPersonalBoosterResponseSchema', () => {
  const base = { ok: true, user_id: USER_ID, en_lista: true };

  it.each([
    ['nueva', { codigo_activacion: '123456', expira_en: VENCE }],
    ['provisoria_sin_codigo', { codigo_activacion: '123456', expira_en: VENCE }],
    ['codigo_vigente', { codigo_activacion: null, expira_en: VENCE }],
    ['codigo_vigente', { codigo_activacion: null, expira_en: null }],
    ['cuenta_activa', { codigo_activacion: null, expira_en: null }],
  ])('acepta %s con %o', (vinculo, resto) => {
    expect(
      altaPersonalBoosterResponseSchema.safeParse({ ...base, vinculo, ...resto }).success,
    ).toBe(true);
  });

  it.each([
    ['nueva sin código', 'nueva', { codigo_activacion: null, expira_en: VENCE }],
    ['nueva sin vencimiento', 'nueva', { codigo_activacion: '123456', expira_en: null }],
    [
      'provisoria_sin_codigo sin código',
      'provisoria_sin_codigo',
      { codigo_activacion: null, expira_en: null },
    ],
    [
      'codigo_vigente con código',
      'codigo_vigente',
      { codigo_activacion: '123456', expira_en: VENCE },
    ],
    [
      'cuenta_activa con código',
      'cuenta_activa',
      { codigo_activacion: '123456', expira_en: VENCE },
    ],
    [
      'cuenta_activa con vencimiento',
      'cuenta_activa',
      { codigo_activacion: null, expira_en: VENCE },
    ],
    ['código que no es de 6 dígitos', 'nueva', { codigo_activacion: '12345', expira_en: VENCE }],
  ])('rechaza %s', (_caso, vinculo, resto) => {
    expect(
      altaPersonalBoosterResponseSchema.safeParse({ ...base, vinculo, ...resto }).success,
    ).toBe(false);
  });

  it('rechaza un vínculo desconocido', () => {
    expect(vinculoPersonalBoosterSchema.safeParse('otra').success).toBe(false);
  });
});

describe('reemitirCodigoPersonalBoosterResponseSchema', () => {
  it('exige el código y su vencimiento', () => {
    const ok = {
      ok: true,
      user_id: USER_ID,
      codigo_activacion: '654321',
      expira_en: VENCE,
      en_lista: false,
    };
    expect(reemitirCodigoPersonalBoosterResponseSchema.safeParse(ok).success).toBe(true);
    expect(
      reemitirCodigoPersonalBoosterResponseSchema.safeParse({ ...ok, codigo_activacion: null })
        .success,
    ).toBe(false);
    expect(
      reemitirCodigoPersonalBoosterResponseSchema.safeParse({ ...ok, expira_en: null }).success,
    ).toBe(false);
  });
});

describe('personalBoosterErrorCodeSchema', () => {
  it('nombra los cinco rechazos de las rutas del personal', () => {
    expect(personalBoosterErrorCodeSchema.options).toEqual([
      'rut_mismatch',
      'rut_already_registered',
      'email_already_registered',
      'already_activated',
      'personal_not_found',
    ]);
  });
});
