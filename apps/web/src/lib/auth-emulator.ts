/**
 * Origen del Firebase Auth emulator para el cliente web.
 *
 * Slot 3 paso 6: con `VITE_USE_AUTH_EMULATOR=true` el cliente SOLO puede
 * pegarle a loopback. Un host distinto (Identity Platform, un túnel, un
 * IP público) se rechaza en boot — no hay fallback silencioso a prod.
 */

export const AUTH_EMULATOR_DEFAULT_ORIGIN = 'http://127.0.0.1:9099';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function resolveAuthEmulatorOrigin(raw: string | undefined): string {
  const origin = (raw?.trim() ? raw.trim() : AUTH_EMULATOR_DEFAULT_ORIGIN).replace(/\/$/, '');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`VITE_AUTH_EMULATOR_URL inválida: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`VITE_AUTH_EMULATOR_URL debe ser http(s). Recibido: ${parsed.protocol}`);
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `VITE_USE_AUTH_EMULATOR=true solo admite un emulador en loopback (127.0.0.1/localhost). Recibido: ${parsed.hostname}. No se conecta a Identity Platform.`,
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}
