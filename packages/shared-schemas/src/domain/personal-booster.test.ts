import { describe, expect, it } from 'vitest';
import {
  CODIGO_CUENTA_PERSONAL_BOOSTER,
  CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS,
  CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS,
  MENSAJE_CUENTA_PERSONAL_BOOSTER,
  altaPersonalBoosterResponseSchema,
  altaPersonalBoosterSchema,
  confirmarAccesoBoosterErrorCodeSchema,
  confirmarAccesoBoosterResponseSchema,
  confirmarAccesoBoosterSchema,
  listaPersonalBoosterResponseSchema,
  personalBoosterErrorCodeSchema,
  personalBoosterEstadoSchema,
  quitarAccesoPersonalBoosterResponseSchema,
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
  it('nombra los siete rechazos de las rutas del personal', () => {
    expect(personalBoosterErrorCodeSchema.options).toEqual([
      'rut_mismatch',
      'rut_already_registered',
      'email_already_registered',
      'already_activated',
      'personal_not_found',
      'en_lista_respaldo',
      'ultimo_acceso',
    ]);
  });
});

// `.specs/acceso-panel-plataforma` SC4.
describe('quitarAccesoPersonalBoosterResponseSchema', () => {
  it('trae ok y el user_id, sin más campos', () => {
    expect(quitarAccesoPersonalBoosterResponseSchema.parse({ ok: true, user_id: USER_ID })).toEqual(
      {
        ok: true,
        user_id: USER_ID,
      },
    );
    expect(
      quitarAccesoPersonalBoosterResponseSchema.safeParse({ ok: true, user_id: 'no-uuid' }).success,
    ).toBe(false);
  });
});

// `.specs/acceso-panel-plataforma` SC7 y SC8.
describe('cuenta del personal en los flujos de empresa', () => {
  it('el código del 409 y el mensaje que muestra la web', () => {
    expect(CODIGO_CUENTA_PERSONAL_BOOSTER).toBe('cuenta_personal_booster');
    expect(MENSAJE_CUENTA_PERSONAL_BOOSTER).toBe(
      'Esta persona es del personal de Booster; su cuenta se gestiona desde Booster.',
    );
  });
});

// `.specs/confirmar-acceso-booster` §4 (T1).
describe('confirmación del acceso al panel — contratos', () => {
  const base = { ok: true, user_id: USER_ID, en_lista: false };

  it('el estado pendiente_confirmacion es parte de la lista del personal', () => {
    expect(personalBoosterEstadoSchema.options).toEqual([
      'sin_cuenta',
      'pendiente_activacion',
      'pendiente_confirmacion',
      'activa',
    ]);
    const r = listaPersonalBoosterResponseSchema.parse({
      personal: [
        {
          email: 'ana.soto@boosterchile.com',
          en_lista: false,
          user_id: USER_ID,
          nombre: 'Ana Soto',
          rut: '12345678-5',
          estado: 'pendiente_confirmacion',
          expira_en: VENCE,
          ultimo_login_en: null,
        },
      ],
    });
    expect(r.personal[0]?.estado).toBe('pendiente_confirmacion');
  });

  it('el alta cuenta_activa_por_confirmar trae el código y su vencimiento', () => {
    expect(vinculoPersonalBoosterSchema.options).toContain('cuenta_activa_por_confirmar');
    const vinculo = 'cuenta_activa_por_confirmar';
    expect(
      altaPersonalBoosterResponseSchema.safeParse({
        ...base,
        vinculo,
        codigo_activacion: '123456',
        expira_en: VENCE,
      }).success,
    ).toBe(true);
    expect(
      altaPersonalBoosterResponseSchema.safeParse({
        ...base,
        vinculo,
        codigo_activacion: null,
        expira_en: VENCE,
      }).success,
    ).toBe(false);
    expect(
      altaPersonalBoosterResponseSchema.safeParse({
        ...base,
        vinculo,
        codigo_activacion: '123456',
        expira_en: null,
      }).success,
    ).toBe(false);
  });

  it('la re-emisión dice qué código emitió; sin el campo vale provisoria_sin_codigo', () => {
    const reemision = {
      ok: true,
      user_id: USER_ID,
      codigo_activacion: '654321',
      expira_en: VENCE,
      en_lista: false,
    };
    expect(reemitirCodigoPersonalBoosterResponseSchema.parse(reemision).vinculo).toBe(
      'provisoria_sin_codigo',
    );
    expect(
      reemitirCodigoPersonalBoosterResponseSchema.parse({
        ...reemision,
        vinculo: 'cuenta_activa_por_confirmar',
      }).vinculo,
    ).toBe('cuenta_activa_por_confirmar');
    for (const vinculo of ['nueva', 'cuenta_activa', 'codigo_vigente', 'otra']) {
      expect(
        reemitirCodigoPersonalBoosterResponseSchema.safeParse({ ...reemision, vinculo }).success,
      ).toBe(false);
    }
  });

  it('el body de la confirmación es un código de 6 dígitos', () => {
    expect(confirmarAccesoBoosterSchema.parse({ codigo: '012345' })).toEqual({ codigo: '012345' });
    for (const codigo of ['12345', '1234567', 'abcdef', '12 345', '']) {
      const r = confirmarAccesoBoosterSchema.safeParse({ codigo });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('El código tiene 6 números');
    }
    const sinCodigo = confirmarAccesoBoosterSchema.safeParse({});
    expect(sinCodigo.error?.issues[0]?.message).toBe('Completa este campo');
  });

  it('la respuesta trae ok y el user_id; el rechazo es uno solo', () => {
    expect(confirmarAccesoBoosterResponseSchema.parse({ ok: true, user_id: USER_ID })).toEqual({
      ok: true,
      user_id: USER_ID,
    });
    expect(
      confirmarAccesoBoosterResponseSchema.safeParse({ ok: true, user_id: 'no-uuid' }).success,
    ).toBe(false);
    expect(confirmarAccesoBoosterErrorCodeSchema.options).toEqual(['codigo_invalido']);
  });

  it('vigencia de 24 horas y cinco intentos', () => {
    expect(CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS).toBe(24);
    expect(CONFIRMACION_ACCESO_BOOSTER_MAX_INTENTOS).toBe(5);
  });
});
