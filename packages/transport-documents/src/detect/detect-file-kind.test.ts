import { describe, expect, it } from 'vitest';
import { detectFileKind } from './detect-file-kind.js';

/**
 * Re-validación de magic bytes en el worker (defensa en profundidad): el
 * endpoint de subida (4a) ya valida el MIME, pero el worker NO confía en el
 * `file_mime` persistido — re-detecta el tipo real del buffer descargado de
 * GCS antes de decidir el pipeline (rasterizar PDF vs preprocesar foto).
 */
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('detectFileKind — re-detección de tipo por magic bytes en el worker', () => {
  it('buffer %PDF → kind "pdf"', () => {
    expect(detectFileKind(PDF)).toBe('pdf');
  });

  it('buffer JPEG (FF D8 FF) → kind "photo"', () => {
    expect(detectFileKind(JPEG)).toBe('photo');
  });

  it('buffer PNG → kind "photo"', () => {
    expect(detectFileKind(PNG)).toBe('photo');
  });

  it('buffer no reconocido → kind "unknown"', () => {
    expect(detectFileKind(Uint8Array.from([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
  });

  it('buffer demasiado corto → kind "unknown" (no out-of-bounds)', () => {
    expect(detectFileKind(Uint8Array.from([0x25]))).toBe('unknown');
  });

  it('buffer vacío → kind "unknown"', () => {
    expect(detectFileKind(new Uint8Array(0))).toBe('unknown');
  });
});
