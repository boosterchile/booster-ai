/**
 * Guardas de la siembra E2E de staging (.specs/e2e-staging). Puras, para
 * poder probarlas sin base ni Firebase.
 *
 * Las siembras locales (`seed-*-e2e.ts`) abortan contra una base de prod o de
 * staging y usan claves escritas en este repositorio, que es público. Esta
 * siembra es la excepción deliberada: escribe en staging, y por eso exige un
 * destino explícito, el proyecto de staging, Identity Platform real y claves
 * que vienen del entorno.
 */

export const PROYECTO_STAGING = 'booster-ai-stg-494222';

/**
 * Claves que aparecen en el código o en las specs del repo. Un usuario de
 * staging con una de estas sería una cuenta abierta: staging es alcanzable
 * desde internet.
 */
const CLAVES_PUBLICADAS = new Set(['482913', '135790', '864209', '246810']);

export interface DestinoStaging {
  projectId: string;
  databaseUrl: string;
}

export function exigirDestinoStaging(env: Record<string, string | undefined>): DestinoStaging {
  if (env.SEED_E2E_DESTINO !== 'staging') {
    throw new Error(
      'Esta siembra escribe en staging y no tiene destino implícito: define SEED_E2E_DESTINO=staging.',
    );
  }
  const projectId = env.GOOGLE_CLOUD_PROJECT;
  if (projectId !== PROYECTO_STAGING) {
    throw new Error(
      `GOOGLE_CLOUD_PROJECT debe ser ${PROYECTO_STAGING} (recibido: ${projectId ?? 'sin definir'}).`,
    );
  }
  if (env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'FIREBASE_AUTH_EMULATOR_HOST está definido: esta siembra no usa el emulador de Auth, crea las cuentas en Identity Platform de staging.',
    );
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL no está definido (la base de staging, por el túnel del bastion).',
    );
  }
  return { projectId, databaseUrl };
}

function esTrivial(clave: string): boolean {
  const digitos = [...clave].map(Number);
  const todosIguales = digitos.every((d) => d === digitos[0]);
  const sube = digitos.every((d, i) => i === 0 || d === (digitos[i - 1] ?? 0) + 1);
  const baja = digitos.every((d, i) => i === 0 || d === (digitos[i - 1] ?? 0) - 1);
  return todosIguales || sube || baja;
}

/** Devuelve la clave si son seis dígitos, no está publicada y no es trivial. */
export function exigirClaveNoPublicada(valor: string | undefined, nombre: string): string {
  if (!valor || !/^\d{6}$/.test(valor)) {
    throw new Error(`${nombre} debe ser una clave numérica de seis dígitos.`);
  }
  if (CLAVES_PUBLICADAS.has(valor)) {
    throw new Error(`${nombre} es una clave publicada en el repositorio: elige otra.`);
  }
  if (esTrivial(valor)) {
    throw new Error(`${nombre} es una clave trivial: elige otra.`);
  }
  return valor;
}

/**
 * True si la base parece la de prod: alguna de las razones sociales que usa
 * la siembra ya existe con un RUT que no es el ficticio de la siembra, es
 * decir, es la empresa real.
 */
export function esBaseDeProd(
  empresas: ReadonlyArray<{ razonSocial: string; rut: string }>,
  rutsDeLaSiembra: ReadonlyArray<string>,
): boolean {
  return empresas.some((e) => !rutsDeLaSiembra.includes(e.rut));
}
