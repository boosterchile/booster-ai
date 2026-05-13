import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * ADR-035 — Clave numérica universal del usuario (6 dígitos).
 *
 * Mismo patrón scrypt que `activation-pin.ts`, pero la responsabilidad es
 * distinta: la clave numérica persiste durante toda la vida del usuario
 * y se rota desde el perfil. El PIN de activación es single-use y se
 * borra al activar.
 *
 * Formato del hash: `<saltHex>$<N>$<r>$<p>$<keyLen>$<derivedKeyHex>`.
 * Compatible con el formato de activation-pin (permite migración trivial
 * si se quisiera reusar el PIN inicial como primera clave).
 *
 * Parámetros: N=2^14, r=8, p=1, keyLen=64. ~50ms en CPU moderna.
 */

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 2 ** 14, r: 8, p: 1 } as const;

/**
 * Hashea una clave numérica con salt random.
 */
export function hashClaveNumerica(clave: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(clave, salt, KEY_LEN, SCRYPT_OPTS);
  return [
    salt.toString('hex'),
    SCRYPT_OPTS.N,
    SCRYPT_OPTS.r,
    SCRYPT_OPTS.p,
    KEY_LEN,
    derived.toString('hex'),
  ].join('$');
}

/**
 * Verifica una clave numérica candidata contra un hash almacenado.
 * Timing-safe. Devuelve `false` si el formato del hash es inválido.
 */
export function verifyClaveNumerica(clave: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 6) {
    return false;
  }
  const saltHex = parts[0];
  const nStr = parts[1];
  const rStr = parts[2];
  const pStr = parts[3];
  const keyLenStr = parts[4];
  const derivedHex = parts[5];
  if (
    saltHex == null ||
    nStr == null ||
    rStr == null ||
    pStr == null ||
    keyLenStr == null ||
    derivedHex == null
  ) {
    return false;
  }

  const N = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  const keyLen = Number.parseInt(keyLenStr, 10);
  if (
    !Number.isFinite(N) ||
    !Number.isFinite(r) ||
    !Number.isFinite(p) ||
    !Number.isFinite(keyLen)
  ) {
    return false;
  }

  let derived: Buffer;
  let expected: Buffer;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    derived = scryptSync(clave, salt, keyLen, { N, r, p });
    expected = Buffer.from(derivedHex, 'hex');
  } catch {
    return false;
  }

  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

/**
 * Política mínima de clave: 6 dígitos numéricos exactos. La validación de
 * input está en Zod schemas (shared-schemas), pero replicamos acá un
 * helper para test rápido en service layer.
 */
export function isValidClaveFormat(clave: string): boolean {
  return /^\d{6}$/.test(clave);
}
