/**
 * ADR-036 — Persistencia del opt-in del conductor para wake-word
 * "Oye Booster". Patrón espejo de `coaching-voice.ts/loadAutoplayPreference`.
 *
 * Default OFF: el conductor ACTIVA explícitamente desde la card
 * "Activación por voz" en /app/conductor/configuracion. Booster nunca
 * asume permisos always-on de micrófono.
 *
 * El feature flag global `WAKE_WORD_VOICE_ACTIVATED` también debe ser
 * `true` (controlado por platform-admin via Terraform). El opt-in del
 * usuario y el flag global son AND — ambos deben estar ON para que el
 * wake-word listener arranque.
 */

const WAKE_WORD_KEY = 'booster:wake-word:enabled';

export function isWakeWordEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(WAKE_WORD_KEY) === '1';
  } catch {
    // localStorage puede tirar SecurityError en private mode + Safari.
    return false;
  }
}

export function setWakeWordEnabled(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(WAKE_WORD_KEY, '1');
    } else {
      window.localStorage.removeItem(WAKE_WORD_KEY);
    }
  } catch {
    // No-op en private mode.
  }
}
