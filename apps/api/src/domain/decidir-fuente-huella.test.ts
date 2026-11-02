import { describe, expect, it } from 'vitest';
import {
  type EntradaDecisionFuente,
  MOTIVOS_FALLBACK,
  decidirFuenteHuella,
} from './decidir-fuente-huella.js';

type E = EntradaDecisionFuente;
type C = Partial<NonNullable<E['can83']>>;
// Sintético: Teltonika, GPS 100 % sobre 400 km, 83 limpio con 140 L (35 L/100 km).
const base: E = {
  dispositivo: 'teltonika',
  reconstruccion: { estado: 'ok', coberturaPct: 100, distanciaKm: 400 },
  pingsEnVentana: 500,
  combustible: 'diesel',
  can83: { lecturas: 400, coberturaKmPct: 99, pasosNegativos: 0, saltoMaxPorPasoL: 1, litros: 140 },
  litrosNivelSinRecarga: 150,
  consumoBasePor100km: null,
  perfilEnergetico: 'consumo_base',
  pesoDeclarado: true,
};
const con = (o: Partial<E>) => decidirFuenteHuella({ ...base, ...o });
const can = (o: C): Partial<E> => ({ can83: { ...(base.can83 as NonNullable<E['can83']>), ...o } });
const rec = (r: E['reconstruccion']): Partial<E> => ({ reconstruccion: r });

describe('decidirFuenteHuella (HC-001)', () => {
  it('AC1: Teltonika ≥95 % + 83 válido → teltonika_gps, can_83, primario, final', () => {
    expect(decidirFuenteHuella(base)).toEqual({
      fuenteDistancia: 'teltonika_gps',
      fuenteEnergia: 'can_83',
      litrosCan: 140,
      motivoFallback: null,
      alertas: [],
      completitud: 'final',
      nivel: 'primario_verificable',
      decisionVersion: 1,
    });
  });

  it('AC2: el opt-in no cambia la decisión y no es motivo de fuente', () => {
    const conOptIn = decidirFuenteHuella({ ...base, optInActivo: true } as E);
    expect(conOptIn).toEqual(decidirFuenteHuella({ ...base, optInActivo: false } as E));
    expect(MOTIVOS_FALLBACK).not.toContain('opt_in_inactivo');
  });

  // biome-ignore format: tabla de verdad, una fila por caso
  // [caso, input, energía, motivo, alertas, nivel]
  it.each([
    ['R3: GPS 90 % + 83', rec({ estado: 'ok', coberturaPct: 90, distanciaKm: 400 }), 'can_83', null, [], 'secundario_modeled'],
    ['AC3: sin 83 en la ventana', { can83: null }, 'modelo_perfil', 'can_sin_lecturas', [], 'secundario_modeled'],
    ['AC3: 1 sola lectura', can({ lecturas: 1 }), 'modelo_perfil', 'can_sin_lecturas', [], 'secundario_modeled'],
    ['AC3: cobertura 94 %', can({ coberturaKmPct: 94 }), 'modelo_perfil', 'can_cobertura_insuficiente', [], 'secundario_modeled'],
    ['AC3: Δ < 0', can({ pasosNegativos: 1 }), 'modelo_perfil', 'can_no_monotono', [], 'secundario_modeled'],
    ['AC3: salto 60 L', can({ saltoMaxPorPasoL: 60 }), 'modelo_perfil', 'can_no_monotono', [], 'secundario_modeled'],
    ['AC3: 10 L/100 km', can({ litros: 40 }), 'modelo_perfil', 'can_fuera_de_banda', [], 'secundario_modeled'],
    ['AC3: 80 L/100 km', can({ litros: 320 }), 'modelo_perfil', 'can_fuera_de_banda', [], 'secundario_modeled'],
    ['AC3: 35 con base 15', { consumoBasePor100km: 15 }, 'modelo_perfil', 'can_fuera_de_banda', [], 'secundario_modeled'],
    ['AC3: 35 con base 80', { consumoBasePor100km: 80 }, 'modelo_perfil', 'can_fuera_de_banda', [], 'secundario_modeled'],
    ['AC3: eléctrico', { combustible: 'electrico' }, 'modelo_perfil', 'can_combustible_no_soportado', [], 'secundario_modeled'],
    ['banda: 35 con base 30', { consumoBasePor100km: 30 }, 'can_83', null, [], 'primario_verificable'],
    ['AC4: solo nivel 276 L', { can83: null, litrosNivelSinRecarga: 276 }, 'modelo_perfil', 'can_sin_lecturas', [], 'secundario_modeled'],
    ['AC5: sin peso + 83', { pesoDeclarado: false }, 'can_83', 'peso_ausente', [], 'primario_verificable'],
    ['nivel a ≤25 %', { litrosNivelSinRecarga: 170 }, 'can_83', null, [], 'primario_verificable'],
    ['nivel con recarga', { litrosNivelSinRecarga: null }, 'can_83', null, [], 'primario_verificable'],
    [
      'BOO-HC7DJX: 83 216 L vs nivel 276 L',
      { ...rec({ estado: 'ok', coberturaPct: 100, distanciaKm: 468.76 }), ...can({ litros: 216 }), litrosNivelSinRecarga: 276 },
      'can_83', null, ['discrepancia_can'], 'primario_verificable',
    ],
    ['discrepancia + sin peso', { pesoDeclarado: false, litrosNivelSinRecarga: 276 }, 'can_83', 'peso_ausente', ['discrepancia_can'], 'primario_verificable'],
  ] as const)('%s → %s, %s, %j, %s', (_c, o, energia, motivo, alertas, nivel) => {
    const d = con(o as Partial<E>);
    expect(d).toMatchObject({ fuenteDistancia: 'teltonika_gps', fuenteEnergia: energia, nivel });
    expect(d).toMatchObject({ motivoFallback: motivo, alertas: [...alertas] });
    expect(d.litrosCan === null).toBe(energia !== 'can_83');
  });

  // biome-ignore format: tabla de verdad, una fila por caso
  // AC6/AC10: distancia sin GPS suficiente. [caso, input, distancia, energía, motivo, completitud]
  it.each([
    ['GPS 70 %', rec({ estado: 'ok', coberturaPct: 70, distanciaKm: 400 }), 'routes_estimada', 'modelo_perfil', 'cobertura_bajo_umbral', 'final'],
    ['cap', rec({ estado: 'abort', motivo: 'cap_exceeded' }), 'routes_estimada', 'modelo_perfil', 'cap_huecos', 'final'],
    ['0 pings', { ...rec({ estado: 'abort', motivo: 'sin_observacion' }), pingsEnVentana: 0 }, 'routes_estimada', 'modelo_perfil', 'sin_pings_en_ventana', 'final'],
    ['sin continuidad', rec({ estado: 'abort', motivo: 'sin_observacion' }), 'routes_estimada', 'modelo_perfil', 'sin_observacion_continua', 'final'],
    ['routes_error', rec({ estado: 'abort', motivo: 'routes_error' }), 'routes_estimada', 'modelo_perfil', 'routes_error', 'provisional'],
    ['AC10 sin dispositivo, sin perfil', { dispositivo: 'ninguno', ...rec({ estado: 'abort', motivo: 'sin_observacion' }), perfilEnergetico: 'ninguno' }, 'routes_estimada', 'por_defecto', 'sin_dispositivo', 'final'],
    ['AC10 móvil GPS', { dispositivo: 'ninguno', perfilEnergetico: 'tipo_vehiculo' }, 'movil_gps', 'modelo_perfil', 'sin_dispositivo', 'final'],
  ] as const)('AC6/AC10 %s → %s, %s, %s, %s', (_c, o, distancia, energia, motivo, completitud) => {
    const d = con(o as Partial<E>);
    expect(d).toMatchObject({ fuenteDistancia: distancia, fuenteEnergia: energia, completitud });
    expect(d.motivoFallback).toBe(motivo);
    expect(d.nivel).not.toBe('primario_verificable');
  });

  it('invariante: Teltonika + routes_estimada nunca tiene motivo null', () => {
    const recons: E['reconstruccion'][] = [
      { estado: 'ok', coberturaPct: 0, distanciaKm: 0 },
      { estado: 'ok', coberturaPct: 79.99, distanciaKm: 400 },
      { estado: 'abort', motivo: 'routes_error' },
      { estado: 'abort', motivo: 'cap_exceeded' },
      { estado: 'abort', motivo: 'sin_observacion' },
    ];
    for (const reconstruccion of recons) {
      for (const [pesoDeclarado, pingsEnVentana] of [
        [true, 0],
        [false, 10],
      ] as const) {
        const d = con({ reconstruccion, pesoDeclarado, pingsEnVentana });
        expect(d.fuenteDistancia).toBe('routes_estimada');
        expect(d.motivoFallback).not.toBeNull();
      }
    }
  });
});
