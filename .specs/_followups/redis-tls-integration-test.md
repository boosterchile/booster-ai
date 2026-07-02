# Follow-up: integration test del handshake TLS de Redis

**Origen**: REVIEW de `redis-tls-ca-pinning` (devils-advocate P0-2), 2026-06-07.
**Prioridad**: P1.

## Problema

La suite no ejercita el handshake TLS contra Memorystore. Las integration tests levantan
`redis:7-alpine` en **plaintext** (`signup-request-fail-closed.integration.test.ts:65`), así
que el bug que causó el incidente (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) es estructuralmente
indetectable. Un futuro `tls: {}` re-introducido no rompería ningún test.

Los unit tests de `buildRedisTlsOptions` prueban forma + el guard `requireCa` (comportamiento),
pero no que la **cadena CA realmente se valide** contra el servidor.

## Acción propuesta

Integration test que levante Redis con TLS + una CA propia y verifique:
- (a) con la CA correcta → conecta y opera.
- (b) con CA equivocada → el handshake **FALLA** (este es el caso que distingue el fix de
  `rejectUnauthorized:false`).

Considerar `stunnel` o un Redis con TLS configurado en el contenedor de test.

## Estado
✅ **RESUELTO (2026-06-22)** — `packages/config/src/redis-tls-handshake.test.ts`.

Implementa exactamente (a) + (b) ejercitando el handshake TLS **real** con `node:tls`
(la misma capa que ioredis usa por debajo) en vez de un container de Redis:
- (a) CA correcta pinneada (vía `buildRedisTlsOptions`) → handshake OK (authorized).
- (b) CA distinta → handshake **FALLA** (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). Es el guard
  que distingue el pinning real de `rejectUnauthorized:false`: si alguien rompiera el
  pinning, la CA equivocada se aceptaría y el test fallaría.
- (c) `requireCa` sin CA → throw (paridad con el incidente).

**Ventaja sobre stunnel/testcontainers**: NO depende de Docker → corre en cada CI (no
solo `test:integration`) y es verificable localmente. Certs efímeros con openssl en
tmpdir (TTL 1d, sin secretos versionados). Verificado verde local (node 24): 3/3.
