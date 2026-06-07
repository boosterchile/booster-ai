# Verify — Redis TLS CA pinning

**Fecha**: 2026-06-07
**Commit**: 38572f5

## Tests automáticos

| Suite | Resultado |
|---|---|
| `redis-tls` (helper, en `@booster-ai/config`) | 6 passed |
| api `observability` + `server` + `config` (existentes) | 111 passed (12 files) |
| `whatsapp-bot` (existentes, tras portar al helper) | 42 passed (6 files) |
| `tsc --noEmit` (config + api + whatsapp-bot) | 0 errores |
| `biome check` (archivos tocados) | limpio |
| `terraform fmt -check` + `terraform validate` | OK / Success |

> 2ª iteración BUILD (post-REVIEW): helper movido a `@booster-ai/config`; whatsapp-bot
> portado (quita `rejectUnauthorized:false`); `requireCa` fail-loud en prod; todos los
> server CA certs. Ver `review.md` §Resolución.

## Cobertura del helper (test list de spec §8)

- [x] `tls=false` → undefined (con y sin caCert).
- [x] `tls=true` sin CA → `{}` (preserva comportamiento previo).
- [x] `tls=true` con CA → `{ ca: [cert], checkServerIdentity }`; la fn retorna undefined.
- [x] NO setea `rejectUnauthorized:false` (SC-4).

## Pendiente de verificación funcional (post-deploy — SHIP)

- SC-2: `POST /api/v1/signup-request` → 202 (no 503) tras deploy + `terraform apply`.
- SC-3: cero `rate-limit-pin: Redis error` en Cloud Logging post-deploy.

Estas dos requieren el binario nuevo + la env `REDIS_CA_CERT` en prod; se validan en SHIP.

## Estado pre-deploy de prod (confirmado en diagnóstico)

- `POST /api/v1/signup-request` → 503 `Retry-After: 30` (rate-limit-signup fail-closed).
- Logs: `rate-limit-pin: Redis error — "unable to verify the first certificate"`.
- Redis instance `booster-ai-redis` READY (BASIC, 172.25.0.3:6378), AUTH MATCH, 1 server CA cert (sha1 cbbc7d16…, expira 2036).
- Login (`/auth/login-rut`) → 401 (vivo, no usa Redis). PWA + `/health` 200.
