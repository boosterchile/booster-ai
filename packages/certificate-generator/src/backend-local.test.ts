import { createVerify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BackendLocalEnProduccionError,
  abrirBucketLocal,
  esBucketLocal,
  esKeyLocal,
  firmarConKeyLocal,
  obtenerPublicKeyLocal,
} from './backend-local.js';

describe('backend local de certificados (E2E sin KMS ni GCS)', () => {
  // RSA 4096: generar el par tarda varios segundos en un runner cargado
  // (7,6 s observado en CI); se paga una vez por archivo, fuera del timeout
  // de cada test.
  beforeAll(async () => {
    await obtenerPublicKeyLocal('local:e2e');
  }, 120_000);
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'booster-certs-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('reconoce solo los prefijos explícitos local: y file:', () => {
    expect(esKeyLocal('local:e2e')).toBe(true);
    expect(esKeyLocal('projects/p/locations/l/keyRings/r/cryptoKeys/k')).toBe(false);
    expect(esBucketLocal(`file:${dir}`)).toBe(true);
    expect(esBucketLocal('booster-ai-certificates-prod')).toBe(false);
  });

  it('firma RSA PKCS#1 v1.5 SHA-256 de 4096 bits verificable con la public key expuesta', async () => {
    const data = Buffer.from('signed attributes del PKCS7');
    const firma = await firmarConKeyLocal('local:e2e', data);
    const pub = await obtenerPublicKeyLocal('local:e2e');
    expect(firma.signature).toHaveLength(512);
    expect(firma.keyVersion).toBe(pub.keyVersion);
    expect(firma.keyVersionName).toBe('local:e2e/cryptoKeyVersions/1');
    const ok = createVerify('sha256').update(data).verify(pub.pem, firma.signature);
    expect(ok).toBe(true);
  });

  it('bucket local: save → exists → download sobre disco', async () => {
    const bucket = abrirBucketLocal(`file:${dir}`);
    const file = bucket.file('certificates/emp/BOO-1.pdf.sig');
    expect((await file.exists())[0]).toBe(false);
    await file.save('{"a":1}');
    expect((await file.exists())[0]).toBe(true);
    expect((await file.download())[0].toString('utf-8')).toBe('{"a":1}');
  });

  it('bucket local rechaza paths que escapan del directorio base', async () => {
    const bucket = abrirBucketLocal(`file:${dir}`);
    await expect(bucket.file('../fuera.pdf').save('x')).rejects.toThrow(/fuera del bucket local/);
  });

  it('bucket local no emite signed URLs', async () => {
    const bucket = abrirBucketLocal(`file:${dir}`);
    await expect(
      bucket
        .file('certificates/emp/BOO-1.pdf')
        .getSignedUrl({ action: 'read', expires: Date.now() + 1000 }),
    ).rejects.toThrow(/signed URL/);
  });

  it('NODE_ENV=production → la key y el bucket locales se niegan a operar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(firmarConKeyLocal('local:e2e', Buffer.from('x'))).rejects.toBeInstanceOf(
      BackendLocalEnProduccionError,
    );
    await expect(obtenerPublicKeyLocal('local:e2e')).rejects.toBeInstanceOf(
      BackendLocalEnProduccionError,
    );
    expect(() => abrirBucketLocal(`file:${dir}`)).toThrow(BackendLocalEnProduccionError);
  });
});
