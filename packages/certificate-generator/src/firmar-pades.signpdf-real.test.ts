import forge from 'node-forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A DIFERENCIA de firmar-pades.test.ts, acá NO se simula @signpdf/signpdf: se
// usa la librería real sobre un PDF real con placeholder. Solo KMS va mockeado.
// Prod 2026-09-14 (BOO-BKAXIK, primer certificado que llegó a la firma):
// `SignPdfError: Signer implementation expected.` — @signpdf/signpdf 3.3.0
// exige `signer instanceof Signer` (@signpdf/utils) y se le pasaba un objeto
// plano. El test con mock lo escondía desde el primer día.
const { firmarConKmsMock } = vi.hoisted(() => ({ firmarConKmsMock: vi.fn() }));
vi.mock('./firmar-kms.js', () => ({ firmarConKms: firmarConKmsMock }));

const { firmarPades } = await import('./firmar-pades.js');
const { generarPdfBase } = await import('./generar-pdf-base.js');

const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
const cert = forge.pki.createCertificate();
cert.publicKey = keyPair.publicKey;
cert.serialNumber = '02abcd';
cert.validity.notBefore = new Date('2026-01-01');
cert.validity.notAfter = new Date('2036-01-01');
cert.setSubject([{ name: 'commonName', value: 'Booster Test CA' }]);
cert.setIssuer(cert.subject.attributes);
cert.sign(keyPair.privateKey, forge.md.sha256.create());
const certResultado = {
  certPem: forge.pki.certificateToPem(cert),
  certForge: cert,
  publicKeyPem: forge.pki.publicKeyToPem(keyPair.publicKey),
  kmsKeyVersion: '1',
};

async function pdfConPlaceholder(): Promise<Uint8Array> {
  return generarPdfBase({
    viaje: {
      trackingCode: 'BOO-BKAXIK',
      origenDireccion: 'Av. Américo Vespucio 1501, Pudahuel',
      origenRegionCode: 'XIII',
      destinoDireccion: 'Ruta 5 Norte km 470, La Serena',
      destinoRegionCode: 'IV',
      cargoTipo: 'carga_seca',
      cargoPesoKg: 8000,
      pickupAt: new Date('2026-09-14T16:44:36Z'),
      deliveredAt: new Date('2026-09-14T17:01:57Z'),
    },
    metricas: {
      distanciaKmEstimated: 500,
      distanciaKmActual: 2.51,
      kgco2eWtwEstimated: 33.475,
      kgco2eWtwActual: 2.691,
      kgco2eTtw: 2.1,
      kgco2eWtt: 0.591,
      combustibleConsumido: 0.83,
      combustibleUnidad: 'L',
      intensidadGco2ePorTonKm: 134,
      precisionMethod: 'modelado',
      glecVersion: '3.0',
      emissionFactorUsado: 3.24,
      fuenteFactores: 'GLEC v3.0',
      calculatedAt: new Date('2026-09-14T17:01:57Z'),
      routeDataSource: 'teltonika_gps',
      coveragePct: 100,
      certificationLevel: 'secundario_modeled',
    },
    empresaShipper: { id: 'emp-1', legalName: 'Fuera de la Caja', rut: '76.000.000-0' },
    transportista: { legalName: 'Transportes Van Oosterwyk', rut: null, vehiclePlate: 'JLKT54' },
    verifyUrl: 'https://api.boosterchile.com/certificates/BOO-BKAXIK/verify',
  });
}

describe('firmarPades con @signpdf/signpdf REAL', () => {
  beforeEach(() => {
    firmarConKmsMock.mockReset();
    // KMS devuelve 512 bytes cualesquiera: PKCS7 solo los embebe.
    firmarConKmsMock.mockResolvedValue({
      signature: Buffer.alloc(512, 7),
      keyVersion: '1',
      keyVersionName: 'projects/p/locations/l/keyRings/k/cryptoKeys/c/cryptoKeyVersions/1',
    });
  });

  it('acepta nuestro signer (instancia de Signer) y embebe la firma en el placeholder', async () => {
    const pdfBytes = await pdfConPlaceholder();
    const r = await firmarPades({ pdfBytes, cert: certResultado, kmsKeyId: 'projects/p/x' });
    expect(firmarConKmsMock).toHaveBeenCalledTimes(1);
    expect(r.kmsKeyVersion).toBe('1');
    expect(r.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    // El PDF firmado conserva el tamaño del original (placeholder de tamaño
    // fijo) y ya no tiene el placeholder vacío de ceros.
    expect(r.pdfFirmado.length).toBe(pdfBytes.length);
    expect(r.pdfFirmado.toString('latin1')).not.toContain(`<${'0'.repeat(64)}`);
  });
});
