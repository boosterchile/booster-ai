/**
 * Extracción de la IP cliente CONFIABLE del header `X-Forwarded-For`.
 * Única fuente de verdad (spec fix-xff-trust-boundary): rate-limit-pin,
 * rate-limit-signup y demo-cache-warm consumen esta función — las copias
 * locales fueron la causa raíz del bypass (cada una con su drift).
 *
 * Detrás del GCLB external (networking.tf) el LB APPENDEA
 * `<client-ip>, <lb-ip>` a lo que el cliente haya enviado: la primera
 * entry es 100% controlada por el atacante (review security 2026-06-10:
 * tomar `[0]` permitía rotar IPs falsas y anular los counters per-IP).
 * La IP que el LB realmente vio es la PENÚLTIMA entry.
 *
 * Con una sola entry (dev local sin LB, o llamada directa) usamos esa.
 * Header ausente → `'unknown'` (bucket compartido; aceptable en dev,
 * en prod el LB siempre appendea).
 *
 * SUPUESTO TOPOLÓGICO: exactamente un proxy confiable (el GCLB) delante
 * del servicio. Si algún día se agrega otro hop (CDN, proxy), la IP
 * confiable pasa a ser len-3 — actualizar acá y en los tests.
 *
 * ⚠️ MODO DE FALLO INVERSO (review security 2026-06-11): si el servicio
 * se vuelve alcanzable DIRECTO por su URL *.run.app (hoy el ingress
 * default lo permite aunque el LB sea el camino esperado), un atacante
 * que pegue directo controla TODO el header salvo la última entry que
 * appendea Cloud Run — y la penúltima vuelve a ser forjable. El cierre
 * real es restringir ingress a internal-and-cloud-load-balancing:
 * .specs/_followups/cloud-run-ingress-internal-lb.md (ALTO).
 */
export function extractClientIp(xff: string | undefined): string {
  if (!xff) {
    return 'unknown';
  }
  const entries = xff
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (entries.length === 0) {
    return 'unknown';
  }
  const trusted = entries.length >= 2 ? entries[entries.length - 2] : entries[0];
  return trusted ?? 'unknown';
}
