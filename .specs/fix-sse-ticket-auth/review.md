# Devils-advocate review — fix-sse-ticket-auth — 2026-06-14T00:55:00Z

Base: `git diff github/main..HEAD` (rama `fix/sse-ticket-auth`). Tests corridos: sse-ticket (5 ok), firebase-auth (11 ok), use-chat-stream (10 ok). Todos verdes.

## Premise
- Asumido: el ticket en la URL es "inocuo" tras consumo. Mayormente cierto, PERO el endpoint de mint `POST /:id/messages/stream-ticket` AHORA recibe el Firebase ID token en el header `Authorization` — y la spec 1 dice que el span de PLATAFORMA de Cloud Run (`/component=AppServer`) y el access log capturan la request "EN CRUDO". Los access logs de Cloud Run NO suelen registrar headers, asi que el token del header no se filtra por la misma via que el query. Pero esto NO esta verificado en la spec: el spot-check post-deploy (11, verify.md "Pendiente") solo planea revisar la URL del `/stream`, NO confirma que el header `Authorization` del nuevo POST `/stream-ticket` no aparezca en ningun sink (p.ej. si algun dia se habilita header-logging en Cloud Armor / LB). La premisa "sacar el token de la URL cierra el leak" es correcta para el query param; queda SIN evidencia que el header no abra una superficie equivalente.
- Asumido: `userContextMiddleware` "solo necesita claims.uid" (spec 6.1, constraint "verificado"). Confirmado leyendo `user-context.ts:44` (resuelve por `firebaseUid`). Esta premisa SI se sostiene.
- Mas doloroso si es falso: que el chain aguas abajo dependa de `claims.custom` para algo de SEGURIDAD y no solo de `uid`. ES FALSO — ver Failure modes F1. demo-expires e is-demo-enforcement dependen de `custom.is_demo`, que el ticket setea a `{}`.

## Scope and second-order effects
- El SSE GET pasa por la cadena COMPLETA montada en `server.ts:439-445`: `firebaseAuth -> demoExpires -> isDemoEnforcement -> userContext`. El cambio inserta una identidad SINTETICA (`firebase-auth.ts:76-83`, `custom:{}`) que NO es equivalente a la identidad real por-token para los middlewares que leen `custom`. Consumidor downstream no consultado: el sistema de enforcement de cuentas demo (SEC-001 Sprint 2a/2b). Hyrum: dos middlewares de seguridad ya dependen de la forma observable de `firebaseClaims.custom`.
- `is-demo-enforcement` en modo `requireNotDemo` bloquea writes; el `/stream` es GET, asi que en la practica el bloqueo de writes no aplicaba al stream igual. Pero `demo-expires` SI bloquea cualquier metodo (incl. GET) si la cuenta expiro. Bajo ticket, ese bloqueo desaparece para el stream (F1).
- Segundo orden no medido: cada reconnect del cliente hace `getIdToken()` + POST mint + nuevo `SET` en Redis + GETDEL. Un cliente en loop de reconnect (red mala) genera carga de tokens+Redis proporcional al backoff. El backoff (1s->30s) lo acota, pero N pestanas x M usuarios con red intermitente = trafico de mint no presupuestado. Sin metrica de rate del mint (no hay rate-limit en `/stream-ticket`, a diferencia de otros paths que si lo tienen).

## Alternatives discarded
- Considerados en spec 8: A (sampling/log off), B (cookie httpOnly), C (cifrar token), D (fetch-streaming). Rechazos razonables y documentados. D queda como follow-up legitimo.
- NO considerada (debio estarlo): bind del ticket a la sesion/IP o a un nonce del cliente. El ticket actual es portador puro: cualquiera que lo intercepte ANTES del consumo (es de un solo uso pero hay una ventana de 60s) y llegue primero al `/stream` gana la conexion. Mitigado por HTTPS + single-use + TTL corto, pero no discutido.
- NO considerada: re-validar la cuenta demo dentro del handler del stream (o re-correr demo-expires con el uid del ticket). Habria cerrado F1 sin reescribir el cliente. No aparece en alternativas.

## Failure modes
- F1 (demo/disabled evasion — STRONG): deteccion NULA, recovery NINGUNA, costo lo paga seguridad/compliance. Una cuenta `is_demo:true` con `expires_at` pasado, o `disabled:true`, que obtiene un ticket y abre el `/stream`, NO es bloqueada. Cadena: `demo-expires.ts:166` `isDemoClaim` lee `claims.custom.is_demo`; bajo ticket `custom={}` (`firebase-auth.ts:82`) -> `false` -> passthrough sin chequear expiracion/disabled. Igual `is-demo-enforcement.ts:126`. `resolveChatAccess` (`chat.ts:140-196`) NO mira demo — solo membership. NOTA: el ticket caduca a 60s y el mint SI corre demo-expires al emitirlo, asi que una cuenta que expira ENTRE mint y open tiene <=60s de ventana; pero una cuenta YA expirada que logra mint (p.ej. expires_at justo en el borde, o cache de 60s del snapshot de demo-expires sirviendo un estado viejo) abre un stream que vive HORAS (es long-lived, `chat.ts:515` espera onAbort) sin re-chequeo. El stream sobrevive a la expiracion de la cuenta. Esto NO esta en la spec 9 Risks.
- F2 (Redis down -> contrato 503 documentado es falso): deteccion por 500, recovery cliente reintenta con backoff. La spec 6.2 y el comentario en `chat.ts:113-114` dicen mint->503. Falso: `mintStreamTicket` (`chat.ts:421-426`) llama `redis.set` SIN try/catch; si Redis tira (tras `maxRetriesPerRequest:2`), el throw sube a `app.onError` (`server.ts:789`) -> 500, no 503. El 503 solo ocurre si `opts.redis` es undefined (nunca en prod, siempre se inyecta `redisForRateLimit`). Lado consume: `consumeStreamTicket` tambien sin try/catch -> throw -> 500 en el `/stream`. Funcionalmente fail-closed (no hay stream), PERO: con `enableOfflineQueue` default=true en ioredis, los comandos pueden QUEDAR ENCOLADOS hasta reconexion en vez de rechazar rapido -> el POST mint puede colgar en vez de fallar limpio, y el cliente queda esperando el `fetch` (sin timeout en `use-chat-stream.ts:90`) en vez de caer al backoff. No hay AbortController/timeout en el fetch del ticket.
- F3 (reconnect nativo de EventSource con ticket consumido — no testeado): deteccion por 401/onerror, recovery por reconnect manual con ticket nuevo. El "baile" descrito: EventSource reconecta nativo a la MISMA URL con el ticket ya consumido (GETDEL) -> server 401 -> onerror (`use-chat-stream.ts:145`) -> `close()` + reconnect manual con ticket fresco. En teoria funciona. PERO hay una ventana: entre el `connected` inicial y el primer reconnect nativo, si la conexion se cae, EventSource puede reintentar 1+ veces con el ticket muerto ANTES de que `onerror` dispare el cierre manual — cada reintento nativo es un 401 que NO refresca ticket. Como `onerror` SI cierra y reagenda, no hay loop infinito, pero hay reintentos nativos desperdiciados (401 ruidosos en logs/metricas) en cada caida. NINGUN test cubre esto: `StubEventSource` (`use-chat-stream.test.tsx:29`) no auto-reconecta; el "reconnect pide ticket nuevo" (SC-4) NO esta verificado por test — solo el `onerror`->onDisconnect. La asercion de SC-4 es por inspeccion de codigo, no por test.
- F4 (loop de reconnect agresivo): parcialmente mitigado. Si el mint devuelve 503/500 persistente (Redis caido), el cliente entra en backoff exponencial hasta 30s (`use-chat-stream.ts:106`) — aceptable. Si devuelve 401 persistente (cuenta realmente sin acceso), MISMO backoff, reintenta indefinidamente cada 30s para siempre. No hay tope de reintentos ni circuit-breaker: una cuenta sin acceso al chat machaca `/stream-ticket` cada 30s eternamente mientras el componente este montado. Bajo, pero es ruido de auth perpetuo sin alerta.

## Reversibility
- Costo de deshacer en 30 dias: BAJO. Es revert de PR (sin migracion de datos, sin DDL). El estado en Redis (`sse-ticket:*`) es efimero (TTL 60s) -> se drena solo. Sin estado persistente. Confirmado: ningun archivo de migracion en el diff.
- Mecanismo de reversa: revert. PERO ojo — revertir RE-INTRODUCE el leak del token en la URL (el `?auth=` vuelve). Si se revierte, hay que re-evaluar el riesgo de seguridad original, no es un revert "gratis". No hay feature flag (decision consciente, spec 11: cambio acoplado api+web).

## Drift signals
- "follow-up posible" / "queda como out-of-scope/follow-up" (spec 5, 8.D): justificado, fetch-streaming es legitimamente mayor. OK.
- "aceptable: realtime no-critico" (spec 11, repetido en `use-chat-stream.ts:102`): ESTA es la racionalizacion load-bearing del rollout. Es la justificacion para NO reconocer honestamente el window de incompatibilidad de deploy. Ver Evidence.
- "El step canary-verify es placeholder (exit 0)" (contexto CLAUDE.md, no de este PR): relevante porque este cambio acoplado api+web confia en que el canary humano detecte un chat roto — pero el canary NO verifica el chat realtime. No hay gate automatico que detecte "el chat dejo de conectar".
- No hay marcadores de deuda inline sin ticket en el diff. Limpio en ese eje.

## Evidence quality
- "el chat sigue funcionando igual" (spec 4) -> Evidence: tests unitarios + verify.md "Pendiente: chat real conecta". Verdict: DEBIL. Ningun test integra mint->stream end-to-end; ningun test cubre el reconnect con ticket fresco (SC-4 sin cobertura real). El "funciona igual" descansa en verificacion manual post-deploy aun no hecha.
- "El api acepta SOLO ticket tras el deploy -> el web debe deployar a la par... el deploy del monorepo es atomico por release" (spec 11) -> Evidence: ninguna. Verdict: ABSENTE / FALSO en el peor caso. El deploy NO es atomico: api y web son servicios Cloud Run SEPARADOS, se despliegan en pasos distintos del mismo release. Hay una ventana real (segundos a minutos) donde api-nuevo + web-viejo coexisten. Clientes con web-viejo (ya cargado en el browser del usuario, NO se actualiza al hacer redeploy — el usuario tiene la PWA abierta) mandan `?auth=<token>` -> 401 -> chat realtime cae hasta que el usuario recargue la PWA. La spec lo menciona como hipotesis ("Si el api deployara antes que el web") pero lo descarta con "atomico por release", que es incorrecto para Cloud Run. Y omite el caso MAS comun: PWA ya abierta en el browser del usuario con bundle viejo, independiente del orden de deploy. Eso NO se cubre con "deploy atomico".
- "Fail-closed: mint y validacion -> error (503)" (spec 6.2) -> Evidence: codigo. Verdict: PARCIALMENTE FALSO. Es 500, no 503 (ver F2). Fail-closed si, pero el contrato HTTP documentado no matchea el codigo.
- "ticket random >=128 bits, single-use, GETDEL atomico" (SC-1, SC-2) -> Evidence: `sse-ticket.ts:37` (32 bytes=256 bits), `:57` getdel, test `sse-ticket.test.ts:41-48`. Verdict: SUFICIENTE. Esta parte esta bien construida y bien testeada.
- "el viejo ?auth= ya NO autentica -> 401" (SC-3) -> Evidence: `firebase-auth.test.ts:208-214` (asserta 401 + verifyIdToken NO llamado). Verdict: SUFICIENTE y robusta. El branch `?auth=` se elimino de verdad (no quedo dead code que un dia se reactive).
- "token NUNCA en la URL" (test web) -> Evidence: `use-chat-stream.test.tsx:112-113` (`not.toContain('auth=')`, `not.toContain('firebase-id-token')`). Verdict: SUFICIENTE para el query. El token real (`getIdToken->'firebase-id-token'`) se asserta ausente de la URL. Robusta contra regresion del leak por query.

## Verdict
APROBADO CON OBSERVACIONES — el objetivo de seguridad (sacar el token bearer del query del SSE) se logra y esta bien testeado en su nucleo. Pero hay objeciones fuertes que deben resolverse o documentarse explicitamente como riesgo aceptado ANTES de ship.

- Objeciones fuertes (resolver o documentar como waiver):
  1. F1 demo/disabled evasion: el `/stream` por ticket NO ejecuta el enforcement de cuentas demo expiradas/disabled porque `firebaseClaims.custom={}`. Una cuenta demo expirada abre y mantiene un stream long-lived. Minimo: documentar el riesgo en spec 9; mejor: re-correr demo-expires con el uid del ticket en el handler del stream, o propagar `is_demo`/`expires_at` dentro del payload del ticket y re-chequear al consumir. `firebase-auth.ts:76-83`, `demo-expires.ts:166`, `is-demo-enforcement.ts:126`.
  2. Ventana de deploy / PWA con bundle viejo: la spec afirma "deploy atomico por release" (11) — falso para Cloud Run y, sobre todo, no cubre la PWA ya cargada en el browser. El chat realtime de usuarios con bundle viejo cae a 401 hasta recargar. Reconocerlo honestamente en la spec y decidir mitigacion (p.ej. mantener el branch `?auth=` un release como deprecated, o forzar reload de la PWA por version) o aceptarlo por escrito.
  3. Contrato 503 vs 500 en Redis caido (F2): el codigo tira 500, la spec/comentarios prometen 503. Corregir el codigo (try/catch -> 503) o corregir la doc. Y agregar timeout/AbortController al `fetch` del ticket en el cliente (`use-chat-stream.ts:90`) para no colgar si el offline-queue de ioredis demora.
  4. SC-4 sin test real: "reconnect pide ticket nuevo" no esta cubierto por ningun test (el StubEventSource no reconecta). Es la afirmacion central de que el chat no se rompe en reconexion. Agregar un test que ejercite onerror->reconnect->nuevo mint con ticket distinto.

- Riesgos residuales (aceptar y documentar):
  - Reintentos nativos de EventSource con ticket muerto generan 401 ruidosos por cada caida (F3) — funcionalmente recupera, pero ensucia logs/metricas de auth. Considerar un label que distinga 401-por-ticket-consumido de 401-real.
  - Sin rate-limit ni circuit-breaker en `/stream-ticket`: una cuenta sin acceso reintenta cada 30s para siempre (F4). Bajo impacto, pero perpetuo.
  - Ticket portador puro (sin bind a IP/sesion): ventana de 60s de robo pre-consumo. Aceptable bajo HTTPS+single-use, pero no discutido en alternativas.
  - El header `Authorization` del nuevo mint no fue verificado contra sinks de plataforma (solo el query). El spot-check post-deploy debe incluirlo.

- Fuera de alcance de esta review:
  - La calidad del `RedactingSpanExporter` de #451 (se mantiene, no se toca).
  - Las ~70 fallas preexistentes de la suite web (verify.md las marca como ajenas; no verifique esa afirmacion).
  - Migracion a fetch-streaming (follow-up D legitimo).

---

## Resolución del fix-round (2026-06-14, post-review)

Veredictos: security-auditor APROBADO (0 bloqueantes, 2 QUESTIONS); devils-advocate APROBADO CON OBSERVACIONES (4 objeciones fuertes). Resueltas:

| Hallazgo (ambos convergen en el #1) | Resolución |
|---|---|
| **Demo/disabled enforcement evadido** (custom={} → el stream se saltaba demoExpires) | RESUELTO: el ticket lleva `isDemo` (del claim real al mintear); el SSE lo restituye en `firebaseClaims.custom.is_demo` → demoExpires/isDemoEnforcement corren igual que por header (expires_at/disabled lo resuelve demoExpires por uid). Tests: sse-ticket round-trip isDemo + firebase-auth propaga is_demo. SC-7 nuevo. |
| **503 vs 500 + fetch sin timeout** | RESUELTO: mint con try/catch → 503 (contrato §6.2); consumeStreamTicket atrapa error de Redis → null (fail-closed → 401); cliente con AbortController (10s). Tests: "Redis caído en consume → null". |
| **SC-4 sin test** (reconnect → ticket nuevo) | RESUELTO: test "reconnect tras onerror pide un ticket NUEVO" (onerror → backoff → 2º mint). |
| **Spec §11 "deploy atómico" falso** | RESUELTO: §11 reescrito — api/web son Cloud Run separados; una PWA ya abierta usa el bundle viejo (`?auth=`) → realtime cae a polling hasta recargar (mensajes NO se pierden); no se mantiene `?auth=` como compat (reintroduce el leak). |
| **X-Empresa-Id ausente en el mint** (multi-empresa, PREEXISTENTE, no seguridad) | Follow-up `.specs/_followups/sse-realtime-multi-empresa.md` (BAJA). |
| firebase-auth Redis outage → 500 (sugerencia) | Cubierto por el fail-closed de consume (→ 401 limpio). |

Sin objeción que sobreviva. El núcleo (token fuera de la URL, ticket CSPRNG-256 single-use scoped, RedactingSpanExporter mantenido) confirmado por ambos.
