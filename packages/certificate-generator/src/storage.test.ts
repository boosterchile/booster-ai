import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { saveMock, getSignedUrlMock, existsMock, downloadMock, fileMock, bucketMock } = vi.hoisted(
  () => ({
    saveMock: vi.fn(),
    getSignedUrlMock: vi.fn(),
    existsMock: vi.fn(),
    downloadMock: vi.fn(),
    fileMock: vi.fn(),
    bucketMock: vi.fn(),
  }),
);

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket(name: string) {
      bucketMock(name);
      return {
        file: (path: string) => {
          fileMock(path);
          return {
            save: saveMock,
            getSignedUrl: getSignedUrlMock,
            exists: existsMock,
            download: downloadMock,
          };
        },
      };
    }
  },
}));

const {
  ArtefactoYaSubidoError,
  subirArtefactosCertificado,
  generarSignedUrlPdf,
  descargarSidecar,
  rutaPdfCertificado,
  versionDePdf,
} = await import('./storage.js');

const baseUpload = {
  bucket: 'bucket-cert',
  empresaId: 'emp-123',
  trackingCode: 'TC456',
  firma: {
    pdfFirmado: Buffer.from('PDF-bytes'),
    signatureRaw: Buffer.from([1, 2, 3]),
    pdfSha256: 'sha256hex',
    kmsKeyVersion: '7',
    signingTime: new Date('2026-05-16T12:34:56Z'),
  },
  cert: {
    certPem: '-----BEGIN CERTIFICATE-----\nabc\n',
    certForge: {},
    publicKeyPem: 'pub',
    kmsKeyVersion: '7',
  },
  kmsKeyId: 'projects/p/.../cryptoKeys/k',
  verifyBaseUrl: 'https://api.boosterchile.com',
};

describe('subirArtefactosCertificado', () => {
  beforeEach(() => {
    saveMock.mockReset();
    fileMock.mockReset();
    bucketMock.mockReset();
    saveMock.mockResolvedValue(undefined);
  });

  it('sube pdf y sidecar a paths canónicos namespaced por empresa', async () => {
    const out = await subirArtefactosCertificado(baseUpload as any);
    expect(out.pdfGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.pdf');
    expect(out.sigGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.pdf.sig');

    expect(bucketMock).toHaveBeenCalledWith('bucket-cert');
    expect(fileMock).toHaveBeenNthCalledWith(1, 'certificates/emp-123/TC456.pdf');
    expect(fileMock).toHaveBeenNthCalledWith(2, 'certificates/emp-123/TC456.pdf.sig');
  });

  it('save del PDF incluye metadata custom (tracking_code, kms_key_version, sha256)', async () => {
    await subirArtefactosCertificado(baseUpload as any);
    const [pdfBody, pdfOpts] = saveMock.mock.calls[0] ?? [];
    expect(pdfBody).toEqual(Buffer.from('PDF-bytes'));
    expect(pdfOpts.contentType).toBe('application/pdf');
    expect(pdfOpts.metadata.cacheControl).toBe('private, max-age=3600');
    expect(pdfOpts.metadata.metadata.tracking_code).toBe('TC456');
    expect(pdfOpts.metadata.metadata.kms_key_version).toBe('7');
    expect(pdfOpts.metadata.metadata.sha256).toBe('sha256hex');
    expect(pdfOpts.metadata.metadata.signed_at).toBe('2026-05-16T12:34:56.000Z');
  });

  it('sidecar JSON incluye firma base64, cert PEM y verifyUrl normalizado', async () => {
    await subirArtefactosCertificado(baseUpload as any);
    const [sigBody, sigOpts] = saveMock.mock.calls[1] ?? [];
    expect(sigOpts.contentType).toBe('application/json');
    const sidecar = JSON.parse(sigBody);
    expect(sidecar.trackingCode).toBe('TC456');
    expect(sidecar.algorithm).toBe('RSA_SIGN_PKCS1_4096_SHA256');
    expect(sidecar.signatureB64).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(sidecar.certPem).toContain('BEGIN CERTIFICATE');
    expect(sidecar.verifyUrl).toBe('https://api.boosterchile.com/certificates/TC456/verify');
  });

  it('verifyBaseUrl con trailing slash NO produce doble slash', async () => {
    await subirArtefactosCertificado({
      ...baseUpload,
      verifyBaseUrl: 'https://api.boosterchile.com/',
    } as any);
    const sigBody = saveMock.mock.calls[1]?.[0];
    const sidecar = JSON.parse(sigBody);
    expect(sidecar.verifyUrl).toBe('https://api.boosterchile.com/certificates/TC456/verify');
  });
});

describe('generarSignedUrlPdf', () => {
  beforeEach(() => {
    getSignedUrlMock.mockReset();
    fileMock.mockReset();
    getSignedUrlMock.mockResolvedValue(['https://signed.example/pdf']);
  });

  it('signed URL v4 read action con disposition attachment', async () => {
    const url = await generarSignedUrlPdf({
      bucket: 'b',
      empresaId: 'e',
      trackingCode: 'TC1',
    });
    expect(url).toBe('https://signed.example/pdf');
    expect(fileMock).toHaveBeenCalledWith('certificates/e/TC1.pdf');
    const opts = getSignedUrlMock.mock.calls[0]?.[0];
    expect(opts.version).toBe('v4');
    expect(opts.action).toBe('read');
    expect(opts.responseDisposition).toContain('attachment');
    expect(opts.responseDisposition).toContain('certificado-carbono-TC1.pdf');
  });

  it('ttlSeconds default 300 (5 min)', async () => {
    const before = Date.now();
    await generarSignedUrlPdf({ bucket: 'b', empresaId: 'e', trackingCode: 'TC2' });
    const after = Date.now();
    const opts = getSignedUrlMock.mock.calls[0]?.[0];
    expect(opts.expires).toBeGreaterThanOrEqual(before + 300_000);
    expect(opts.expires).toBeLessThanOrEqual(after + 300_000);
  });

  it('ttlSeconds explícito se respeta', async () => {
    const before = Date.now();
    await generarSignedUrlPdf({ bucket: 'b', empresaId: 'e', trackingCode: 'TC', ttlSeconds: 60 });
    const opts = getSignedUrlMock.mock.calls[0]?.[0];
    expect(opts.expires).toBeGreaterThanOrEqual(before + 60_000);
    expect(opts.expires).toBeLessThan(before + 90_000);
  });
});

describe('descargarSidecar', () => {
  beforeEach(() => {
    existsMock.mockReset();
    downloadMock.mockReset();
    fileMock.mockReset();
  });

  it('devuelve null si el sidecar no existe', async () => {
    existsMock.mockResolvedValue([false]);
    const sc = await descargarSidecar({ bucket: 'b', empresaId: 'e', trackingCode: 'X' });
    expect(sc).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('descarga y parsea JSON si existe', async () => {
    existsMock.mockResolvedValue([true]);
    const sidecar = { trackingCode: 'X', certPem: 'p' };
    downloadMock.mockResolvedValue([Buffer.from(JSON.stringify(sidecar))]);
    const out = await descargarSidecar({ bucket: 'b', empresaId: 'e', trackingCode: 'X' });
    expect(out).toEqual(sidecar);
    expect(fileMock).toHaveBeenCalledWith('certificates/e/X.pdf.sig');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('bucket file: local (E2E, T10-02)', () => {
  it('sube, descarga el sidecar y no toca GCS', async () => {
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'booster-certs-'));
    try {
      bucketMock.mockReset();
      const bucket = `file:${dir}`;
      const out = await subirArtefactosCertificado({ ...baseUpload, bucket } as never);
      expect(out.pdfGcsUri).toBe(`${bucket}/certificates/emp-123/TC456.pdf`);
      expect(existsSync(join(dir, 'certificates/emp-123/TC456.pdf'))).toBe(true);
      const sidecar = await descargarSidecar({
        bucket,
        empresaId: 'emp-123',
        trackingCode: 'TC456',
      });
      expect(sidecar?.pdfSha256).toBe('sha256hex');
      expect(
        await descargarSidecar({ bucket, empresaId: 'emp-123', trackingCode: 'OTRO' }),
      ).toBeNull();
      expect(bucketMock).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ruta por versión del certificado (reemision-certificado parte 3)', () => {
  beforeEach(() => {
    saveMock.mockReset();
    fileMock.mockReset();
    getSignedUrlMock.mockReset();
    existsMock.mockReset();
    downloadMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    getSignedUrlMock.mockResolvedValue(['https://signed']);
    existsMock.mockResolvedValue([true]);
    downloadMock.mockResolvedValue([Buffer.from('{"trackingCode":"TC456"}')]);
  });

  it('la versión 1 conserva la ruta de siempre', async () => {
    const out = await subirArtefactosCertificado({ ...baseUpload, version: 1 } as any);
    expect(out.pdfGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.pdf');
    expect(out.sigGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.pdf.sig');
  });

  it('una versión posterior sube a su propia ruta y no pisa la anterior', async () => {
    const out = await subirArtefactosCertificado({ ...baseUpload, version: 2 } as any);
    expect(out.pdfGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.v2.pdf');
    expect(out.sigGcsUri).toBe('gs://bucket-cert/certificates/emp-123/TC456.v2.pdf.sig');
    expect(fileMock.mock.calls.map((c) => c[0])).toEqual([
      'certificates/emp-123/TC456.v2.pdf',
      'certificates/emp-123/TC456.v2.pdf.sig',
    ]);
  });

  it('la URL firmada y la firma se leen de la versión pedida', async () => {
    await generarSignedUrlPdf({
      bucket: 'bucket-cert',
      empresaId: 'emp-123',
      trackingCode: 'TC456',
      version: 3,
    });
    await descargarSidecar({
      bucket: 'bucket-cert',
      empresaId: 'emp-123',
      trackingCode: 'TC456',
      version: 3,
    });
    expect(fileMock.mock.calls.map((c) => c[0])).toEqual([
      'certificates/emp-123/TC456.v3.pdf',
      'certificates/emp-123/TC456.v3.pdf.sig',
    ]);
  });

  it('sin versión, la URL firmada y la firma son las de la versión 1', async () => {
    await generarSignedUrlPdf({
      bucket: 'bucket-cert',
      empresaId: 'emp-123',
      trackingCode: 'TC456',
    });
    await descargarSidecar({ bucket: 'bucket-cert', empresaId: 'emp-123', trackingCode: 'TC456' });
    expect(fileMock.mock.calls.map((c) => c[0])).toEqual([
      'certificates/emp-123/TC456.pdf',
      'certificates/emp-123/TC456.pdf.sig',
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rechaza la versión %s', async (version) => {
    await expect(subirArtefactosCertificado({ ...baseUpload, version } as any)).rejects.toThrow(
      /versión/,
    );
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('versionDePdf', () => {
  it.each([
    ['gs://b/certificates/e/TC456.pdf', 1],
    ['gs://b/certificates/e/TC456.v2.pdf', 2],
    ['gs://b/certificates/e/TC456.v12.pdf', 12],
    ['file:/tmp/b/certificates/e/TC456.v3.pdf', 3],
    [null, 1],
    [undefined, 1],
    ['', 1],
  ])('%s → versión %s', (uri, version) => {
    expect(versionDePdf(uri)).toBe(version);
  });

  it('es la inversa de la ruta de cada versión', () => {
    for (const version of [1, 2, 7]) {
      const ruta = rutaPdfCertificado({ empresaId: 'e', trackingCode: 'TC', version });
      expect(versionDePdf(`gs://b/${ruta}`)).toBe(version);
    }
  });
});

describe('una versión posterior nunca pisa un objeto existente', () => {
  beforeEach(() => {
    saveMock.mockReset();
    fileMock.mockReset();
    saveMock.mockResolvedValue(undefined);
  });

  it('desde la versión 2 sube con la precondición de que el objeto no exista', async () => {
    await subirArtefactosCertificado({ ...baseUpload, version: 2 } as any);
    for (const [, opciones] of saveMock.mock.calls) {
      expect(opciones.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    }
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('la versión 1 sube como siempre', async () => {
    await subirArtefactosCertificado({ ...baseUpload, version: 1 } as any);
    for (const [, opciones] of saveMock.mock.calls) {
      expect(opciones.preconditionOpts).toBeUndefined();
    }
  });

  it('si el PDF de la versión ya existe, falla con un error propio y no sube la firma', async () => {
    saveMock.mockRejectedValueOnce(Object.assign(new Error('conditionNotMet'), { code: 412 }));
    await expect(
      subirArtefactosCertificado({ ...baseUpload, version: 2 } as any),
    ).rejects.toBeInstanceOf(ArtefactoYaSubidoError);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('otros errores de la subida se propagan tal cual', async () => {
    saveMock.mockRejectedValueOnce(Object.assign(new Error('red'), { code: 503 }));
    await expect(subirArtefactosCertificado({ ...baseUpload, version: 2 } as any)).rejects.toThrow(
      'red',
    );
  });
});
