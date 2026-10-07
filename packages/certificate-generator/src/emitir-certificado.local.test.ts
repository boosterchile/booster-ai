import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { obtenerPublicKeyLocal } from './backend-local.js';
import { type ParametrosEmisionCertificado, emitirCertificado } from './emitir-certificado.js';
import type { SidecarFirma } from './tipos.js';

// Emisión COMPLETA sin mocks sobre el backend local (key `local:` + bucket
// `file:`): es el camino que recorre el E2E del conductor (T10-02).
describe('emitirCertificado con backend local (sin KMS ni GCS)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'booster-certs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const params = (bucket: string): ParametrosEmisionCertificado => ({
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
    infra: { kmsKeyId: 'local:e2e', certificatesBucket: bucket },
    verifyBaseUrl: 'http://localhost:8080',
  });

  it('deja PDF firmado, sidecar y cert X.509 en disco; el cert lleva la public key local', async () => {
    const bucket = `file:${dir}`;
    const r = await emitirCertificado(params(bucket));

    expect(r.pdfGcsUri).toBe(`${bucket}/certificates/emp-1/BOO-BKAXIK.pdf`);
    expect(r.kmsKeyVersion).toBe('1');
    expect(r.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    const pdf = readFileSync(join(dir, 'certificates/emp-1/BOO-BKAXIK.pdf'));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/ByteRange');
    expect(existsSync(join(dir, 'certs/kms-key-version-1.pem'))).toBe(true);

    const sidecar: SidecarFirma = JSON.parse(
      readFileSync(join(dir, 'certificates/emp-1/BOO-BKAXIK.pdf.sig'), 'utf-8'),
    );
    expect(sidecar.kmsKeyId).toBe('local:e2e');
    expect(sidecar.pdfSha256).toBe(r.pdfSha256);
    expect(Buffer.from(sidecar.signatureB64, 'base64')).toHaveLength(512);
    expect(sidecar.verifyUrl).toBe('http://localhost:8080/certificates/BOO-BKAXIK/verify');

    const certPub = forge.pki.publicKeyToPem(
      forge.pki.certificateFromPem(sidecar.certPem).publicKey,
    );
    const { pem } = await obtenerPublicKeyLocal('local:e2e');
    expect(certPub.replace(/\s/g, '')).toBe(pem.replace(/\s/g, ''));
  });
});
