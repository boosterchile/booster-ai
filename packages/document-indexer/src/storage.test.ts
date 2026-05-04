import { describe, expect, it } from 'vitest';
import { buildGcsPath, computeSha256 } from './storage.js';

describe('buildGcsPath', () => {
  const at = new Date('2026-05-04T10:00:00.000Z');

  it('coloca DTEs bajo dte/{yyyy}/{mm}/{empresaId}/', () => {
    const path = buildGcsPath({
      type: 'dte_guia_despacho',
      empresaId: 'a-empresa',
      identifier: '76543210-K-1001',
      emittedAt: at,
      ext: 'xml',
    });
    expect(path).toBe('dte/2026/05/a-empresa/76543210-K-1001.xml');
  });

  it('coloca carta_porte bajo carta-porte/...', () => {
    const path = buildGcsPath({
      type: 'carta_porte',
      empresaId: 'e1',
      identifier: 'cp-123',
      emittedAt: at,
      ext: 'pdf',
    });
    expect(path).toBe('carta-porte/2026/05/e1/cp-123.pdf');
  });

  it('coloca fotos pickup/delivery bajo photos/', () => {
    expect(
      buildGcsPath({
        type: 'foto_pickup',
        empresaId: 'e1',
        identifier: 'pickup-trip-1',
        emittedAt: at,
        ext: 'jpg',
      }),
    ).toMatch(/^photos\/2026\/05\/e1\//);
    expect(
      buildGcsPath({
        type: 'foto_delivery',
        empresaId: 'e1',
        identifier: 'del-trip-1',
        emittedAt: at,
        ext: 'jpg',
      }),
    ).toMatch(/^photos\/2026\/05\/e1\//);
  });

  it('coloca firma_receptor bajo signatures/', () => {
    expect(
      buildGcsPath({
        type: 'firma_receptor',
        empresaId: 'e1',
        identifier: 'sign-trip-1',
        emittedAt: at,
        ext: 'png',
      }),
    ).toBe('signatures/2026/05/e1/sign-trip-1.png');
  });

  it('coloca certificado_esg bajo certificados/', () => {
    expect(
      buildGcsPath({
        type: 'certificado_esg',
        empresaId: 'e1',
        identifier: 'tracking-XYZ',
        emittedAt: at,
        ext: 'pdf',
      }),
    ).toBe('certificados/2026/05/e1/tracking-XYZ.pdf');
  });

  it('coloca docs externos bajo external-upload/', () => {
    expect(
      buildGcsPath({
        type: 'factura_externa',
        empresaId: 'e1',
        identifier: 'fact-abc',
        emittedAt: at,
        ext: 'pdf',
      }),
    ).toBe('external-upload/2026/05/e1/fact-abc.pdf');
  });

  it('pad month a 2 dígitos', () => {
    const enero = new Date('2026-01-04T00:00:00.000Z');
    expect(
      buildGcsPath({
        type: 'carta_porte',
        empresaId: 'e1',
        identifier: 'x',
        emittedAt: enero,
        ext: 'pdf',
      }),
    ).toContain('/2026/01/');
  });

  it('default a `now` si no se pasa emittedAt', () => {
    const path = buildGcsPath({
      type: 'otro',
      empresaId: 'e1',
      identifier: 'x',
      ext: 'bin',
    });
    expect(path).toMatch(/^misc\/\d{4}\/\d{2}\/e1\/x\.bin$/);
  });
});

describe('computeSha256', () => {
  it('coincide con el sha256 conocido del string vacío', () => {
    // SHA-256 de "" — verificable en cualquier herramienta
    expect(computeSha256(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('determinístico para el mismo input', () => {
    const a = computeSha256(Buffer.from('hello'));
    const b = computeSha256(Buffer.from('hello'));
    expect(a).toBe(b);
  });

  it('cambia cuando cambia el input', () => {
    const a = computeSha256(Buffer.from('hello'));
    const b = computeSha256(Buffer.from('world'));
    expect(a).not.toBe(b);
  });

  it('acepta Uint8Array', () => {
    const u8 = new Uint8Array([0x68, 0x69]); // "hi"
    expect(computeSha256(u8)).toBe(
      '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
    );
  });
});
