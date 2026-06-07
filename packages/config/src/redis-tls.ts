import type { ConnectionOptions } from 'node:tls';

/**
 * Construye la opción `tls` para ioredis al conectar contra Memorystore Redis
 * con `transitEncryptionMode = SERVER_AUTHENTICATION`.
 *
 * Memorystore presenta un certificado firmado por una **CA privada por-instancia
 * de Google** que NO está en el bundle público de CAs del sistema. Al conectar con
 * `tls: {}` (validación contra el bundle por defecto), Node falla con
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` ("unable to verify the first certificate").
 * El replace de la instancia en la optimización de costos (ADR-058, 2026-06-06)
 * rotó esa CA y rompió la conexión TLS de todos los servicios. Ver
 * `.specs/redis-tls-ca-pinning/spec.md`.
 *
 * Vive en `@booster-ai/config` (no en un app) para que TODOS los servicios que
 * crean clientes Redis (api, whatsapp-bot, …) compartan la misma postura TLS.
 *
 * Comportamiento:
 *   - `tls=false`                       → `undefined` (sin TLS; dev local).
 *   - `tls=true`, sin CA, `requireCa`   → **throw** (fail-loud: en prod un CA
 *     ausente degradaría silenciosamente al estado que causó el incidente).
 *   - `tls=true`, sin CA, no `requireCa`→ `{}` (valida contra bundle del sistema;
 *     preserva el comportamiento para entornos que no inyectan CA, ej. dev).
 *   - `tls=true`, con CA                → `{ ca: [caCert], checkServerIdentity }`.
 *
 * `caCert` puede contener uno o varios certs PEM concatenados (Node parsea todos
 * los del string) — Terraform inyecta todos los `server_ca_certs` para sobrevivir
 * rotaciones de CA.
 *
 * `checkServerIdentity` se deshabilita porque conectamos por **IP privada** y el CN
 * del cert es el UID de la instancia (no la IP) → sin esto, el siguiente fallo sería
 * `ERR_TLS_CERT_ALTNAME_INVALID`. La validación de **cadena CA** —el control real
 * anti-MITM— se mantiene, y la instancia vive en VPC `PRIVATE_SERVICE_ACCESS`.
 * NUNCA se usa `rejectUnauthorized:false` (eso desactivaría toda validación).
 */
export function buildRedisTlsOptions(opts: {
  tls: boolean;
  caCert?: string | undefined;
  /** En producción debe ser `true`: sin CA, lanza en vez de degradar silenciosamente. */
  requireCa?: boolean | undefined;
}): ConnectionOptions | undefined {
  if (!opts.tls) {
    return undefined;
  }
  if (!opts.caCert) {
    if (opts.requireCa) {
      throw new Error(
        'REDIS_TLS=true pero REDIS_CA_CERT ausente: sin la CA de Memorystore el handshake ' +
          'TLS falla (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Verifica que Terraform inyecte ' +
          'REDIS_CA_CERT (server_ca_certs). Ver .specs/redis-tls-ca-pinning/spec.md.',
      );
    }
    return {};
  }
  return {
    ca: [opts.caCert],
    // Conexión por IP privada: el cert no lista la IP en SAN. La cadena CA ya se
    // valida contra la CA pinneada de Memorystore. Retornar undefined = OK.
    checkServerIdentity: () => undefined,
  };
}
