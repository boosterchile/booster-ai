# Spec: fix-sse-ticket-x-empresa

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-14
- Status: Approved
- Linked: `.specs/_followups/sse-realtime-multi-empresa.md` (QUESTION del review de seguridad de `fix-sse-ticket-auth`, severidad BAJA) + `.specs/fix-sse-ticket-auth/spec.md`.

## 1. Objective

El fetch del cliente a `POST /assignments/:id/messages/stream-ticket` (`apps/web/src/hooks/use-chat-stream.ts`) usa `fetch` crudo con SOLO el header `authorization: Bearer`, sin `X-Empresa-Id`. Para un user **multi-empresa** cuya empresa activa NO es la primera membership, `userContextMiddleware` resuelve la empresa default → `resolveChatAccess` da 403 → no se emite el ticket → el chat realtime no conecta (degrada a polling). Objetivo: que el fetch del ticket mande `X-Empresa-Id` con la empresa activa de la PWA, igual que el `api-client`.

## 2. Why now

No es regresión (comportamiento idéntico al `?auth=` previo) pero quedó como QUESTION abierta del review de `fix-sse-ticket-auth`. Es un cambio acotado y cierra el follow-up. Seguridad intacta: el binding ticket↔uid↔assignment + la re-autorización del stream no cambian; mandar la empresa activa solo corrige la resolución funcional del contexto.

## 3. Success criteria

- [ ] SC-1: el fetch de `/stream-ticket` incluye `X-Empresa-Id: <empresa activa>` cuando hay una seteada (`getActiveEmpresaId()` de `api-client.ts`, fuente única de verdad — localStorage `booster.activeEmpresaId`). Si no hay empresa activa, no se manda el header (idéntico al api-client).
- [ ] SC-2: el `authorization: Bearer` sigue yendo (sin cambios). El token NUNCA va en la URL (no se regresa el fix anterior).
- [ ] SC-3: test del hook: el POST de mint se llama con `X-Empresa-Id` cuando hay empresa activa, y SIN el header cuando no la hay.
- [ ] SC-4: cero `any`; lint/typecheck/test verdes; coverage del hook no baja.

## 4. User-visible behaviour

Para users multi-empresa con chat en empresa no-default: el chat realtime ahora **conecta** en vez de caer a polling. Para el resto: sin cambio.

## 5. Out of scope

- El `EventSource` del stream no manda headers (no puede) y no lo necesita: la identidad + empresa quedan fijadas en el mint (en el ticket). Sin cambios en el server (`chat.ts` / `firebase-auth.ts` / `sse-ticket.ts`).
- Cambiar `userContextMiddleware` o la resolución de membership default.

## 6. Constraints

- Reusar `getActiveEmpresaId()` (no duplicar la key de localStorage).
- El header se llama `X-Empresa-Id` (igual que api-client, case-insensitive en HTTP).

## 7. Approach

`use-chat-stream.ts`: importar `getActiveEmpresaId` de `../lib/api-client.js`; construir los headers del POST como `{ authorization: 'Bearer <token>', ...(empresa ? { 'X-Empresa-Id': empresa } : {}) }`.

## 8. Alternatives considered

- Migrar el fetch del ticket a `api.post(...)` (api-client), que auto-inyectaría el header. Rechazada para este cambio: el api-client arma su propio `AbortController`/headers/Content-Type y el hook ya tiene su timeout de 10s + manejo de error específico; añadir un solo header es menos invasivo y no arriesga el flujo del fix anterior. La unificación del fetch del ticket con el api-client se registra como follow-up separado si se quiere consolidar.

## 9. Risks and mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| `localStorage.getItem` lanza (modo privado / storage deshabilitado) | L | L | La llamada a `getActiveEmpresaId()` ocurre DENTRO del `try` del mint; si lanzara, el `catch` degrada a reconnect/polling sin crash. Mismo riesgo que el api-client, que ya usa `localStorage`. (Los tests stubean la función, así que NO ejercitan el `getItem` real — no es mitigación, es aislamiento de test.) |
| Header mal nombrado → server lo ignora | L | M | Mismo nombre exacto que api-client (`X-Empresa-Id`), cubierto por test |
| 403 por empresa stale/revocada → reconnect loop indefinido | L | L | **Pre-existente** (el hook reintenta todo `!res.ok` por igual, no es regresión de este cambio). Ticketeado en follow-up `use-chat-stream-hardening` (política de reconnect: cortar en errores permanentes). |

## 10. Test list

- T1: con empresa activa seteada → el POST `/stream-ticket` se llama con `X-Empresa-Id: <id>`.
- T2: sin empresa activa → el POST NO lleva `X-Empresa-Id`.
- T3 (regresión): el token sigue solo en el header `authorization`, nunca en la URL.

## 11. Rollout

- Deploy normal (web) por el pipeline. Sin migraciones, sin flag. Rollback = revert.

## 12. Open questions

None.

## 13. Decision log

- 2026-06-14 — Draft + approved. Cambio mínimo (un header), sin tocar el server. Cierra el follow-up `sse-realtime-multi-empresa`.
