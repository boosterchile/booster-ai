import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * PIN de activación de conductor — generación + verificación con scrypt.
 *
 * Decisiones:
 *
 * - **6 dígitos numéricos**: balance entre seguridad (10^6 = 1M combos) y
 *   usabilidad (driver lo tipea en el celular o lo lee del papel). Con
 *   rate-limiting por RUT (5 intentos / 15 min, ver D9 PR-B) el riesgo
 *   de brute force baja a despreciable.
 *
 * - **scrypt** (no bcrypt) porque viene en el stdlib de Node — sin nuevas
 *   dependencias. Parámetros recomendados para hashing de passwords
 *   cortos: N=2^14, r=8, p=1 (default seguros de Node).
 *
 * - **Formato del hash**: `salt$N$r$p$keylen$derived` (todos hex). Permite
 *   re-hash con parámetros distintos a futuro sin migración de datos.
 *
 * - **scrypt es CPU-intensivo** pero el costo es marginal (~50ms en CPU
 *   moderna). Aceptable para un endpoint de login que se usa raramente
 *   (1 vez por conductor).
 *
 * - **timingSafeEqual**: comparación constante en tiempo para evitar
 *   timing attacks sobre el hash.
 */

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 2 ** 14, r: 8, p: 1 } as const;

/** Cantidad de dígitos del PIN. 10^6 = 1M combinaciones. */
const PIN_DIGITS = 6;
const PIN_MODULUS = 10 ** PIN_DIGITS; // 1_000_000

/**
 * Mayor múltiplo de `PIN_MODULUS` que cabe en el rango de un uint32
 * (`randomBytes(4)` → [0, 2^32)). Cualquier sample `>=` este umbral cae en
 * el bloque parcial superior que el módulo sobre-representaría, así que se
 * descarta y se re-muestrea (rejection sampling). Con esto cada uno de los
 * 10^6 valores es exactamente equiprobable — sin el sesgo que marcaba
 * CodeQL `js/biased-cryptographic-random`.
 *
 * 2^32 = 4_294_967_296 → floor(2^32 / 1_000_000) * 1_000_000 = 4_294_000_000.
 * La probabilidad de rechazo es ~0.0225% (967_296 / 2^32), así que el loop
 * casi siempre termina en la primera iteración.
 */
const UINT32_RANGE = 2 ** 32; // 4_294_967_296
const REJECTION_THRESHOLD = Math.floor(UINT32_RANGE / PIN_MODULUS) * PIN_MODULUS; // 4_294_000_000

/** Fuente de bytes aleatorios. Inyectable para tests deterministas. */
export type RandomSource = (size: number) => Buffer;

/**
 * Genera un PIN de 6 dígitos numéricos cryptographically random y
 * **uniforme**. Usa rejection sampling: descarta el bloque parcial superior
 * del rango de bytes (>= REJECTION_THRESHOLD) que causaría sesgo del módulo,
 * re-muestreando hasta obtener un valor en el rango uniforme.
 *
 * @param randomSource fuente de bytes; por defecto `crypto.randomBytes`.
 *   Solo se inyecta en tests para controlar el muestreo.
 */
export function generateActivationPin(randomSource: RandomSource = randomBytes): string {
  let sample: number;
  do {
    sample = randomSource(4).readUInt32BE(0);
  } while (sample >= REJECTION_THRESHOLD);
  const n = sample % PIN_MODULUS;
  return n.toString().padStart(PIN_DIGITS, '0');
}

/**
 * Hashea un PIN con scrypt y un salt random. Formato:
 *   `<saltHex>$<N>$<r>$<p>$<keyLen>$<derivedKeyHex>`
 */
export function hashActivationPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, KEY_LEN, SCRYPT_OPTS);
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
 * Verifica un PIN candidato contra un hash almacenado. Devuelve `true` si
 * matchea. Si el formato del hash es inválido (corrupción / migración
 * incompleta) devuelve `false` (no throw — el caller responde "PIN
 * incorrecto" sin distinguir).
 */
export function verifyActivationPin(pin: string, storedHash: string): boolean {
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
    derived = scryptSync(pin, salt, keyLen, { N, r, p });
    expected = Buffer.from(derivedHex, 'hex');
  } catch {
    return false;
  }

  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
