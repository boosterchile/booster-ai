# Plan: fix-sse-ticket-auth

- Spec: .specs/fix-sse-ticket-auth/spec.md
- Created: 2026-06-14
- Status: Active

## Tasks

### T1: módulo del ticket store (TDD)
- File: apps/api/src/services/sse-ticket.ts (+ sse-ticket.test.ts)
- `mintStreamTicket({redis, uid, assignmentId})` → ticket (randomBytes hex), SET con TTL 60s, valor = `${uid}` keyed por assignment.
- `consumeStreamTicket({redis, ticket, assignmentId})` → uid|null (GETDEL atómico, match assignment).
- LOC ~60 + tests. Acceptance: T2 de la spec.

### T2: endpoint mint en chat.ts
- File: apps/api/src/routes/chat.ts (+ createChatRoutes recibe redis)
- `POST /:id/messages/stream-ticket` tras resolveChatAccess → mint → {ticket, expiresInSec}.
- Depends: T1. Acceptance: T1 de la spec.

### T3: firebaseAuth — ticket en vez de token en el SSE
- File: apps/api/src/middleware/firebase-auth.ts (+ server.ts wiring)
- Inyectar `sseTicketStore?`; branch `/stream` GET: consumir `?ticket=` → set firebaseClaims → next(); ELIMINAR el path `?auth=` token. Sin ticket → 401.
- Depends: T1. Acceptance: SC-2/SC-3, T3/T4.

### T4: cliente web
- File: apps/web/src/hooks/use-chat-stream.ts
- POST stream-ticket (Bearer) → EventSource(?ticket=); reconnect = ticket nuevo. Actualizar el comentario de auth.
- Acceptance: SC-4.

### T5: VERIFY + REVIEW
- Suite api verde, typecheck api+web, coverage; security-auditor + devils-advocate (toca auth). verify.md + review.md.

## Notas
- Redis: reutilizar el patrón de `redisForRateLimit` (server.ts). Fail-closed.
- RedactingSpanExporter (#451) se mantiene.
