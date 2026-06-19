import { describe, expect, it } from 'vitest';
import { pagesToRender, resolveMaxPdfPages } from './pdfium-renderer.js';

/**
 * Cap anti-OOM del rasterizador (gate seguridad). El render WASM mismo está
 * excluido del unit-coverage (necesita un PDF real), pero la decisión del tope
 * de páginas es PURA y sí se testea: un PDF adversario de cientos de páginas no
 * debe rasterizar todas a RGBA en memoria (OOM en Cloud Run 1Gi).
 */
describe('pagesToRender — tope de páginas a rasterizar (anti-OOM)', () => {
  it('un PDF con MUCHAS páginas se capa al máximo (no renderiza todas)', () => {
    expect(pagesToRender(500, 3)).toBe(3);
  });

  it('un PDF con menos páginas que el tope renderiza solo las que tiene', () => {
    expect(pagesToRender(1, 3)).toBe(1);
    expect(pagesToRender(2, 3)).toBe(2);
  });

  it('exactamente en el tope renderiza el tope', () => {
    expect(pagesToRender(3, 3)).toBe(3);
  });

  it('pageCount 0 o negativo → 0 (defensivo, no itera)', () => {
    expect(pagesToRender(0, 3)).toBe(0);
    expect(pagesToRender(-5, 3)).toBe(0);
  });
});

describe('resolveMaxPdfPages — boundary del tope (env PDF_MAX_PAGES)', () => {
  it('sin env var usa el default conservador (3)', () => {
    expect(resolveMaxPdfPages(undefined)).toBe(3);
  });

  it('un entero válido ≥1 se respeta', () => {
    expect(resolveMaxPdfPages('1')).toBe(1);
    expect(resolveMaxPdfPages('10')).toBe(10);
  });

  it('valor inválido (no entero, 0, negativo) cae al default', () => {
    expect(resolveMaxPdfPages('0')).toBe(3);
    expect(resolveMaxPdfPages('-2')).toBe(3);
    expect(resolveMaxPdfPages('abc')).toBe(3);
    expect(resolveMaxPdfPages('')).toBe(3);
  });
});
