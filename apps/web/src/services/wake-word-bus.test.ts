import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitirWakeWord, escucharWakeWord } from './wake-word-bus.js';

describe('wake-word-bus', () => {
  const offs: Array<() => void> = [];
  afterEach(() => {
    for (const off of offs.splice(0)) {
      off();
    }
  });

  it('sin oyentes, la detección no llega a nadie', () => {
    expect(emitirWakeWord()).toBe(false);
  });

  it('entrega la detección solo al último oyente montado', () => {
    const a = vi.fn();
    const b = vi.fn();
    offs.push(escucharWakeWord(a), escucharWakeWord(b));
    expect(emitirWakeWord()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('al desmontarse el último, vuelve a recibir el anterior', () => {
    const a = vi.fn();
    const b = vi.fn();
    offs.push(escucharWakeWord(a));
    const offB = escucharWakeWord(b);
    offB();
    offB();
    emitirWakeWord();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
