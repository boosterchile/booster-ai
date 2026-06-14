# Verify: fix-sse-ticket-auth

- Date: 2026-06-14

## Resultados
- **sse-ticket** (módulo store): 5 tests ✓ — mint hex 256-bit + TTL; consume single-use (GETDEL); inexistente/expirado → null; otro assignment → null; valor corrupto → null.
- **firebase-auth** (branch ticket, T3/T4): 4 tests nuevos ✓ — ticket válido → resuelve uid sin llamar verifyIdToken; ticket inválido → 401; sin ticket ni Bearer → 401; **el viejo `?auth=<jwt>` ya NO autentica (401, sin verifyIdToken)**. + los 7 del header path siguen verdes (sin regresión).
- **use-chat-stream** (cliente, T4): 10 tests ✓ — happy path ahora asserta `ticket=` en la URL y `NOT auth=`/`NOT firebase-id-token`, + POST al stream-ticket con Bearer header; caso nuevo: fallo del ticket → no abre EventSource + onDisconnect.
- **api suite completa**: 120 files / 1453 tests ✓ (+ los nuevos), 0 regresiones. typecheck api + web OK. Lint OK.

## Nota
- Las ~70 fallas de la suite web son PREEXISTENTES (localStorage/indexedDB/jsdom polyfill + fetch ENOTFOUND a api.test.boosterchile.com), de branches fix/web-test-* sin mergear — ajenas a este cambio. use-chat-stream.test.tsx (lo tocado) pasa 10/10.

## Pendiente (post-deploy)
- Repetir el spot-check sintético en prod: la URL del SSE muestra `?ticket=` (no token); un `?auth=<jwt>` → 401; un chat real conecta vía ticket.
