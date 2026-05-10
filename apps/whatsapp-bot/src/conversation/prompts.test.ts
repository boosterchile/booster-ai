import { describe, expect, it } from 'vitest';
import { CARGO_TYPE_MENU_MAP, PROMPTS } from './prompts.js';

describe('PROMPTS', () => {
  it('greeting menciona Booster AI y opciones 1/2', () => {
    expect(PROMPTS.greeting).toContain('Booster AI');
    expect(PROMPTS.greeting).toContain('1');
    expect(PROMPTS.greeting).toContain('2');
    expect(PROMPTS.greeting).toContain('cancelar');
  });

  it('askOrigin menciona dirección u origen', () => {
    expect(PROMPTS.askOrigin).toMatch(/dirección|origen/i);
  });

  it('askDestination menciona destino', () => {
    expect(PROMPTS.askDestination).toMatch(/dirección|llegar/i);
  });

  it('askCargoType menciona los principales tipos de carga', () => {
    expect(PROMPTS.askCargoType).toMatch(/Carga seca/);
    expect(PROMPTS.askCargoType).toMatch(/Perecible/);
    expect(PROMPTS.askCargoType).toMatch(/Refrigerada/);
    expect(PROMPTS.askCargoType).toMatch(/Congelada/);
    expect(PROMPTS.askCargoType).toMatch(/Frágil/);
    expect(PROMPTS.askCargoType).toMatch(/Peligrosa/);
    expect(PROMPTS.askCargoType).toMatch(/Ganado/);
    expect(PROMPTS.askCargoType).toMatch(/Otro/);
  });

  it('askPickupDate menciona retiro', () => {
    expect(PROMPTS.askPickupDate).toMatch(/retiren|cuándo/i);
  });

  it('confirmed interpola el tracking code', () => {
    const code = 'TR-ABC-123';
    expect(PROMPTS.confirmed(code)).toContain(code);
    expect(PROMPTS.confirmed(code)).toMatch(/seguimiento/i);
  });

  it('cancelled, menuLookupNotImplemented, invalidMenuOption, invalidCargoOption, unknownCommand son strings no vacíos', () => {
    expect(PROMPTS.cancelled.length).toBeGreaterThan(0);
    expect(PROMPTS.menuLookupNotImplemented.length).toBeGreaterThan(0);
    expect(PROMPTS.invalidMenuOption.length).toBeGreaterThan(0);
    expect(PROMPTS.invalidCargoOption.length).toBeGreaterThan(0);
    expect(PROMPTS.unknownCommand.length).toBeGreaterThan(0);
  });
});

describe('CARGO_TYPE_MENU_MAP', () => {
  it('mapea las 11 opciones del menú a enum values del schema', () => {
    expect(CARGO_TYPE_MENU_MAP['1']).toBe('carga_seca');
    expect(CARGO_TYPE_MENU_MAP['2']).toBe('perecible');
    expect(CARGO_TYPE_MENU_MAP['3']).toBe('refrigerada');
    expect(CARGO_TYPE_MENU_MAP['4']).toBe('congelada');
    expect(CARGO_TYPE_MENU_MAP['5']).toBe('fragil');
    expect(CARGO_TYPE_MENU_MAP['6']).toBe('peligrosa');
    expect(CARGO_TYPE_MENU_MAP['7']).toBe('liquida');
    expect(CARGO_TYPE_MENU_MAP['8']).toBe('construccion');
    expect(CARGO_TYPE_MENU_MAP['9']).toBe('agricola');
    expect(CARGO_TYPE_MENU_MAP['10']).toBe('ganado');
    expect(CARGO_TYPE_MENU_MAP['0']).toBe('otra');
  });

  it('inputs fuera del rango devuelven undefined', () => {
    expect(CARGO_TYPE_MENU_MAP['11']).toBeUndefined();
    expect(CARGO_TYPE_MENU_MAP.foo).toBeUndefined();
  });
});
