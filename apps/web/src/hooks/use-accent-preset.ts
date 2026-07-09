import { ACCENT_PALETTES, type AccentPalette, type AccentPresetKey } from '@booster-ai/ui-tokens';
import { useCallback, useEffect, useState } from 'react';

/**
 * Acento customizable del registro producto (D-4/D-5) — DOS paletas por ROL:
 * `operator` (sobria) y `conductor` (LED vibrante). Cambia en runtime vía el
 * atributo `data-accent` del <html> (→ bloque `[data-accent]` del theme
 * generado). Base + primario + semánticos quedan FIJOS; solo el acento cambia.
 *
 * La PALETA la determina el rol del usuario: el conductor ve las LED, los
 * operadores las sobrias. El selector recibe la paleta (derivada del rol en la
 * app; en el demostrador público /apariencia se toggle-ea). Cada paleta recuerda
 * su propio acento en localStorage.
 */

const STORAGE_PREFIX = 'booster.accent.';
const storageKey = (p: AccentPalette) => `${STORAGE_PREFIX}${p}`;

function isKeyOfPalette(palette: AccentPalette, v: string | null): v is AccentPresetKey {
  return v !== null && ACCENT_PALETTES[palette].keys.includes(v as AccentPresetKey);
}

/** Acento guardado para la paleta, o su default (operador → Índigo,
 * conductor → Azul LED) si falta o no pertenece a la paleta. */
export function getStoredAccent(palette: AccentPalette): AccentPresetKey {
  try {
    const v = localStorage.getItem(storageKey(palette));
    return isKeyOfPalette(palette, v) ? v : ACCENT_PALETTES[palette].default;
  } catch {
    return ACCENT_PALETTES[palette].default;
  }
}

/** Aplica el acento al DOM (setea `data-accent` en <html>). */
export function applyAccent(key: AccentPresetKey): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.accent = key;
  }
}

/** Aplica en el boot (main.tsx) el acento guardado de la paleta operador por
 * defecto, para evitar el flash. La paleta real (por rol) se fija al montar la
 * surface correspondiente. */
export function initAccent(palette: AccentPalette = 'operator'): void {
  applyAccent(getStoredAccent(palette));
}

/**
 * Hook del selector: [acento actual, setter que persiste + aplica en vivo, keys
 * de la paleta]. Al cambiar de paleta (rol/toggle) re-sincroniza y aplica el
 * acento de la nueva paleta.
 */
export function useAccentPreset(
  palette: AccentPalette,
): readonly [AccentPresetKey, (key: AccentPresetKey) => void, AccentPresetKey[]] {
  const [current, setCurrent] = useState<AccentPresetKey>(() => getStoredAccent(palette));

  useEffect(() => {
    const key = getStoredAccent(palette);
    setCurrent(key);
    applyAccent(key);
  }, [palette]);

  const setAccent = useCallback(
    (key: AccentPresetKey) => {
      setCurrent(key);
      try {
        localStorage.setItem(storageKey(palette), key);
      } catch {
        // localStorage no disponible: el cambio en vivo igual aplica, no persiste.
      }
      applyAccent(key);
    },
    [palette],
  );

  return [current, setAccent, ACCENT_PALETTES[palette].keys] as const;
}
