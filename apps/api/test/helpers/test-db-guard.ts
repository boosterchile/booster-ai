/** Hosts aceptados: loopback local. CI (ci.yml, job integration-tests) usa `localhost`. */
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Aborta ANTES de conectar si TEST_DATABASE_URL no es una BD local de test:
 * host loopback, sin socket `?host=` (p. ej. /cloudsql) y DB con prefijo `test`.
 * globalSetup hace DROP SCHEMA public CASCADE; este guard es lo único que lo frena.
 */
export function assertTestDbUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL válida. Aborto sin conectar.');
  }
  const segura = `${u.protocol}//${u.username ? `${u.username}:***@` : ''}${u.host}${u.pathname}`;
  // `..` en el path: URL lo normaliza (/x/../test → /test); se rechaza el input crudo.
  if (!HOSTS_LOCALES.has(u.hostname) || u.searchParams.has('host') || raw.includes('..')) {
    throw new Error(
      `TEST_DATABASE_URL debe ser local (localhost, 127.0.0.1 o ::1, sin ?host=). Recibí ${segura}. Aborto sin conectar.`,
    );
  }
  if (!decodeURIComponent(u.pathname.slice(1)).startsWith('test')) {
    throw new Error(
      `El nombre de la DB en TEST_DATABASE_URL debe empezar por "test". Recibí ${segura}. Aborto sin conectar.`,
    );
  }
}
