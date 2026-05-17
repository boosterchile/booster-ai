import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    asymmetricSignMock.mockResolvedValue([
      { signature: Buffer.from([1, 2, 3]), verifiedDigestCrc32c: true },
    ]);

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

  it('acepta Uint8Array y normaliza a Buffer antes de hashear', async () => {
    withVersions([{ name: V1 }]);
    asymmetricSignMock.mockResolvedValue([
      { signature: new Uint8Array([9]), verifiedDigestCrc32c: true },
    ]);
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
      { signature: Buffer.from([1]), verifiedDigestCrc32c: false },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(/CRC32C/);
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
    asymmetricSignMock.mockResolvedValue([
      { signature: Buffer.from([1]), verifiedDigestCrc32c: true },
    ]);
    await expect(firmarConKms(KEY_ID, Buffer.from('x'))).rejects.toThrow(
      /No pude resolver primary version/,
    );
  });

  it('throw si el resource name no tiene cryptoKeyVersions/N', async () => {
    listCryptoKeyVersionsMock.mockResolvedValue([[{ name: 'bogus' }]]);
    asymmetricSignMock.mockResolvedValue([
      { signature: Buffer.from([1]), verifiedDigestCrc32c: true },
    ]);
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
