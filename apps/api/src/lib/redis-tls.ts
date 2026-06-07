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
 * Comportamiento:
 *   - `tls=false`        → `undefined` (sin TLS; dev local).
 *   - `tls=true`, sin CA → `{}` (validación contra el bundle del sistema; preserva
 *     el comportamiento previo para entornos que no inyectan la CA).
 *   - `tls=true`, con CA → `{ ca: [caCert], checkServerIdentity: () => undefined }`.
 *
 * `checkServerIdentity` se deshabilita porque conectamos por **IP privada** y el CN
 * del cert es el UID de la instancia (no la IP) → sin esto, el siguiente fallo sería
 * `ERR_TLS_CERT_ALTNAME_INVALID`. La validación de **cadena CA** —el control real
 * anti-MITM— se mantiene, y la instancia vive en VPC `PRIVATE_SERVICE_ACCESS`.
 */
export function buildRedisTlsOptions(opts: {
  tls: boolean;
  caCert?: string | undefined;
}): ConnectionOptions | undefined {
  if (!opts.tls) {
    return undefined;
  }
  if (!opts.caCert) {
    return {};
  }
  return {
    ca: [opts.caCert],
    // Conexión por IP privada: el cert no lista la IP en SAN. La cadena CA ya se
    // valida contra la CA pinneada de Memorystore. Retornar undefined = OK.
    checkServerIdentity: () => undefined,
  };
}
