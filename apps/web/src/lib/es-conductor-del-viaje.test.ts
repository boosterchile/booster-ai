import { describe, expect, it } from 'vitest';
import { esConductorDelViaje } from './es-conductor-del-viaje.js';

const CONDUCTOR = 'user-conductor';
const ADMIN = 'user-admin';

describe('esConductorDelViaje', () => {
  it('el usuario asignado conduce el viaje', () => {
    expect(esConductorDelViaje(CONDUCTOR, CONDUCTOR)).toBe(true);
  });

  it('el administrador de la empresa no conduce el viaje de otro', () => {
    expect(esConductorDelViaje(ADMIN, CONDUCTOR)).toBe(false);
  });

  it('sin conductor asignado nadie conduce todavía', () => {
    expect(esConductorDelViaje(CONDUCTOR, null)).toBe(false);
    expect(esConductorDelViaje(CONDUCTOR, undefined)).toBe(false);
  });

  it('sin viewer no hay match', () => {
    expect(esConductorDelViaje(null, CONDUCTOR)).toBe(false);
    expect(esConductorDelViaje(undefined, CONDUCTOR)).toBe(false);
    expect(esConductorDelViaje('', CONDUCTOR)).toBe(false);
    expect(esConductorDelViaje(CONDUCTOR, '')).toBe(false);
  });
});
