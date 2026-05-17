import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { firmarConKmsMock, signMock } = vi.hoisted(() => ({
  firmarConKmsMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock('./firmar-kms.js', () => ({
  firmarConKms: firmarConKmsMock,
}));

vi.mock('@signpdf/signpdf', () => ({
  SignPdf: class {
    sign = signMock;
  },
}));

const { firmarPades } = await import('./firmar-pades.js');

// Generar cert real con node-forge para que las funciones ASN.1
// (issuer, serial, certificateToAsn1) funcionen.
const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
const realCert = forge.pki.createCertificate();
realCert.publicKey = keyPair.publicKey;
realCert.serialNumber = '01abcd';
realCert.validity.notBefore = new Date('2026-01-01');
realCert.validity.notAfter = new Date('2036-01-01');
realCert.setSubject([{ name: 'commonName', value: 'Test CA' }]);
realCert.setIssuer(realCert.subject.attributes);
realCert.sign(keyPair.privateKey, forge.md.sha256.create());

const fakeCertResultado = {
  certPem: forge.pki.certificateToPem(realCert),
  certForge: realCert,
  publicKeyPem: 'pub',
  kmsKeyVersion: '4',
};

describe('firmarPades', () => {
  beforeEach(() => {
    firmarConKmsMock.mockReset();
    signMock.mockReset();
    firmarConKmsMock.mockResolvedValue({
      signature: Buffer.from('SIG_RAW_FROM_KMS'),
      keyVersion: '4',
      keyVersionName: 'projects/.../cryptoKeyVersions/4',
    });
  });

  it('happy path: invoca signer, firma vía KMS, devuelve pdfFirmado+sha256+signatureRaw', async () => {
    // Simular SignPdf: invoca al signer.sign() y devuelve "PDF + pkcs7"
    signMock.mockImplementation(
      async (pdf: Buffer, signer: { sign(p: Buffer): Promise<Buffer> }) => {
        const pkcs7 = await signer.sign(pdf);
        return Buffer.concat([pdf, pkcs7]);
      },
    );

    const pdfIn = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const out = await firmarPades({
      pdfBytes: pdfIn,
      cert: fakeCertResultado as any,
      kmsKeyId: 'projects/p/.../cryptoKeys/k',
    });

    expect(out.kmsKeyVersion).toBe('4');
    expect(out.signingTime).toBeInstanceOf(Date);
    expect(out.signatureRaw.toString()).toBe('SIG_RAW_FROM_KMS');
    expect(out.pdfFirmado).toBeInstanceOf(Buffer);
    expect(out.pdfFirmado.length).toBeGreaterThan(4);
    expect(out.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    expect(firmarConKmsMock).toHaveBeenCalledOnce();
    const kmsArgs = firmarConKmsMock.mock.calls[0] ?? [];
    expect(kmsArgs[0]).toBe('projects/p/.../cryptoKeys/k');
    expect(kmsArgs[1]).toBeInstanceOf(Buffer);
    // Los signedAttrs DER deben ser un SET (tag 0x31).
    expect((kmsArgs[1] as Buffer)[0]).toBe(0x31);
  });

  it('throw "placeholder mal formado" si SignPdf.sign no invoca al signer', async () => {
    // SignPdf que NUNCA invoca signer.sign — simula PDF sin placeholder.
    signMock.mockImplementation(async (pdf: Buffer) => pdf);
    await expect(
      firmarPades({
        pdfBytes: new Uint8Array([1, 2]),
        cert: fakeCertResultado as any,
        kmsKeyId: 'k',
      }),
    ).rejects.toThrow(/placeholder mal formado/);
  });

  it('sha256 del pdfFirmado refleja el contenido real', async () => {
    signMock.mockImplementation(
      async (pdf: Buffer, signer: { sign(p: Buffer): Promise<Buffer> }) => {
        const pkcs7 = await signer.sign(pdf);
        return Buffer.concat([pdf, pkcs7]);
      },
    );

    const pdfIn = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x42]);
    const out = await firmarPades({
      pdfBytes: pdfIn,
      cert: fakeCertResultado as any,
      kmsKeyId: 'k',
    });
    // El sha256 debe ser determinístico para el mismo pdfFirmado.
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(out.pdfFirmado).digest('hex');
    expect(out.pdfSha256).toBe(expected);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
