import { describe, expect, it } from 'vitest';
import {
  clasificarVinculoPersona,
  cuentaYaActivada,
  invitacionesVigentes,
  personaPrevia,
} from './vinculo-persona.js';

describe('clasificarVinculoPersona', () => {
  it('cuenta con clave es activa aunque el uid siga en placeholder', () => {
    expect(
      clasificarVinculoPersona({
        firebaseUid: 'pending-rut:8601693-1',
        claveNumericaHash: 'hash',
        activationPinHash: 'pin',
      }),
    ).toBe('cuenta_activa');
  });

  it('uid real es cuenta activa', () => {
    expect(
      clasificarVinculoPersona({
        firebaseUid: 'fb-real',
        claveNumericaHash: null,
        activationPinHash: null,
      }),
    ).toBe('cuenta_activa');
  });

  it('placeholder con pin conserva el código', () => {
    expect(
      clasificarVinculoPersona({
        firebaseUid: 'pending-rut:8601693-1',
        claveNumericaHash: null,
        activationPinHash: 'pin',
      }),
    ).toBe('codigo_vigente');
  });

  it('placeholder sin pin puede recibir el primero', () => {
    expect(
      clasificarVinculoPersona({
        firebaseUid: 'pending-rut:8601693-1',
        claveNumericaHash: null,
        activationPinHash: null,
      }),
    ).toBe('provisoria_sin_codigo');
  });
});

describe('cuentaYaActivada', () => {
  it('placeholder sin clave todavía se puede activar', () => {
    expect(
      cuentaYaActivada({ firebaseUid: 'pending-rut:8601693-1', claveNumericaHash: null }),
    ).toBe(false);
  });

  it('clave presente bloquea una segunda activación', () => {
    expect(
      cuentaYaActivada({ firebaseUid: 'pending-rut:8601693-1', claveNumericaHash: 'hash' }),
    ).toBe(true);
  });
});

describe('invitacionesVigentes', () => {
  it('deja fuera la invitación de más de 7 días y conserva la reciente', () => {
    const reciente = { id: 'nueva', invitedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) };
    const vieja = { id: 'vieja', invitedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) };
    expect(invitacionesVigentes([vieja, reciente]).map((row) => row.id)).toEqual(['nueva']);
  });
});

describe('personaPrevia', () => {
  const vinculo = new Date('2026-05-01T12:00:00Z');
  it('persona creada en la misma alta: no es previa', () => {
    expect(personaPrevia(new Date(vinculo.getTime() - 30_000), vinculo)).toBe(false);
    expect(personaPrevia(vinculo, vinculo)).toBe(false);
  });
  it('persona creada antes del vínculo: es previa', () => {
    expect(personaPrevia(new Date(vinculo.getTime() - 2 * 86_400_000), vinculo)).toBe(true);
  });
  it('sin fechas: es previa', () => {
    expect(personaPrevia(null, vinculo)).toBe(true);
    expect(personaPrevia(vinculo, undefined)).toBe(true);
  });
});
