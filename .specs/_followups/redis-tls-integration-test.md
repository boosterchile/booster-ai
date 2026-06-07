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
Pendiente de priorizar.
