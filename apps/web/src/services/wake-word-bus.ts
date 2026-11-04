/**
 * ADR-036 — Puente entre la detección de "Oye Booster" y el botón de voz.
 *
 * Cada `VoiceCommandButton` montado se registra; una detección arranca el
 * reconocimiento del último montado (el que está en primer plano), como si
 * el conductor lo hubiera tocado. Sin botón en pantalla no pasa nada más.
 */

type Oyente = () => void;

const oyentes: Oyente[] = [];

export function escucharWakeWord(fn: Oyente): () => void {
  oyentes.push(fn);
  return () => {
    const i = oyentes.lastIndexOf(fn);
    if (i >= 0) {
      oyentes.splice(i, 1);
    }
  };
}

/** Devuelve si algún botón recibió la detección. */
export function emitirWakeWord(): boolean {
  const ultimo = oyentes.at(-1);
  if (!ultimo) {
    return false;
  }
  ultimo();
  return true;
}
