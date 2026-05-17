import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { existsMock, downloadMock, saveMock, fileMock, obtenerPublicKeyPemMock, firmarConKmsMock } =
  vi.hoisted(() => ({
    existsMock: vi.fn(),
    downloadMock: vi.fn(),
    saveMock: vi.fn(),
    fileMock: vi.fn(),
    obtenerPublicKeyPemMock: vi.fn(),
    firmarConKmsMock: vi.fn(),
  }));

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket(_name: string) {
      return {
        file: (path: string) => {
          fileMock(path);
          return { exists: existsMock, download: downloadMock, save: saveMock };
        },
      };
    }
  },
}));

vi.mock('./firmar-kms.js', () => ({
  obtenerPublicKeyPem: obtenerPublicKeyPemMock,
  firmarConKms: firmarConKmsMock,
}));

const { obtenerOEmitirCertSelfSigned } = await import('./ca-self-signed.js');

// Generamos una keypair RSA REAL solo una vez (caro ~500ms para 2048b)
// y reusamos en todos los tests. Usamos 2048 (no 4096 como prod) para no
// matar el CI.
const realKeyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
const realPublicKeyPem = forge.pki.publicKeyToPem(realKeyPair.publicKey);
const realPrivateKey = realKeyPair.privateKey;

describe('obtenerOEmitirCertSelfSigned', () => {
  beforeEach(() => {
    existsMock.mockReset();
    downloadMock.mockReset();
    saveMock.mockReset();
    fileMock.mockReset();
    obtenerPublicKeyPemMock.mockReset();
    firmarConKmsMock.mockReset();
    saveMock.mockResolvedValue(undefined);
  });

  it('hot path: cert cacheado en GCS — descarga sin emitir uno nuevo', async () => {
    const cachedCertPem = generarCertConPrivateKeyPropia();
    obtenerPublicKeyPemMock.mockResolvedValue({
      pem: realPublicKeyPem,
      keyVersion: '3',
      keyVersionName: 'projects/.../cryptoKeyVersions/3',
    });
    existsMock.mockResolvedValue([true]);
    downloadMock.mockResolvedValue([Buffer.from(cachedCertPem)]);

    const out = await obtenerOEmitirCertSelfSigned({
      kmsKeyId: 'projects/p/.../cryptoKeys/k',
      certificatesBucket: 'b',
    });

    expect(out.kmsKeyVersion).toBe('3');
    expect(out.certPem).toContain('BEGIN CERTIFICATE');
    expect(out.publicKeyPem).toBe(realPublicKeyPem);
    expect(out.certForge).toBeDefined();
    expect(fileMock).toHaveBeenCalledWith('certs/kms-key-version-3.pem');
    expect(saveMock).not.toHaveBeenCalled();
    expect(firmarConKmsMock).not.toHaveBeenCalled();
  });

  it('throw si forge.pki.oids.sha256WithRSAEncryption no está definido (defensiva)', async () => {
    obtenerPublicKeyPemMock.mockResolvedValue({
      pem: realPublicKeyPem,
      keyVersion: '9',
      keyVersionName: 'projects/.../cryptoKeyVersions/9',
    });
    existsMock.mockResolvedValue([false]);
    const original = (forge.pki.oids as any).sha256WithRSAEncryption;
    (forge.pki.oids as any).sha256WithRSAEncryption = undefined;
    try {
      await expect(
        obtenerOEmitirCertSelfSigned({
          kmsKeyId: 'k',
          certificatesBucket: 'b',
        }),
      ).rejects.toThrow(/no definido/);
    } finally {
      (forge.pki.oids as any).sha256WithRSAEncryption = original;
    }
  });

  it('cold path: cert no cacheado — emite uno nuevo, lo firma vía KMS, lo cachea', async () => {
    obtenerPublicKeyPemMock.mockResolvedValue({
      pem: realPublicKeyPem,
      keyVersion: '5',
      keyVersionName: 'projects/.../cryptoKeyVersions/5',
    });
    existsMock.mockResolvedValue([false]);
    // Firma real con la privkey local para que el cert parsee correctamente.
    firmarConKmsMock.mockImplementation(async (_keyId, tbsBuffer: Buffer) => {
      const md = forge.md.sha256.create();
      md.update(tbsBuffer.toString('binary'));
      const signatureBytes = realPrivateKey.sign(md);
      return {
        signature: Buffer.from(signatureBytes, 'binary'),
        keyVersion: '5',
        keyVersionName: 'projects/.../cryptoKeyVersions/5',
      };
    });

    const out = await obtenerOEmitirCertSelfSigned({
      kmsKeyId: 'projects/p/.../cryptoKeys/k',
      certificatesBucket: 'b',
    });

    expect(out.kmsKeyVersion).toBe('5');
    expect(out.certPem).toContain('BEGIN CERTIFICATE');

    // Verificación estructural: el cert PEM se puede parsear y tiene los
    // attrs canónicos de Booster.
    const cert = forge.pki.certificateFromPem(out.certPem);
    const cnAttr = cert.subject.getField('CN');
    expect(cnAttr?.value).toBe('Booster Carbono CL');
    const orgAttr = cert.subject.getField('O');
    expect(orgAttr?.value).toBe('Booster Chile SpA');
    const countryAttr = cert.subject.getField('C');
    expect(countryAttr?.value).toBe('CL');
    // Validez ≈ 10 años (>9.9 para tolerar el ms drift).
    const diffMs = cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime();
    const diffYears = diffMs / (365.25 * 24 * 60 * 60 * 1000);
    expect(diffYears).toBeGreaterThan(9.9);
    expect(diffYears).toBeLessThan(10.1);
    // Serial number > 0 y hex válido (16 bytes = 32 chars hex después de
    // forzar bit alto a 0).
    expect(cert.serialNumber).toMatch(/^[0-9a-f]+$/);
    expect(cert.serialNumber.length).toBeGreaterThan(0);
    // El primer byte debe tener bit alto en 0 (positivo).
    const firstByteHex = cert.serialNumber.slice(0, 2);
    expect(Number.parseInt(firstByteHex, 16)).toBeLessThan(0x80);

    // El cert se cacheó.
    expect(saveMock).toHaveBeenCalledOnce();
    const [savedPem, opts] = saveMock.mock.calls[0] ?? [];
    expect(savedPem).toBe(out.certPem);
    expect(opts.contentType).toBe('application/x-pem-file');
    expect(opts.metadata.cacheControl).toBe('public, max-age=31536000');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: genera un cert PEM autofirmado con privkey local (para simular
 * uno cacheado en GCS, sin caminar el path de KMS).
 */
function generarCertConPrivateKeyPropia(): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = realKeyPair.publicKey;
  cert.serialNumber = '0123456789abcdef';
  cert.validity.notBefore = new Date('2026-01-01');
  cert.validity.notAfter = new Date('2036-01-01');
  cert.setSubject([
    { name: 'commonName', value: 'Booster Carbono CL' },
    { name: 'countryName', value: 'CL' },
  ]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(realKeyPair.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}
