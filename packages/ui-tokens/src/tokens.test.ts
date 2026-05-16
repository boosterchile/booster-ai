import { describe, expect, it } from 'vitest';
import { breakpoint } from './breakpoint.js';
import { colors, semanticColors } from './colors.js';
import { duration, easing } from './duration.js';
import { radius } from './radius.js';
import { shadow } from './shadow.js';
import { spacing } from './spacing.js';
import {
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  textStyles,
} from './typography.js';
import { zIndex } from './z-index.js';

describe('breakpoint', () => {
  it('matches Tailwind defaults 1:1 (sm/md/lg/xl/2xl)', () => {
    expect(breakpoint.sm).toBe('640px');
    expect(breakpoint.md).toBe('768px');
    expect(breakpoint.lg).toBe('1024px');
    expect(breakpoint.xl).toBe('1280px');
    expect(breakpoint['2xl']).toBe('1536px');
  });
});

describe('colors', () => {
  it('primary[500] es Booster green canónico #1FA058', () => {
    expect(colors.primary[500]).toBe('#1FA058');
  });

  it('escala primary 50..950 (11 stops, monotónica)', () => {
    expect(Object.keys(colors.primary)).toEqual([
      '50',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
      '950',
    ]);
  });

  it('neutral incluye negro absoluto en 1000 y blanco en 0', () => {
    expect(colors.neutral[0]).toBe('#FFFFFF');
    expect(colors.neutral[1000]).toBe('#0A0A09');
  });

  it('semantic NO reusa primary brand (danger 500 ≠ primary 500)', () => {
    expect(colors.danger[500]).not.toBe(colors.primary[500]);
    expect(colors.danger[500]).toBe('#DC2626');
  });

  it('semanticColors.brandPrimary apunta a primary[500]', () => {
    expect(semanticColors.brandPrimary).toBe(colors.primary[500]);
  });

  it('semanticColors.bgCanvas usa neutral cálido (no slate)', () => {
    expect(semanticColors.bgCanvas).toBe(colors.neutral[50]);
    expect(semanticColors.bgCanvas).toBe('#FAF9F7');
  });
});

describe('duration', () => {
  it('fast=120ms, default=200ms (UI operacional, no entretenimiento)', () => {
    expect(duration.fast).toBe('120ms');
    expect(duration.default).toBe('200ms');
  });

  it('slower ≤ 480ms (anti-regresión de UX lenta)', () => {
    const ms = Number.parseInt(duration.slower, 10);
    expect(ms).toBeLessThanOrEqual(480);
  });

  it('easing.inOut es cubic-bezier estándar Material', () => {
    expect(easing.inOut).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });
});

describe('radius', () => {
  it('full=9999px reservado para pills (badges, avatars)', () => {
    expect(radius.full).toBe('9999px');
  });

  it('md=8px (canónico para buttons + inputs)', () => {
    expect(radius.md).toBe('8px');
  });
});

describe('shadow', () => {
  it('focusRing usa rgb del primary brand (31, 160, 88)', () => {
    expect(shadow.focusRing).toContain('rgb(31 160 88');
  });

  it('focusRingDanger es independiente del brand (rojo 220 38 38)', () => {
    expect(shadow.focusRingDanger).toContain('rgb(220 38 38');
  });

  it('none="none" (no string vacío que rompa cssvars)', () => {
    expect(shadow.none).toBe('none');
  });
});

describe('spacing', () => {
  it('base modular 4px (spacing[1] === 4px)', () => {
    expect(spacing[1]).toBe('4px');
    expect(spacing[4]).toBe('16px');
    expect(spacing[8]).toBe('32px');
  });

  it('incluye fractional 0.5/1.5/2.5 (alineamiento icon center)', () => {
    expect(spacing['0.5']).toBe('2px');
    expect(spacing['1.5']).toBe('6px');
    expect(spacing['2.5']).toBe('10px');
  });

  it('px=1px (hairline borders)', () => {
    expect(spacing.px).toBe('1px');
  });
});

describe('typography', () => {
  it('sans empieza por Inter (decision de marca)', () => {
    expect(fontFamily.sans[0]).toBe('Inter');
  });

  it('mono empieza por JetBrains Mono (placas/IDs técnicos)', () => {
    expect(fontFamily.mono[0]).toBe('JetBrains Mono');
  });

  it('fontSize.base=16px (rem reference)', () => {
    expect(fontSize.base).toBe('16px');
  });

  it('fontSize.xs..7xl están en orden ascendente', () => {
    const sizes = [
      Number.parseInt(fontSize.xs, 10),
      Number.parseInt(fontSize.sm, 10),
      Number.parseInt(fontSize.base, 10),
      Number.parseInt(fontSize.lg, 10),
      Number.parseInt(fontSize.xl, 10),
      Number.parseInt(fontSize['2xl'], 10),
      Number.parseInt(fontSize['3xl'], 10),
      Number.parseInt(fontSize['4xl'], 10),
      Number.parseInt(fontSize['5xl'], 10),
      Number.parseInt(fontSize['6xl'], 10),
      Number.parseInt(fontSize['7xl'], 10),
    ];
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1] ?? 0);
    }
  });

  it('fontWeight.regular=400, bold=700 (estándar OS)', () => {
    expect(fontWeight.regular).toBe(400);
    expect(fontWeight.bold).toBe(700);
  });

  it('lineHeight body=1.5 (lectura cómoda)', () => {
    expect(lineHeight.normal).toBe(1.5);
  });

  it('letterSpacing tight es negativo (display headings)', () => {
    expect(letterSpacing.tight).toBe('-0.02em');
  });

  it('textStyles.body compone fontFamily.sans + fontSize.base', () => {
    expect(textStyles.body.fontFamily).toBe(fontFamily.sans);
    expect(textStyles.body.fontSize).toBe(fontSize.base);
    expect(textStyles.body.fontWeight).toBe(fontWeight.regular);
  });

  it('textStyles.mono usa fontFamily.mono', () => {
    expect(textStyles.mono.fontFamily).toBe(fontFamily.mono);
  });
});

describe('zIndex', () => {
  it('escala monotónica base < raised < dropdown < sticky < banner < overlay < modal < popover < toast < max', () => {
    const order = [
      zIndex.base,
      zIndex.raised,
      zIndex.dropdown,
      zIndex.sticky,
      zIndex.banner,
      zIndex.overlay,
      zIndex.modal,
      zIndex.popover,
      zIndex.toast,
      zIndex.max,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1] ?? 0);
    }
  });

  it('modal=1400 > overlay=1300 (modal por encima del backdrop)', () => {
    expect(zIndex.modal).toBe(1400);
    expect(zIndex.overlay).toBe(1300);
    expect(zIndex.modal).toBeGreaterThan(zIndex.overlay);
  });
});
