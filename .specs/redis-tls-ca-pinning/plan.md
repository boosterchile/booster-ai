# Plan — Redis TLS CA pinning

Tarea única atómica (~70 LOC, un commit squash).

### T1: pinnear CA de Memorystore en el cliente ioredis [DONE 2026-06-07]

**Dependencias**: ninguna.

Sub-pasos (un solo commit):
1. `packages/config/src/schemas/redis.ts` — añadir `REDIS_CA_CERT: z.string().optional()`.
2. `apps/api/src/lib/redis-tls.ts` — nuevo helper `buildRedisTlsOptions({ tls, caCert })`
   (comportamiento en spec §4) + `apps/api/src/lib/redis-tls.test.ts`.
3. `apps/api/src/server.ts` — usar el helper en `redisForRateLimit`; pasar
   `redisCaCert: config.REDIS_CA_CERT` al factory de observability.
4. `apps/api/src/services/observability/{cache,factory}.ts` — propagar `tlsCa` y usar el helper.
5. `infrastructure/compute.tf` — `REDIS_CA_CERT = google_redis_instance.main.server_ca_certs[0].cert`
   en `local.common_env_vars`.

**Verificación**: unit test del helper verde; `pnpm typecheck` + `pnpm lint` limpios;
`terraform validate` OK. Verificación funcional post-deploy (SC-2/SC-3) en VERIFY/SHIP.

**Estado**: pendiente.
