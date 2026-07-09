/**
 * Codegen TS → CSS. Fuente ÚNICA de verdad del theme de Tailwind (D1 H3).
 *
 * Antes los tokens vivían duplicados: objetos TS acá + un bloque `@theme`
 * re-declarado a mano en `apps/web/src/styles.css`. Ahora `apps/web` importa el
 * CSS GENERADO por esta función (`theme.css`), y un drift-guard en CI falla si
 * el committeado no coincide con regenerar. Editar un token = editar el TS.
 *
 * Emite:
 *   1. `@theme` con los tokens FIJOS (primary, neutrales cálidos, urgency ámbar,
 *      semánticos, fuentes, radius, shadow) — los mismos valores/escala que
 *      consumía `apps/web`, sin regresión.
 *   2. El acento CUSTOMIZABLE como variables indirectas
 *      (`--color-accent-N: var(--accent-N)`) + un bloque por preset
 *      (`[data-accent="..."]`). Cambiar `data-accent` en runtime re-tematiza en
 *      vivo (D-5), sin rebuild. Solo el acento cambia; la base queda fija.
 */

import { type AccentPresetKey, DEFAULT_ACCENT, accentPresets } from './accent-presets.js';
import { colors } from './colors.js';
import { radius } from './radius.js';
import { shadow } from './shadow.js';
import { fontFamily } from './typography.js';

const ACCENT_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Escala de shadow/radius que `apps/web` sobrescribe (no tocar las built-in
 * de Tailwind fuera de este set → evita regresión en rounded-2xl/shadow-2xl). */
const RADIUS_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const SHADOW_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

function fontStack(names: readonly string[]): string {
  return names.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(', ');
}

function colorVars(name: string, ramp: Record<string | number, string>): string[] {
  return Object.entries(ramp).map(([stop, hex]) => `  --color-${name}-${stop}: ${hex};`);
}

/** Bloque `@theme` + presets de acento. Determinista (mismo input → mismo output). */
export function renderThemeCss(): string {
  const lines: string[] = [];
  lines.push('/* GENERADO por @booster-ai/ui-tokens/css.ts — NO editar a mano.');
  lines.push(
    ' * Fuente: packages/ui-tokens/src/. Regenerar: pnpm --filter @booster-ai/ui-tokens gen:css',
  );
  lines.push(' * El drift-guard de CI falla si este archivo no coincide con regenerar. */');
  lines.push('@theme {');

  lines.push('  /* Primary — verde Booster (marca / ambiental) */');
  lines.push(...colorVars('primary', colors.primary));
  lines.push('  /* Neutrales cálidos (base fija) */');
  lines.push(...colorVars('neutral', colors.neutral));
  lines.push('  /* Urgency ámbar (offers expiran, tracking en vivo) */');
  lines.push(...colorVars('urgency', colors.urgency));
  lines.push('  /* Semánticos */');
  lines.push(...colorVars('success', colors.success));
  lines.push(...colorVars('warning', colors.warning));
  lines.push(...colorVars('danger', colors.danger));
  lines.push(...colorVars('info', colors.info));

  lines.push('  /* Acento CUSTOMIZABLE (registro producto) — indirecto para theming');
  lines.push('     en runtime; el valor real lo fija el bloque [data-accent] activo. */');
  for (const stop of ACCENT_STOPS) {
    lines.push(`  --color-accent-${stop}: var(--accent-${stop});`);
  }

  lines.push('  /* Tipografía */');
  lines.push(`  --font-sans: ${fontStack(fontFamily.sans)};`);
  lines.push(`  --font-mono: ${fontStack(fontFamily.mono)};`);

  lines.push('  /* Radius (solo el set que Booster sobrescribe) */');
  for (const k of RADIUS_KEYS) {
    lines.push(`  --radius-${k}: ${radius[k]};`);
  }

  lines.push('  /* Shadow (solo el set que Booster sobrescribe) */');
  for (const k of SHADOW_KEYS) {
    lines.push(`  --shadow-${k}: ${shadow[k]};`);
  }

  lines.push('}');
  lines.push('');

  // Presets de acento. El default se ancla también en :root para que sin
  // `data-accent` el acento sea el default (Índigo).
  const keys = Object.keys(accentPresets) as AccentPresetKey[];
  for (const key of keys) {
    const ramp = accentPresets[key];
    const selector =
      key === DEFAULT_ACCENT ? `:root,\n[data-accent='${key}']` : `[data-accent='${key}']`;
    lines.push(`${selector} {`);
    for (const stop of ACCENT_STOPS) {
      lines.push(`  --accent-${stop}: ${ramp[stop]};`);
    }
    lines.push('}');
  }
  lines.push('');

  return lines.join('\n');
}
