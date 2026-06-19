import { describe, expect, it, vi } from 'vitest';
import type { Pdf417Decoder, PhotoPreprocessor, RasterImage, RasterRenderer } from '../ports.js';
import { PdfTedIngestor } from './pdf-ted-ingestor.js';

const TED = `<TED version="1.0"><DD><RE>76111111-1</RE><TD>52</TD><F>67</F><FE>2026-06-11</FE><RR>12345678-5</RR><RSR>Comprador S.A.</RSR><MNT>24365</MNT><CAF/><TSTED>2026-06-11T07:34:15</TSTED></DD><FRMT algoritmo="SHA1withRSA">x</FRMT></TED>`;

const PDF_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const FAKE_IMAGE: RasterImage = {
  data: new Uint8ClampedArray(4),
  width: 1,
  height: 1,
};

function makePorts(overrides?: {
  renderer?: Partial<RasterRenderer>;
  decoder?: Partial<Pdf417Decoder>;
  preprocessor?: Partial<PhotoPreprocessor>;
}) {
  const renderer: RasterRenderer = {
    renderPdfPages: overrides?.renderer?.renderPdfPages ?? vi.fn(async () => [FAKE_IMAGE]),
  };
  const decoder: Pdf417Decoder = {
    decode: overrides?.decoder?.decode ?? vi.fn(async () => TED),
  };
  const preprocessor: PhotoPreprocessor = {
    toImage: overrides?.preprocessor?.toImage ?? vi.fn(async () => FAKE_IMAGE),
  };
  return { renderer, decoder, preprocessor };
}

describe('PdfTedIngestor — orquestación del decode TED (sub-fase 4b)', () => {
  it('PDF con PDF417 decodificable → status "decodificado" con campos del <DD>', async () => {
    const ingestor = new PdfTedIngestor(makePorts());
    const result = await ingestor.ingest({
      buffer: PDF_BYTES,
      createdAt: new Date('2026-06-18T00:00:00Z'),
    });

    expect(result.status).toBe('decodificado');
    if (result.status !== 'decodificado') {
      return;
    }
    expect(result.fields.rutEmisor).toBe('76111111-1');
    expect(result.fields.rutReceptor).toBe('12345678-5');
    expect(result.fields.docType).toBe('52');
    expect(result.fields.folio).toBe('67');
    expect(result.fields.fechaEmision).toBe('2026-06-11');
    expect(result.fields.montoTotal).toBe('24365');
    expect(result.tedRaw).toContain('<TED');
    // retención anclada a fecha_emision, sin marca de revisión.
    expect(result.retentionUntil).toBe('2032-06-11');
    expect(result.needsRetentionReview).toBe(false);
  });

  it('rasteriza el PDF (no preprocesa como foto) cuando el buffer es %PDF', async () => {
    const ports = makePorts();
    const ingestor = new PdfTedIngestor(ports);
    await ingestor.ingest({ buffer: PDF_BYTES, createdAt: new Date() });
    expect(ports.renderer.renderPdfPages).toHaveBeenCalledOnce();
    expect(ports.preprocessor.toImage).not.toHaveBeenCalled();
  });

  it('foto (JPEG) con PDF417 legible → preprocesa con sharp, no rasteriza', async () => {
    const ports = makePorts();
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({ buffer: JPEG_BYTES, createdAt: new Date() });
    expect(result.status).toBe('decodificado');
    expect(ports.preprocessor.toImage).toHaveBeenCalledOnce();
    expect(ports.renderer.renderPdfPages).not.toHaveBeenCalled();
  });

  it('foto sin PDF417 legible (decoder no encuentra nada) → status "fallido", sin campos', async () => {
    const ports = makePorts({ decoder: { decode: vi.fn(async () => null) } });
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({ buffer: JPEG_BYTES, createdAt: new Date() });
    expect(result.status).toBe('fallido');
  });

  it('PDF cuyo PDF417 decodifica pero el contenido NO es un TED → status "fallido"', async () => {
    const ports = makePorts({ decoder: { decode: vi.fn(async () => 'no soy un timbre') } });
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({ buffer: PDF_BYTES, createdAt: new Date() });
    expect(result.status).toBe('fallido');
  });

  it('buffer de tipo desconocido (ni PDF ni foto) → status "fallido" (no rasteriza ni preprocesa)', async () => {
    const ports = makePorts();
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({
      buffer: Uint8Array.from([0x00, 0x01, 0x02, 0x03]),
      createdAt: new Date(),
    });
    expect(result.status).toBe('fallido');
    expect(ports.renderer.renderPdfPages).not.toHaveBeenCalled();
    expect(ports.preprocessor.toImage).not.toHaveBeenCalled();
  });

  it('decodificado sin <FE> en el TED → retención fallback created_at + 6a con marca de revisión', async () => {
    const tedSinFecha = TED.replace('<FE>2026-06-11</FE>', '');
    const ports = makePorts({ decoder: { decode: vi.fn(async () => tedSinFecha) } });
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({
      buffer: PDF_BYTES,
      createdAt: new Date('2026-06-18T00:00:00Z'),
    });
    expect(result.status).toBe('decodificado');
    if (result.status !== 'decodificado') {
      return;
    }
    expect(result.retentionUntil).toBe('2032-06-18');
    expect(result.needsRetentionReview).toBe(true);
  });

  it('si el renderer del PDF lanza (PDF corrupto) → status "fallido" (no propaga)', async () => {
    const ports = makePorts({
      renderer: {
        renderPdfPages: vi.fn(async () => {
          throw new Error('pdfium: corrupt document');
        }),
      },
    });
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({ buffer: PDF_BYTES, createdAt: new Date() });
    expect(result.status).toBe('fallido');
  });

  it('decodifica el PDF417 de la primera página que lo contiene (multipágina)', async () => {
    const decode = vi
      .fn<Pdf417Decoder['decode']>()
      .mockResolvedValueOnce(null) // página 1 sin timbre
      .mockResolvedValueOnce(TED); // página 2 con timbre
    const ports = makePorts({
      renderer: { renderPdfPages: vi.fn(async () => [FAKE_IMAGE, FAKE_IMAGE]) },
      decoder: { decode },
    });
    const ingestor = new PdfTedIngestor(ports);
    const result = await ingestor.ingest({ buffer: PDF_BYTES, createdAt: new Date() });
    expect(result.status).toBe('decodificado');
    expect(decode).toHaveBeenCalledTimes(2);
  });
});
