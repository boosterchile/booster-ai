import { describe, expect, it } from 'vitest';
import { type AccentPresetKey, accentPresets } from './accent-presets.js';
import { colors } from './colors.js';
import { WCAG_AA_TEXT, WCAG_AA_UI, contrastRatio, ratio2 } from './contrast.js';

/**
 * Contraste WCAG por construcción (D1 · REQUISITO DURO 1 del PO).
 *
 * Verifica programáticamente cada rampa (acento ×7, semánticos, neutrales) en
 * TODAS las combinaciones exigidas, en CLARO y OSCURO. Si un par no pasa, el
 * test falla y bloquea el CI. Es la a11y verificada de verdad que reemplaza al
 * job axe-core "fantasma".
 *
 * Reglas del PO:
 *   - Botón (~600) + texto BLANCO ≥ 4.5:1.
 *   - Tint (~50) + texto oscuro misma familia ≥ 4.5:1.
 *   - Texto normal ≥ 4.5:1; UI/bordes/íconos ≥ 3:1.
 *   - NUNCA negro sobre color (blanco siempre es la elección accesible).
 *   - Verificado en claro y oscuro.
 */

const WHITE = '#FFFFFF';
const BLACK = '#000000';

// Superficies del sistema (base cálida, fija). Claro vs oscuro.
const SURFACE_LIGHT = colors.neutral[0]; // #FFFFFF
const CANVAS_LIGHT = colors.neutral[50]; // #FAF9F7 (beige cálido)
const SURFACE_DARK = colors.neutral[900]; // #1A1917
const CANVAS_DARK = colors.neutral[1000]; // #0A0A09

const ACCENT_KEYS = Object.keys(accentPresets) as AccentPresetKey[];

describe('contraste · rampas de acento (7 presets) — claro y oscuro', () => {
  for (const key of ACCENT_KEYS) {
    const ramp = accentPresets[key];

    describe(key, () => {
      // --- CLARO ---
      it('CLARO botón: blanco sobre 600 ≥ 4.5', () => {
        expect(ratio2(WHITE, ramp[600])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO botón: blanco sobre 500 ≥ 4.5 (fill alterno)', () => {
        expect(ratio2(WHITE, ramp[500])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO tint: texto 800 sobre fondo 50 ≥ 4.5', () => {
        expect(ratio2(ramp[800], ramp[50])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('CLARO borde/ícono: 600 sobre superficie clara ≥ 3', () => {
        expect(ratio2(ramp[600], SURFACE_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_UI);
      });

      // --- OSCURO ---
      it('OSCURO botón: blanco sobre 600 ≥ 4.5', () => {
        // El botón mantiene fill 600 + texto blanco también en oscuro.
        expect(ratio2(WHITE, ramp[600])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('OSCURO tint: texto 200 sobre fondo 900 ≥ 4.5', () => {
        expect(ratio2(ramp[200], ramp[900])).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
      });
      it('OSCURO borde/ícono: 400 sobre superficie oscura ≥ 3', () => {
        expect(ratio2(ramp[400], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_UI);
      });

      // --- NUNCA negro sobre color ---
      it('nunca negro sobre color: blanco ≥ negro en fills 500/600/700', () => {
        for (const stop of [500, 600, 700] as const) {
          expect(contrastRatio(WHITE, ramp[stop])).toBeGreaterThanOrEqual(
            contrastRatio(BLACK, ramp[stop]),
          );
        }
      });
    });
  }
});

describe('contraste · semánticos (success/warning/danger/info)', () => {
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
      it('nunca negro sobre color: blanco ≥ negro en 600', () => {
        expect(contrastRatio(WHITE, ramp[600])).toBeGreaterThanOrEqual(
          contrastRatio(BLACK, ramp[600]),
        );
      });
    });
  }
});

describe('contraste · neutrales cálidos — texto en claro y oscuro', () => {
  const { neutral } = colors;

  it('CLARO texto cuerpo: neutral-900 sobre canvas ≥ 4.5', () => {
    expect(ratio2(neutral[900], CANVAS_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('CLARO texto secundario: neutral-700 sobre superficie ≥ 4.5', () => {
    expect(ratio2(neutral[700], SURFACE_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('CLARO UI: neutral-600 sobre canvas ≥ 3', () => {
    expect(ratio2(neutral[600], CANVAS_LIGHT)).toBeGreaterThanOrEqual(WCAG_AA_UI);
  });
  it('OSCURO texto cuerpo: neutral-50 sobre superficie oscura ≥ 4.5', () => {
    expect(ratio2(neutral[50], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('OSCURO texto secundario: neutral-200 sobre canvas oscuro ≥ 4.5', () => {
    expect(ratio2(neutral[200], CANVAS_DARK)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });
  it('OSCURO UI: neutral-400 sobre superficie oscura ≥ 3', () => {
    expect(ratio2(neutral[400], SURFACE_DARK)).toBeGreaterThanOrEqual(WCAG_AA_UI);
  });
});
