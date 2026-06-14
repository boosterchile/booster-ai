# Spec: fix-sse-ticket-auth

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-14
- Status: Approved
- Linked: `.specs/_followups/sse-auth-token-en-url.md` (hallazgo ALTO del spot-check 2026-06-14) + review de #451 (el security-auditor ya había señalado "sacar el token de la URL del SSE"). Es el cierre REAL de lo que #451 mitigó parcialmente.

## 1. Objective

El SSE de chat (`GET /assignments/:id/messages/stream`) autentica leyendo el **Firebase ID token** del query param `?auth=` (EventSource no soporta headers). El spot-check de prod (2026-06-14) confirmó que ese token se filtra EN CRUDO a dos sinks que ningún scrubbing de aplicación alcanza: el span de plataforma de Cloud Run (`/component=AppServer`) → Cloud Trace, y el access log de Cloud Run (`httpRequest.requestUrl`) → Cloud Logging. Un Firebase ID token es bearer (~1h, impersonación completa), replayable dentro de su validez por cualquiera con `cloudtrace.viewer`/`logging.viewer`. El objetivo es que **lo que viaje en la URL del SSE sea un ticket efímero de un solo uso**, no el token — de modo que su filtrado a telemetría sea inocuo.

## 2. Why now

Es un secreto bearer vivo filtrándose a logs/trazas en cada conexión de chat. El `RedactingSpanExporter` de #451 cubre los spans de la app pero NO la telemetría de plataforma (demostrado). El único cierre real es no poner el token en la URL.

## 3. Success criteria

- [ ] SC-1: nuevo endpoint `POST /assignments/:id/messages/stream-ticket` autenticado por el chain normal (Bearer header → firebaseAuth → userContext; NUNCA por query). Valida acceso al chat (resolveChatAccess) y emite un ticket: random ≥128 bits, guardado en Redis con TTL 60s, **single-use** (se borra al consumir), scoped a `{uid, assignmentId}`. Responde `{ticket, expiresInSec}`.
- [ ] SC-2: el SSE acepta `?ticket=` en vez de `?auth=`: valida+consume el ticket de Redis, verifica que el `assignmentId` del ticket coincide con el de la URL, y resuelve la identidad (setea `firebaseClaims.uid` del ticket → `userContextMiddleware` resuelve el user como en cualquier request). resolveChatAccess queda SIN cambios.
- [ ] SC-3: el fallback `?auth=<Firebase ID token>` se ELIMINA de `firebase-auth.ts`. Ningún Firebase ID token puede viajar más en una URL. Un `?auth=` ahora se ignora → 401.
- [ ] SC-4: el cliente (`apps/web/src/hooks/use-chat-stream.ts`) pide el ticket (POST con Bearer) y abre `EventSource(...?ticket=<ticket>)`. En reconnect pide un ticket nuevo (son single-use).
- [ ] SC-5: tests (api): mint requiere auth (401 sin Bearer); ticket single-use (segundo consumo → 401); TTL (expirado → 401); ticket de otro assignment → 401; SSE con ticket válido resuelve el user y conecta; SSE sin ticket ni Bearer → 401; `?auth=<jwt>` ya NO autentica. coverage ≥80 en el código nuevo.
- [ ] SC-6: el `RedactingSpanExporter` (#451) se MANTIENE como defensa en profundidad (no se revierte).

## 4. User-visible behaviour

Ninguno para el usuario: el chat sigue funcionando igual (el cliente hace un POST extra de ~1 round-trip antes de abrir el stream). Observable solo en telemetría: la URL del SSE ahora lleva `?ticket=<efímero>` en vez de un token bearer.

## 5. Out of scope

- Migrar EventSource a fetch-streaming (permitiría headers, elimina el query param del todo) — más invasivo; el ticket efímero resuelve el riesgo. Follow-up posible.
- Otros endpoints `?auth=` — solo el `/stream` lo usaba (firebase-auth ya restringía el fallback a paths `/stream`).
- Cambiar el WhatsApp bot u otros flujos.

## 6. Constraints

1. `userContextMiddleware` solo necesita `claims.uid` (resuelve el user por `firebase_uid` contra DB) — verificado. El ticket guarda el `uid`; el resto del chain queda intacto.
2. Redis ya está disponible en el api (`redisForRateLimit` ioredis, server.ts) — se reutiliza para el ticket store (o un cliente análogo). Fail-closed: si Redis está caído, mint y validación → error (sin ticket no hay stream; consistente con el patrón rate-limit del repo).
3. El ticket es single-use y corto: su filtrado a logs/trace post-consumo es inocuo.
4. Zero `any`; validación Zod del body/params donde aplique; logs estructurados (regla de stack Booster).

## 7. Approach

- `packages/...` o `apps/api/src/services/sse-ticket.ts`: `mintStreamTicket({redis, uid, assignmentId})` y `consumeStreamTicket({redis, ticket, assignmentId}) → uid | null` (GETDEL atómico + match de assignment).
- `chat.ts`: ruta `POST /:id/messages/stream-ticket` (tras resolveChatAccess) que llama mint.
- `firebase-auth.ts`: el branch `/stream` GET deja de leer `?auth=` como token; en su lugar, si hay `sseTicketStore` inyectado y `?ticket=`, consume el ticket → setea `firebaseClaims={uid,...}` → `next()` (sin verifyIdToken). Sin ticket → 401. Se elimina el path de token-en-query.
- `use-chat-stream.ts`: `POST stream-ticket` con `Authorization: Bearer <idToken>` → `{ticket}` → `EventSource(stream?ticket=...)`; reconnect pide ticket nuevo.

## 8. Alternatives considered

- **A. Solo bajar sampling de Cloud Trace / desactivar request-logging del path** — Rechazada: toscas, con pérdida de observabilidad, y NO cierran el leak del access log/otros sinks. Mitigación, no fix.
- **B. Cookie de sesión httpOnly para el SSE** — Rechazada: EventSource manda cookies same-origin, pero el api y la PWA están en dominios distintos (api.boosterchile.com vs app.boosterchile.com) → cookies cross-site con SameSite=None+Secure, más superficie CSRF y complejidad de set-cookie cross-domain. El ticket en query es más simple y acotado.
- **C. Mantener el token pero cifrarlo/ofuscarlo en la URL** — Rechazada: sigue siendo un secreto reutilizable en la URL; ofuscar no es cerrar.
- **D. fetch-streaming con header Authorization** — buena a futuro (elimina el query param), pero reescribe el cliente y el handler SSE; el ticket logra el objetivo de seguridad con cambio acotado. Queda como out-of-scope/follow-up.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Romper el chat realtime en la migración | M | M | Tests api + verificación manual; el flujo del cliente cambia solo en use-chat-stream.ts; rollback = revert del PR |
| Redis caído → no se puede abrir el stream | L | M | Fail-closed explícito (sin ticket no hay stream); el chat realtime es no-crítico (degrada a polling/refetch del cliente); mismo patrón que rate-limit |
| Ticket replay si no es single-use | L | H | GETDEL atómico (un solo consumo); TTL 60s; scoped a assignment+uid |
| Un caller abusa del mint para generar tickets | L | L | El mint requiere auth completa (Bearer + userContext + resolveChatAccess) — misma barrera que el resto del chat |

## 10. Test list

- T1: mint sin Bearer → 401; con Bearer + acceso al chat → 200 `{ticket}`.
- T2: consumeStreamTicket: válido → uid; segundo consumo → null (single-use); ticket inexistente/expirado → null; assignment distinto → null.
- T3: SSE `?ticket=` válido → resuelve user (firebaseClaims.uid seteado), conecta.
- T4: SSE sin ticket ni Bearer → 401; SSE con `?auth=<jwt>` → 401 (fallback eliminado).
- T5: coverage ≥80 del código nuevo (sse-ticket + branch nuevo).

## 11. Rollout

- Flag: no (cambio acoplado api+web; deben ir juntos). Deploy normal por el pipeline (merge a main → release). El api acepta SOLO ticket tras el deploy → el web debe deployar a la par (mismo release del monorepo).
- Orden: como api y web se buildean/deployan del mismo release, no hay ventana de incompatibilidad si se mergea junto. (Si el api deployara antes que el web, los clientes viejos con `?auth=` romperían el chat realtime hasta que el web actualice — aceptable: realtime no-crítico, y el deploy del monorepo es atómico por release.)
- Post-deploy: repetir el spot-check sintético (`?ticket=` aparece en la URL, NO un token; un `?auth=<jwt>` da 401) + un chat real conecta.
- Rollback: revert del PR.

## 12. Open questions

None as of 2026-06-14.

## 13. Decision log

- 2026-06-14 — Draft + decisión del PO ("construir el fix ahora"). Ticket efímero single-use (no cookie, no ofuscación); elimina el `?auth=` token; RedactingSpanExporter se mantiene como defensa en profundidad.
