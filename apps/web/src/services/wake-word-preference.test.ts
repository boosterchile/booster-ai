import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWakeWordEnabled, setWakeWordEnabled } from './wake-word-preference.js';

const KEY = 'booster:wake-word:enabled';

describe('wake-word-preference', () => {
  beforeEach(() => {
    window.localStorage.removeItem(KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(KEY);
  });

  it('default es false (sin entry en localStorage)', () => {
    expect(isWakeWordEnabled()).toBe(false);
  });

  it('setWakeWordEnabled(true) → isWakeWordEnabled() returns true', () => {
    setWakeWordEnabled(true);
    expect(isWakeWordEnabled()).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('1');
  });

  it('setWakeWordEnabled(false) → remove entry', () => {
    setWakeWordEnabled(true);
    setWakeWordEnabled(false);
    expect(isWakeWordEnabled()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('persiste a través de múltiples reads', () => {
    setWakeWordEnabled(true);
    expect(isWakeWordEnabled()).toBe(true);
    expect(isWakeWordEnabled()).toBe(true);
    expect(isWakeWordEnabled()).toBe(true);
  });
});
