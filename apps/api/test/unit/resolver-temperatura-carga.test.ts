import { describe, expect, it } from 'vitest';
import {
  SANITY_TEMP_MIN,
  extraerRaw72,
  resolverTemperaturaCarga,
  temperaturaConstanteCero,
} from '../../src/routes/vehiculos.js';

const TS = new Date('2026-07-06T10:00:00Z');

describe('extraerRaw72', () => {
  it('lee el crudo IO 72 numérico', () => {
    expect(extraerRaw72({ '72': 0 })).toBe(0);
    expect(extraerRaw72({ '72': 55 })).toBe(55);
  });
  it('ausente / no-numérico / boundary → null', () => {
    expect(extraerRaw72({})).toBeNull();
    expect(extraerRaw72(null)).toBeNull();
    expect(extraerRaw72('garbage')).toBeNull();
    expect(extraerRaw72({ '72': 'x' })).toBeNull();
  });
});

describe('temperaturaConstanteCero (sanity de varianza)', () => {
  const zeros = (n: number) => Array.from({ length: n }, () => 0);
  it(`< ${SANITY_TEMP_MIN} lecturas → false (no dispara en device recién online)`, () => {
    expect(temperaturaConstanteCero([])).toBe(false);
    expect(temperaturaConstanteCero(zeros(SANITY_TEMP_MIN - 1))).toBe(false);
  });
  it(`>= ${SANITY_TEMP_MIN} lecturas TODAS 0 → true (sonda no cableada)`, () => {
    expect(temperaturaConstanteCero(zeros(SANITY_TEMP_MIN))).toBe(true);
    expect(temperaturaConstanteCero(zeros(20))).toBe(true);
  });
  it('una sola lectura no-cero → false (hay varianza → sonda real)', () => {
    expect(temperaturaConstanteCero([...zeros(19), 3])).toBe(false);
  });
});

describe('resolverTemperaturaCarga — gating por provisioning', () => {
  it('flag=false → SIEMPRE null, aunque el crudo sea 0 (0°C no se infiere del valor)', () => {
    expect(
      resolverTemperaturaCarga({
        ioData: { '72': 0 },
        timestampDevice: TS,
        tieneSensor: false,
        recent72: [],
      }),
    ).toEqual({
      temperatura_c: null,
      temperatura_registrada_en: null,
      temperatura_sensor_sospechoso: false,
    });
  });

  it('flag=false → null aunque haya un valor real (55 → sería 5.5°C, pero sin sonda cableada no se expone)', () => {
    const r = resolverTemperaturaCarga({
      ioData: { '72': 55 },
      timestampDevice: TS,
      tieneSensor: false,
      recent72: [55, 54, 56],
    });
    expect(r.temperatura_c).toBeNull();
  });

  it('flag=true + valor real → expone (55 → 5.5°C), sospechoso=false', () => {
    const r = resolverTemperaturaCarga({
      ioData: { '72': 55 },
      timestampDevice: TS,
      tieneSensor: true,
      recent72: [55, 54, 56, 53],
    });
    expect(r.temperatura_c).toBeCloseTo(5.5, 5);
    expect(r.temperatura_registrada_en).toBe('2026-07-06T10:00:00.000Z');
    expect(r.temperatura_sensor_sospechoso).toBe(false);
  });

  it('flag=true + 0 CONSTANTE → temperatura_c 0.0 (VÁLIDO, no se nulea) PERO sospechoso=true', () => {
    const r = resolverTemperaturaCarga({
      ioData: { '72': 0 },
      timestampDevice: TS,
      tieneSensor: true,
      recent72: Array.from({ length: 15 }, () => 0),
    });
    // Clave: 0°C es lectura válida → NO se special-casea a null...
    expect(r.temperatura_c).toBe(0);
    expect(r.temperatura_registrada_en).toBe('2026-07-06T10:00:00.000Z');
    // ...pero la varianza cero dispara la señal de instalación fallida.
    expect(r.temperatura_sensor_sospechoso).toBe(true);
  });

  it('flag=true + 0 actual pero lecturas con varianza → 0.0°C, sospechoso=false (cadena de frío real)', () => {
    const r = resolverTemperaturaCarga({
      ioData: { '72': 0 },
      timestampDevice: TS,
      tieneSensor: true,
      recent72: [0, 3, -2, 1, 4, 0, 2, 5, 1, 3, 0, 2],
    });
    expect(r.temperatura_c).toBe(0);
    expect(r.temperatura_sensor_sospechoso).toBe(false);
  });
});
