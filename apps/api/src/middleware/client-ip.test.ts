import { describe, expect, it } from 'vitest';
import { extractClientIp } from './client-ip.js';

describe('extractClientIp (trust boundary XFF bajo GCLB)', () => {
  it('multi-entry spoofeado → penúltima (la que vio el LB), no la del atacante', () => {
    expect(extractClientIp('6.6.6.6, 198.51.100.7, 35.1.1.1')).toBe('198.51.100.7');
    expect(extractClientIp('a, b, c, d')).toBe('c');
  });

  it('dos entries (cliente directo al LB) → la primera (= IP real)', () => {
    expect(extractClientIp('198.51.100.7, 35.1.1.1')).toBe('198.51.100.7');
  });

  it('single entry (dev sin LB) → esa', () => {
    expect(extractClientIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('ausente / vacío / solo comas → unknown', () => {
    expect(extractClientIp(undefined)).toBe('unknown');
    expect(extractClientIp('')).toBe('unknown');
    expect(extractClientIp(' , , ')).toBe('unknown');
  });

  it('espacios y entries vacías se filtran antes de elegir', () => {
    expect(extractClientIp(' 6.6.6.6 ,, 198.51.100.7 , 35.1.1.1 ')).toBe('198.51.100.7');
  });
});
