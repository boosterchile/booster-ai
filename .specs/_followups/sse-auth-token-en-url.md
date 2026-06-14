# Follow-up: el Firebase ID token del SSE viaja en la URL (?auth=) y se filtra a Cloud Trace + Cloud Logging

**Origen**: spot-check post-deploy del scrubbing de OTel (2026-06-14), validando el fix de #451 con un request sintético al SSE (`?auth=<centinela>`).
**Severidad**: ALTO. Es el MISMO hallazgo que #451 intentó cerrar, ahora demostrado como cerrado solo PARCIALMENTE.

## Evidencia (prueba sintética, token falso)

Request: `GET https://api.boosterchile.com/assignments/scrub-test/messages/stream?auth=<centinela>` → 401.
Dos superficies capturan el `?auth=` EN CRUDO (verificado en prod):
1. **Cloud Trace** — span de PLATAFORMA de Cloud Run (`/component=AppServer`, sin `g.co/agent`): `/http/url = ...?auth=<centinela>`. Lo genera la infra de Cloud Run y se exporta directo a Cloud Trace, FUERA del `RedactingSpanExporter` de #451 (que sí scrubbea el span de la app — `g.co/agent=opentelemetry-js` → `auth=[REDACTED]`).
2. **Cloud Logging** — el request log de Cloud Run (`httpRequest.requestUrl`) guarda la URL completa con el token. También lo genera la plataforma, fuera del mixin del logger.

Retención: Cloud Trace ~30d, Cloud Logging según config. Audiencia: `cloudtrace.viewer` / `logging.viewer` (devs/SRE). Un Firebase ID token (bearer, ~1h, impersonación completa del usuario) es replayable dentro de su validez.

## Por qué el scrubbing a nivel app NO basta

El `RedactingSpanExporter` (#451) y el mixin de redacción del logger solo tocan telemetría GENERADA POR LA APP. Los spans de plataforma de Cloud Run y los access logs los emite la infraestructura con la URL cruda. No hay hook de app que los intercepte.

## Fix real (lo que recomendó el security-auditor de #451)

Sacar el token de la URL. EventSource del browser no soporta headers, así que el patrón estándar es:
1. El cliente pide un **ticket de un solo uso, corta vida** a un endpoint autenticado normal (Authorization header): `POST /assignments/:id/messages/stream-ticket` → `{ticket}` (Redis, TTL ~30-60s, single-use, scoped al assignment+user).
2. El cliente abre `EventSource('/assignments/:id/messages/stream?ticket=<ticket>')`.
3. El SSE valida el ticket (lo consume de Redis) en vez del Firebase ID token.

Así, lo que viaja en la URL es un ticket efímero de un solo uso — su filtrado a logs/trace es inocuo (ya consumido / expira en segundos).
Tocaría: `apps/api` (mint + validate ticket, middleware del SSE), `apps/web` (`use-chat-stream.ts`). Ciclo agent-rigor completo (toca auth → security-auditor en review). El `RedactingSpanExporter` se mantiene como defensa en profundidad.

## Mitigación parcial mientras tanto
Ninguna a nivel app. Las palancas de infra (bajar sampling de Cloud Trace, desactivar request logging del path) son toscas y con pérdida — no se recomiendan; ir directo al fix real.

## Estado
Pendiente — decisión del PO sobre si se encara el ciclo del ticket SSE.
