# Spec — Redis TLS CA pinning (fix incidente 2026-06-07)

**Status**: Approved (incident hotfix, rumbo A)
**Fecha**: 2026-06-07
**Tipo**: bugfix de producción (security boundary — TLS)

## 1. Objetivo

Restaurar la conectividad TLS del API (y demás servicios) hacia Memorystore Redis,
rota desde el replace de la instancia en la optimización de costos (ADR-058, 2026-06-06).

## 2. Por qué ahora

Producción degradada: el cliente ioredis se conecta con `tls: {}` (sin CA) y valida
contra el bundle público del sistema. Memorystore con `transitEncryptionMode =
SERVER_AUTHENTICATION` presenta un cert firmado por una **CA privada por-instancia de
Google** que no está en ese bundle. El replace de cost-opt recreó la instancia → CA nueva
→ handshake TLS falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Evidencia (Cloud Logging, `booster-ai-api`, 2026-06-07):
```
msg: rate-limit-pin: Redis error
err: "unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca"
```

Impacto observado:
- `POST /api/v1/signup-request` -> 503 (`Retry-After: 30`, rate-limit-signup fail-closed).
- `rate-limit-pin` fail-closed (defensa de seguridad caída).
- ObservabilityCache degradado (cache miss -> fetch directo).
- NO afectado: login (`/auth/login-rut` no usa Redis), PWA, `/health`.

El handoff de cost-opt no lo detectó porque solo verificó `/health` y `/health/signup-flow`
(liveness — no tocan Redis).

## 3. Criterios de éxito

- SC-1: el cliente ioredis valida el cert de Memorystore contra la CA pinneada
  (`server_ca_certs[0].cert`) en lugar del bundle del sistema.
- SC-2: `POST /api/v1/signup-request` responde 202 (o 422 por body), no 503 por Redis.
- SC-3: cero `rate-limit-pin: Redis error` / `rate-limit-signup ... fail-closed` en logs
  post-deploy.
- SC-4: la validacion de cadena CA se mantiene (NO `rejectUnauthorized:false`, NO
  `NODE_TLS_REJECT_UNAUTHORIZED=0`).

## 4. Comportamiento

`buildRedisTlsOptions({ tls, caCert })`:
- `tls=false` -> `undefined` (sin TLS; dev local).
- `tls=true` + sin `caCert` -> `{}` (comportamiento previo; no rompe entornos sin CA).
- `tls=true` + `caCert` -> `{ ca: [caCert], checkServerIdentity: () => undefined }`.

`checkServerIdentity` se deshabilita porque conectamos por IP privada y el CN del cert
es el UID de la instancia, no la IP (`ERR_TLS_CERT_ALTNAME_INVALID` seria el siguiente fallo).
La validacion de cadena CA —el control real anti-MITM— se mantiene, y la instancia vive
en VPC `PRIVATE_SERVICE_ACCESS`. Patron documentado de Memorystore + TLS por IP.

## 5. Boundaries tecnicos

- `packages/config/src/schemas/redis.ts`: `REDIS_CA_CERT: z.string().optional()`.
- `apps/api/src/lib/redis-tls.ts`: helper `buildRedisTlsOptions` (+ test).
- `apps/api/src/server.ts`: cliente `redisForRateLimit` + config del factory observability.
- `apps/api/src/services/observability/{cache,factory}.ts`: propagar `tlsCa`.
- `infrastructure/compute.tf`: `REDIS_CA_CERT = google_redis_instance.main.server_ca_certs[0].cert`
  en `local.common_env_vars` (propaga a todos los services via merge).

## 6. Fuera de alcance

- Self-registration de clientes (no hay form publico; cerrado por SEC-001) — rumbo A lo deja cerrado.
- Migrar `REDIS_PASSWORD` a Secret Manager (deuda preexistente, no de este fix).
- Rotacion automatica del CA cert (valido hasta 2036-06-03).

## 7. Riesgos

- R1: `server_ca_certs[0]` podria no ser el cert activo si hubiera multiples. Verificado:
  la instancia expone 1 cert (sha1 `cbbc7d16...`, expira 2036). Bajo.
- R2: deploy requiere code + `terraform apply` (env). Ninguno empeora prod por separado
  (sin env el code devuelve `{}`; sin code el env se ignora). Sin orden-hazard.
- R3: poner el PEM en env de Cloud Run — el cert es publico (no secreto). Aceptable.

## 8. Test list

- `buildRedisTlsOptions`: tls=false -> undefined; tls=true sin CA -> {}; tls=true con CA ->
  `{ca:[cert]}` + `checkServerIdentity` definido y retornando undefined.
