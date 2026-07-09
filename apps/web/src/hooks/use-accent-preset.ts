import { ACCENT_PRESET_KEYS, type AccentPresetKey, DEFAULT_ACCENT } from '@booster-ai/ui-tokens';
import { useCallback, useState } from 'react';

/**
 * Acento customizable del registro producto (D1 · D-5). Cambia en runtime vía
 * el atributo `data-accent` del `<html>`, que gatilla el bloque `[data-accent]`
 * del theme generado (theme.css) — cero rebuild. Persistido en localStorage.
 *
 * La base cálida y el primario quedan FIJOS; solo el acento cambia.
 */

const STORAGE_KEY = 'booster.accent';

function isAccentKey(v: string | null): v is AccentPresetKey {
  return v !== null && (ACCENT_PRESET_KEYS as readonly string[]).includes(v);
}

/** Lee el acento guardado; default (Índigo) si falta o es inválido. */
export function getStoredAccent(): AccentPresetKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isAccentKey(v) ? v : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Aplica el acento al DOM (setea `data-accent` en <html>). */
export function applyAccent(key: AccentPresetKey): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.accent = key;
  }
}

/**
 * Aplica el acento guardado en el arranque de la app (main.tsx), antes del
 * primer render, para evitar el flash del acento default.
 */
export function initAccent(): void {
  applyAccent(getStoredAccent());
}

/** Hook del selector: [acento actual, setter que persiste + aplica en vivo]. */
export function useAccentPreset(): readonly [AccentPresetKey, (key: AccentPresetKey) => void] {
  const [current, setCurrent] = useState<AccentPresetKey>(getStoredAccent);

  const setAccent = useCallback((key: AccentPresetKey) => {
    setCurrent(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // localStorage no disponible (modo privado / SSR): el cambio en vivo
      // igual aplica vía data-accent; solo no persiste. No romper.
    }
    applyAccent(key);
  }, []);

  return [current, setAccent] as const;
}
