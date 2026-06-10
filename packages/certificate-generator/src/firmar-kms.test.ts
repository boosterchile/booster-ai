import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crc32c } from './crc32c.js';

const { asymmetricSignMock, getPublicKeyMock, listCryptoKeyVersionsMock } = vi.hoisted(() => ({
  asymmetricSignMock: vi.fn(),
  getPublicKeyMock: vi.fn(),
  listCryptoKeyVersionsMock: vi.fn(),
}));

vi.mock('@google-cloud/kms', () => ({
  KeyManagementServiceClient: class {
    asymmetricSign = asymmetricSignMock;
    getPublicKey = getPublicKeyMock;
    listCryptoKeyVersions = listCryptoKeyVersionsMock;
  },
}));

const { firmarConKms, obtenerPublicKeyPem } = await import('./firmar-kms.js');

const KEY_ID = 'projects/p/locations/global/keyRings/r/cryptoKeys/k';
const V1 = `${KEY_ID}/cryptoKeyVersions/1`;
const V2 = `${KEY_ID}/cryptoKeyVersions/2`;

/**
 * Respuesta KMS bien formada: TODOS los campos de integridad presentes y
 * consistentes. El código de producción es fail-closed ante ausencia
 * (review security 2026-06-10) — KMS real siempre los puebla.
 */
function okSignResponse(signature: Buffer | Uint8Array, name: string) {
  const buf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  return {
    signature,
    verifiedDigestCrc32c: true,
    name,
    signatureCrc32c: { value: String(crc32c(buf)) },
  };
}

describe('firmarConKms', () => {
  beforeEach(() => {
    asymmetricSignMock.mockReset();
    listCryptoKeyVersionsMock.mockReset();
  });

  function withVersions(versions: Array<{ name: string }>) {
    listCryptoKeyVersionsMock.mockResolvedValue([versions]);
  }

  it('elige version más alta ENABLED y firma con digest sha256 de data', async () => {
    withVersions([{ name: V1 }, { name: V2 }]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(Buffer.from([1, 2, 3]), V2)]);

    const out = await firmarConKms(KEY_ID, Buffer.from('hola'));
    expect(out.keyVersion).toBe('2');
    expect(out.keyVersionName).toBe(V2);
    expect(out.signature).toBeInstanceOf(Buffer);
    expect(out.signature.toString('hex')).toBe('010203');

    expect(asymmetricSignMock).toHaveBeenCalledOnce();
    const args = asymmetricSignMock.mock.calls[0]?.[0];
    expect(args.name).toBe(V2);
    expect(args.digest.sha256).toHaveLength(32);
  });

  it('envía digestCrc32c con el CRC32C correcto del digest sha256 (Int64Value)', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(Buffer.from([1]), V1)]);

    await firmarConKms(KEY_ID, Buffer.from('hola'));

    const args = asymmetricSignMock.mock.calls[0]?.[0];
    const expectedDigest = createHash('sha256').update(Buffer.from('hola')).digest();
    expect(args.digestCrc32c).toEqual({ value: String(crc32c(expectedDigest)) });
  });

  it('throw si verifiedDigestCrc32c viene undefined (server no confirmó integridad)', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { ...okSignResponse(Buffer.from([1]), V1), verifiedDigestCrc32c: undefined },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/verifiedDigestCrc32c/);
  });

  it('throw si signatureCrc32c no coincide con la firma recibida', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      {
        ...okSignResponse(Buffer.from([1, 2, 3]), V1),
        signatureCrc32c: { value: '12345' }, // CRC incorrecto a propósito
      },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /signatureCrc32c no coincide/,
    );
  });

  it('throw si KMS responde con un name distinto a la versión solicitada', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      {
        ...okSignResponse(Buffer.from([1]), `${KEY_ID}/cryptoKeyVersions/99`),
      },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /name distinto a la versión solicitada/,
    );
  });

  it('happy path completo: CRCs y name consistentes', async () => {
    withVersions([{ name: V1 }, { name: V2 }]);
    const signature = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(signature, V2)]);

    const out = await firmarConKms(KEY_ID, Buffer.from('hola'));
    expect(out.signature.equals(signature)).toBe(true);
    expect(out.keyVersion).toBe('2');
  });

  it('throw si signatureCrc32c viene AUSENTE (fail-closed, no skip)', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { ...okSignResponse(Buffer.from([1]), V1), signatureCrc32c: undefined },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /no devolvió signatureCrc32c/,
    );
  });

  it('throw si name viene AUSENTE (fail-closed)', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { ...okSignResponse(Buffer.from([1]), V1), name: undefined },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/ausente/);
  });

  it('acepta signatureCrc32c como Long de protobufjs (toNumber)', async () => {
    withVersions([{ name: V1 }]);
    const signature = Buffer.from([7, 7, 7]);
    asymmetricSignMock.mockResolvedValue([
      {
        ...okSignResponse(signature, V1),
        signatureCrc32c: { toNumber: () => crc32c(signature) }, // Long-like
      },
    ]);
    const out = await firmarConKms(KEY_ID, Buffer.from('x'));
    expect(out.signature.equals(signature)).toBe(true);
  });

  it('acepta signatureCrc32c como {value: Long} anidado', async () => {
    withVersions([{ name: V1 }]);
    const signature = Buffer.from([8, 8]);
    asymmetricSignMock.mockResolvedValue([
      {
        ...okSignResponse(signature, V1),
        signatureCrc32c: { value: { toNumber: () => crc32c(signature) } },
      },
    ]);
    const out = await firmarConKms(KEY_ID, Buffer.from('x'));
    expect(out.signature.equals(signature)).toBe(true);
  });

  it('throw si signatureCrc32c tiene formato no reconocido', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { ...okSignResponse(Buffer.from([1]), V1), signatureCrc32c: { raro: true } },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/formato no reconocido/);
  });

  it('acepta Uint8Array y normaliza a Buffer antes de hashear', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(new Uint8Array([9]), V1)]);
    const out = await firmarConKms(KEY_ID, new Uint8Array([0xab]));
    expect(out.signature).toBeInstanceOf(Buffer);
    expect(out.signature[0]).toBe(9);
  });

  it('throw si KMS devuelve signature vacía', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([{ signature: undefined }]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/signature vacía/);
  });

  it('throw si CRC32C verification fail (verifiedDigestCrc32c=false)', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { ...okSignResponse(Buffer.from([1]), V1), verifiedDigestCrc32c: false },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/verifiedDigestCrc32c/);
  });

  it('throw si no hay versions ENABLED', async () => {
    withVersions([]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /no tiene ninguna version ENABLED/,
    );
  });

  it('throw si la version primary no tiene .name property', async () => {
    // primary = {} → truthy pero sin name → cae en if (!primary?.name)
    listCryptoKeyVersionsMock.mockResolvedValue([[{}]]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(Buffer.from([1]), V1)]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /No pude resolver primary version/,
    );
  });

  it('throw si el resource name no tiene cryptoKeyVersions/N', async () => {
    listCryptoKeyVersionsMock.mockResolvedValue([[{ name: 'bogus' }]]);
    asymmetricSignMock.mockResolvedValue([okSignResponse(Buffer.from([1]), 'bogus')]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /No pude parsear key version/,
    );
  });
});

describe('obtenerPublicKeyPem', () => {
  beforeEach(() => {
    getPublicKeyMock.mockReset();
    listCryptoKeyVersionsMock.mockReset();
  });

  it('devuelve pem + keyVersion + keyVersionName de la PRIMARY', async () => {
    listCryptoKeyVersionsMock.mockResolvedValue([[{ name: V1 }, { name: V2 }]]);
    getPublicKeyMock.mockResolvedValue([{ pem: '-----BEGIN PUBLIC KEY-----\n...\n' }]);

    const out = await obtenerPublicKeyPem(KEY_ID);
    expect(out.pem).toContain('BEGIN PUBLIC KEY');
    expect(out.keyVersion).toBe('2');
    expect(out.keyVersionName).toBe(V2);
    expect(getPublicKeyMock).toHaveBeenCalledWith({ name: V2 });
  });

  it('throw si pem vacío', async () => {
    listCryptoKeyVersionsMock.mockResolvedValue([[{ name: V1 }]]);
    getPublicKeyMock.mockResolvedValue([{ pem: '' }]);
    await expect(obtenerPublicKeyPem(KEY_ID)).rejects.toThrow(/pem vacío/);
  });

  it('throw si versionName no tiene cryptoKeyVersions/N', async () => {
    listCryptoKeyVersionsMock.mockResolvedValue([[{ name: 'corrupto-sin-version' }]]);
    getPublicKeyMock.mockResolvedValue([{ pem: 'pem' }]);
    await expect(obtenerPublicKeyPem(KEY_ID)).rejects.toThrow(/No pude parsear key version/);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});
