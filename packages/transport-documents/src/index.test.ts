import { describe, expect, it, vi } from 'vitest';
import { PdfTedIngestor, createPdfTedIngestor } from './index.js';
import type { Pdf417Decoder, PhotoPreprocessor, RasterImage, RasterRenderer } from './ports.js';

describe('createPdfTedIngestor', () => {
  it('sin overrides construye el ingestor con los adapters WASM de producción', () => {
    expect(createPdfTedIngestor()).toBeInstanceOf(PdfTedIngestor);
  });

  it('con overrides usa los puertos inyectados', () => {
    const imagen: RasterImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    const renderer: RasterRenderer = { renderPdfPages: vi.fn(async () => [imagen]) };
    const decoder: Pdf417Decoder = { decode: vi.fn(async () => null) };
    const preprocessor: PhotoPreprocessor = { toImage: vi.fn(async () => imagen) };
    expect(createPdfTedIngestor({ renderer, decoder, preprocessor })).toBeInstanceOf(
      PdfTedIngestor,
    );
  });
});
