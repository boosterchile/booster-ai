import { describe, expect, it } from 'vitest';
import {
  type AccentPresetKey,
  allAccentPresets,
  conductorPresets,
  operatorPresets,
} from './accent-presets.js';
import { colors } from './colors.js';
import { WCAG_AA_TEXT, WCAG_AA_UI, contrastRatio, ratio2 } from './contrast.js';

/**
 * Contraste WCAG por construcción (REQUISITO DURO del PO), ahora sobre las DOS
 * paletas por rol: operador (6 sobrios) + conductor (7 LED). Verifica todas las
 * combinaciones en CLARO y OSCURO; si un par no pasa, falla el CI.
 *
 * Reglas:
 *   - Botón (~600) + texto BLANCO ≥ 4.5:1 — y blanco SIEMPRE mejor que negro
 *     (nunca negro sobre el fill del botón).
 *   - Tint (~50) + texto ~800 ≥ 4.5:1.
 *   - UI/bordes/íconos ≥ 3:1.
 *   - Verificado en claro y oscuro.
 */

const WHITE = '#FFFFFF';
const BLACK = '#000000';

const SURFACE_LIGHT = colors.neutral[0]; // #FFFFFF
const CANVAS_LIGHT = colors.neutral[50]; // #FAF9F7
const SURFACE_DARK = colors.neutral[900]; // #1A1917
const CANVAS_DARK = colors.neutral[1000]; // #0A0A09

const ALL_KEYS = Object.keys(allAccentPresets) as AccentPresetKey[];

describe('contraste · acento — operador (6) + conductor LED (7), claro y oscuro', () => {
  for (const key of ALL_KEYS) {
    const ramp = allAccentPresets[key];
    describe(key, () => {
      it('CLARO botón: blanco sobre 600 ≥ 4.5', () => {
        expect(ratio2(WHITE, ramp[600])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO tint: texto 800 sobre fondo 50 ≥ 4.5', () => {
        expect(ratio2(ramp[800], ramp[50])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO borde/ícono: 600 sobre superficie clara ≥ 3', () => {
        expect(ratio2(ramp[600], SURFACE_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_UI);
      });
      it('OSCURO botón: blanco sobre 600 ≥ 4.5', () => {
        expect(ratio2(WHITE, ramp[600])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('OSCURO tint: texto 200 sobre fondo 900 ≥ 4.5', () => {
        expect(ratio2(ramp[200], ramp[900])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('OSCURO borde/ícono: 400 sobre superficie oscura ≥ 3', () => {
        expect(ratio2(ramp[400], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_UI);
      });
    });
  }
});

/**
 * Cobertura del BOTÓN DEL DEMOSTRADOR (`bg-accent-600` + texto). El PO lo vio
 * con texto NEGRO ilegible. La regla, ahora test: el botón usa BLANCO, nunca
 * negro — para TODOS los presets de ambas paletas. Blanco debe pasar ≥4.5 Y ser
 * mejor elección que negro. Convierte el hallazgo en cobertura permanente.
 */
describe('contraste · botón de acento (bg-600) usa BLANCO, nunca negro', () => {
  for (const key of ALL_KEYS) {
    const stop600 = allAccentPresets[key][600];
    it(`${key}: blanco ≥ 4.5 Y blanco mejor que negro sobre 600`, () => {
      expect(ratio2(WHITE, stop600)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      expect(contrastRatio(WHITE, stop600)).toBeGreaterThanOrEqual(contrastRatio(BLACK, stop600));
    });
  }
});

describe('contraste · semánticos (success/warning/danger/info) FIJOS', () => {
  const semantics = {
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
  };
  for (const [name, ramp] of Object.entries(semantics)) {
    describe(name, () => {
      it('CLARO botón: blanco sobre 600 ≥ 4.5', () => {
        expect(ratio2(WHITE, ramp[600])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO tint: texto 700 sobre fondo 50 ≥ 4.5', () => {
        expect(ratio2(ramp[700], ramp[50])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('OSCURO ícono/badge: 500 sobre superficie oscura ≥ 3', () => {
        expect(ratio2(ramp[500], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_UI);
      });
    });
  }
});

/**
 * TRES VERDES con roles distintos que coexisten (regla del PO): el verde
 * AMBIENTAL (marca / primary), el verde ÉXITO (semántico) y el Verde LED
 * (acento del conductor) son tonos distintos — ninguno pisa al otro.
 */
describe('contraste · tres verdes distintos (ambiental ≠ éxito ≠ Verde LED)', () => {
  const ambiental = colors.primary[500];
  const exito = colors.success[500];
  const verdeLed = conductorPresets['verde-led'][600];
  it('los tres hex son distintos', () => {
    expect(new Set([ambiental, exito, verdeLed]).size).toBe(3);
  });
  it('éxito NO reusa el verde de marca (ambiental)', () => {
    expect(colors.success[500]).not.toBe(colors.primary[500]);
  });
});

describe('contraste · neutrales cálidos — texto en claro y oscuro', () => {
  const { neutral } = colors;
  it('CLARO texto cuerpo: neutral-900 sobre canvas ≥ 4.5', () => {
    expect(ratio2(neutral[900], CANVAS_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('CLARO texto secundario: neutral-700 sobre superficie ≥ 4.5', () => {
    expect(ratio2(neutral[700], SURFACE_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('OSCURO texto cuerpo: neutral-50 sobre superficie oscura ≥ 4.5', () => {
    expect(ratio2(neutral[50], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('OSCURO texto secundario: neutral-200 sobre canvas oscuro ≥ 4.5', () => {
    expect(ratio2(neutral[200], CANVAS_DARK)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
});

// Sanity: las dos paletas suman 13 presets (6 + 7).
describe('estructura de paletas', () => {
  it('operador 6 + conductor 7 = 13 presets', () => {
    expect(Object.keys(operatorPresets)).toHaveLength(6);
    expect(Object.keys(conductorPresets)).toHaveLength(7);
    expect(ALL_KEYS).toHaveLength(13);
  });
});
