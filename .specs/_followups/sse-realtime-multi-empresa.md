# Follow-up: el realtime de chat asume la empresa default (users multi-empresa)

**Origen**: review de seguridad de fix-sse-ticket-auth (2026-06-14), QUESTION. NO es regresión — comportamiento idéntico al `?auth=` previo.
**Severidad**: BAJA (funcional, no seguridad — jamás concede acceso de más).

## Problema
El POST `/stream-ticket` (y antes el SSE con `?auth=`) usa raw fetch/EventSource SIN header `X-Empresa-Id`, así que `userContextMiddleware` resuelve la PRIMERA membership activa (user-context.ts). Para un user multi-empresa cuyo chat pertenece a una empresa NO-default, `resolveChatAccess` da 403 → el ticket no se emite → el chat realtime no conecta (degrada a polling/refetch; los mensajes igual se leen). Seguridad intacta: el binding ticket↔uid↔assignment + la re-autorización del stream impiden cualquier acceso indebido.

## Acción propuesta
- El cliente manda `X-Empresa-Id` (la empresa activa de la PWA) en el POST `/stream-ticket` — el api-client ya lo hace para el resto de requests (api-client.ts); el fetch del ticket debería igualarlo.
- (EventSource del stream no puede mandar header, pero ya no lo necesita: la identidad+empresa se fijan en el mint.)

## Estado
Pendiente (BAJA). Afecta solo a users multi-empresa con chat en empresa no-default.
