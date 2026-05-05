import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, passwordPolicySchema } from './password.js';

describe('passwordPolicySchema', () => {
  it('acepta una contraseña que cumple toda la política', () => {
    expect(passwordPolicySchema.safeParse('Booster1234').success).toBe(true);
    expect(passwordPolicySchema.safeParse('aA1bbbbb').success).toBe(true);
  });

  it('rechaza por longitud insuficiente', () => {
    const r = passwordPolicySchema.safeParse('Aa1bcde');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/8 caracteres/);
    }
  });

  it('rechaza si no tiene mayúscula', () => {
    const r = passwordPolicySchema.safeParse('booster1234');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/mayúscula/);
    }
  });

  it('rechaza si no tiene minúscula', () => {
    const r = passwordPolicySchema.safeParse('BOOSTER1234');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/minúscula/);
    }
  });

  it('rechaza si no tiene número', () => {
    const r = passwordPolicySchema.safeParse('BoosterBooster');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/número/);
    }
  });
});

describe('checkPasswordPolicy', () => {
  it('devuelve null para contraseña válida', () => {
    expect(checkPasswordPolicy('Booster1234')).toBe(null);
  });

  it('devuelve el primer mensaje cuando falla múltiples reglas', () => {
    // Falla longitud y números — el primero (longitud) es el que se reporta.
    const message = checkPasswordPolicy('Ab');
    expect(message).toMatch(/8 caracteres/);
  });

  it('devuelve mensaje específico cuando solo falta un criterio', () => {
    expect(checkPasswordPolicy('boosterbooster1')).toMatch(/mayúscula/);
    expect(checkPasswordPolicy('BOOSTERBOOSTER1')).toMatch(/minúscula/);
    expect(checkPasswordPolicy('BoosterBooster')).toMatch(/número/);
  });
});
