import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { caMock, pdfMock, padesMock, storageMock } = vi.hoisted(() => ({
  caMock: vi.fn(),
  pdfMock: vi.fn(),
  padesMock: vi.fn(),
  storageMock: vi.fn(),
}));

vi.mock('./ca-self-signed.js', () => ({ obtenerOEmitirCertSelfSigned: caMock }));
vi.mock('./generar-pdf-base.js', () => ({ generarPdfBase: pdfMock }));
vi.mock('./firmar-pades.js', () => ({ firmarPades: padesMock }));
vi.mock('./storage.js', () => ({ subirArtefactosCertificado: storageMock }));

const { emitirCertificado } = await import('./emitir-certificado.js');

const baseParams = {
  viaje: { trackingCode: 'TC42', origenLabel: 'A', destinoLabel: 'B' },
  metricas: { co2eKg: 100 },
  empresaShipper: { id: 'emp-1', razonSocial: 'X SpA' },
  transportista: { nombre: 'Juan', rut: '11.111.111-1' },
  infra: {
    kmsKeyId: 'projects/p/.../cryptoKeys/k',
    certificatesBucket: 'b-cert',
  },
  verifyBaseUrl: 'https://api.boosterchile.com',
};

describe('emitirCertificado', () => {
  const fakeCert = {
    certPem: '-----BEGIN CERTIFICATE-----\n',
    certForge: {},
    publicKeyPem: 'pub',
    kmsKeyVersion: '7',
  };
  const fakePdf = Buffer.from('PDF-BASE');
  const fakeFirma = {
    pdfFirmado: Buffer.from('PDF-SIGNED'),
    signatureRaw: Buffer.from([1, 2, 3]),
    pdfSha256: 'sha256hex',
    kmsKeyVersion: '7',
    signingTime: new Date('2026-05-16T12:00:00Z'),
  };
  const fakeUpload = {
    pdfGcsUri: 'gs://b-cert/certificates/emp-1/TC42.pdf',
    sigGcsUri: 'gs://b-cert/certificates/emp-1/TC42.pdf.sig',
  };

  beforeEach(() => {
    caMock.mockReset().mockResolvedValue(fakeCert);
    pdfMock.mockReset().mockResolvedValue(fakePdf);
    padesMock.mockReset().mockResolvedValue(fakeFirma);
    storageMock.mockReset().mockResolvedValue(fakeUpload);
  });

  it('orquesta cert → pdf → firma → upload y compone el resultado', async () => {
    const out = await emitirCertificado(baseParams as any);

    expect(caMock).toHaveBeenCalledWith({
      kmsKeyId: 'projects/p/.../cryptoKeys/k',
      certificatesBucket: 'b-cert',
    });
    expect(pdfMock).toHaveBeenCalledOnce();
    expect(padesMock).toHaveBeenCalledWith({
      pdfBytes: fakePdf,
      cert: fakeCert,
      kmsKeyId: 'projects/p/.../cryptoKeys/k',
    });
    expect(storageMock).toHaveBeenCalledOnce();

    expect(out.pdfGcsUri).toBe(fakeUpload.pdfGcsUri);
    expect(out.sigGcsUri).toBe(fakeUpload.sigGcsUri);
    expect(out.pdfSha256).toBe('sha256hex');
    expect(out.kmsKeyVersion).toBe('7');
    expect(out.issuedAt).toEqual(fakeFirma.signingTime);
    expect(out.pdfBytes).toBe(fakeFirma.pdfFirmado.length);
  });

  it('pasa verifyUrl normalizado (sin trailing slash) al PDF', async () => {
    await emitirCertificado({ ...baseParams, verifyBaseUrl: 'https://x.com/' } as any);
    const pdfArgs = pdfMock.mock.calls[0]?.[0];
    expect(pdfArgs.verifyUrl).toBe('https://x.com/certificates/TC42/verify');
  });

  it('pasa transportista al PDF solo si está presente', async () => {
    await emitirCertificado(baseParams as any);
    expect(pdfMock.mock.calls[0]?.[0].transportista).toBeDefined();

    pdfMock.mockClear();
    const sinTransportista = { ...baseParams };
    (sinTransportista as { transportista?: unknown }).transportista = undefined;
    await emitirCertificado(sinTransportista as any);
    expect(pdfMock.mock.calls[0]?.[0].transportista).toBeUndefined();
  });

  it('propaga errores del cert step sin tocar pdf/firma/upload', async () => {
    caMock.mockRejectedValueOnce(new Error('KMS no disponible'));
    await expect(emitirCertificado(baseParams as any)).rejects.toThrow('KMS no disponible');
    expect(pdfMock).not.toHaveBeenCalled();
    expect(padesMock).not.toHaveBeenCalled();
    expect(storageMock).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
