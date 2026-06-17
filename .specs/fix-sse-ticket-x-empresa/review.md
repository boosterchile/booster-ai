# Devils-advocate review — fix-sse-ticket-x-empresa — 2026-06-14T10:31:00Z

## Premise
- Assumed: el server valida la membership de `X-Empresa-Id` antes de mintear el ticket. CONFIRMADO — `resolveUserContext` (user-context.ts:69-77) hace `.find(m => m.empresa.id === requestedEmpresaId)` y lanza `EmpresaNotInMembershipsError` -> 403 si no hay match. El header NO concede acceso de mas.
- Asumido implicito y NO verificado por el spec: que `getActiveEmpresaId()` (raw `localStorage.getItem`, api-client.ts:31-33) nunca lanza en el contexto del hook. Es la asuncion mas fragil (ver Failure F1).
- Mas doloroso si falso: si `localStorage.getItem` lanzara (Safari modo privado viejo / storage deshabilitado), la excepcion cae DENTRO del try del mint (use-chat-stream.ts:99, dentro del try de la linea 89) -> se trata como fallo de ticket -> backoff/reconnect infinito sin stream. Degradacion silenciosa, no crash. El api-client YA usa el mismo patron sin guard y no ha sido problema, pero el spec lo declara L/L sin evidencia.

## Scope and second-order effects
- El cambio toca SOLO el header del POST del ticket. El `EventSource` sigue sin header (correcto: la empresa queda fijada en el mint). Sin cambios server.
- Segundo orden no mencionado en el spec: la empresa con la que se mintea el ticket es la `activeMembership` AL MOMENTO DEL MINT. Si el user cambia de empresa activa (setActiveEmpresaId) mientras el stream esta vivo, el stream existente NO se reabre — el `useEffect` depende de `[enabled, opts.assignmentId]` (use-chat-stream.ts:188), NO de la empresa activa. El stream sigue corriendo con el ticket viejo hasta el proximo reconnect. Funcionalmente correcto (el ticket scoped al assignment+uid sigue valido; resolveChatAccess re-autoriza por assignment, no por empresa-en-vivo) pero NADIE lo documento. Hyrum: si algun consumidor asume que cambiar empresa activa re-evalua el chat en vivo, se sorprende.
- El docblock del archivo (use-chat-stream.ts:13-21) sigue diciendo "el auth viaja en la URL" / "NO mandamos el Firebase ID token". Sigue siendo cierto, pero el bloque NO menciona X-Empresa-Id. Drift documental menor.

## Alternatives discarded
- Considerada y rechazada en spec section 8: migrar el fetch a `api.post()` del api-client (auto-inyectaria el header). Rechazo razonable (el api-client arma su propio AbortController/Content-Type y el hook ya tiene timeout de 10s). Trade-off: se DUPLICA la logica de "construir headers auth + empresa" que ya vive en `buildHeaders` (api-client.ts:43-62). Hoy son dos copias de la misma regla "Bearer + X-Empresa-Id condicional". Si manana se agrega un tercer header comun (ej. trace), hay que tocar dos sitios.
- NO considerada: fix server-side en vez de client-side. El server YA sabe que empresas son parte del assignment (carrierEmpresaId/shipperEmpresaId, chat.ts:177-181) — podria auto-seleccionar la membership del user que matchee el assignment sin depender del header del cliente. Esa alternativa elimina la clase entera de bug "empresa activa equivocada" pero no se discutio. Spec section 5 solo dice "no cambiar userContextMiddleware" sin argumentar por que el cliente debe ser la fuente de verdad.

## Failure modes
- F1 (localStorage lanza / deteccion: no hay / recovery: ninguna, cae en reconnect loop / costo: el user multi-empresa no obtiene realtime, degrada a polling — el mismo sintoma que el bug que esto arregla). Mismo riesgo preexistia en el api-client; el cambio lo extiende al hook. No bloqueante.
- F2 (empresa activa stale en localStorage apunta a una membership ya revocada / deteccion: server responde 403 empresa_forbidden en el mint / recovery: el hook trata 403 como fallo de ticket -> backoff/reconnect, reintentando el MISMO header malo indefinidamente cada <=30s / costo: reconnect loop silencioso + carga al api). El hook NO distingue 403-empresa de 503-redis (use-chat-stream.ts:113-128 trata todo `!res.ok` igual). No es regresion, pero el manejo de error es indiscriminado.
- F3 (race empresa-cambia-durante-stream / deteccion: ninguna / recovery: solo al proximo reconnect natural / costo: ventana donde el ticket se emitio con empresa A y el user ya esta en empresa B en la UI). Inocuo para seguridad (el assignment y el uid mandan), pero comportamiento no especificado.

## Reversibility
- Costo de deshacer en 30 dias: trivial. `git revert` de 2 archivos, sin migracion, sin flag, sin estado persistido (spec section 11). El ticket es efimero (TTL 60s) asi que no hay datos que limpiar.
- Mecanismo de reversa: revert del commit. Sin coordinacion server (el server ya acepta el header desde siempre via userContextMiddleware). Es lo mas limpio del cambio.

## Drift signals
- Escaneo del vocabulario anti-drift sobre el diff y el spec: sin coincidencias. No hay marcadores de deuda provisional ni de minimo-viable ni de atajo en el codigo nuevo.
- Si hay un follow-up explicito y razonado (consolidar fetch del ticket con api-client) — mencionado en spec section 8 pero SIN stub en `.specs/_followups/`. Eso es deuda no-ticketeada segun el contrato Booster: el follow-up que ORIGINO este cambio (sse-realtime-multi-empresa.md) si tiene stub; el que este cambio GENERA no. Objecion menor.

## Evidence quality
- Claim "el server valida la membership server-side, no concede acceso de mas" -> Evidencia: user-context.ts:69-77 + chat.ts:177-188 (rol derivado de empresaActivaId vs carrier/shipper del assignment) -> Veredicto: SUFICIENTE. Un user que pone una empresa a la que no pertenece recibe 403 en el mint (EmpresaNotInMembershipsError). Un user que pone una empresa a la que SI pertenece pero que NO es parte del assignment recibe 403 forbidden_not_party (chat.ts:183-188). No hay IDOR.
- Claim "el token NUNCA va en la URL / ticket single-use scoped" -> Evidencia: sse-ticket.ts:79 (GETDEL atomico = single-use), :95 (scope por assignmentId), use-chat-stream.ts:102 (token solo en header `authorization`), test :123-126 y :154-155 (URL no contiene token ni empresa) -> Veredicto: SUFICIENTE. El fix anterior NO se regresa.
- Claim "el header llega / spread condicional correcto" -> Evidencia: 13/13 tests verdes (corrido localmente), test :143-156 verifica presencia, :158-171 verifica ausencia -> Veredicto: SUFICIENTE para presencia/ausencia.
- Claim del test "headers EXACTAMENTE {authorization} prueba la ausencia de X-Empresa-Id" (test:162-163) -> Evidencia: usa `expect.objectContaining({ headers: { authorization: ... } })`. El `objectContaining` es shallow en su primer nivel, pero el valor anidado `headers` se compara por IGUALDAD ESTRICTA (no es otro `objectContaining`). Por eso un `headers` con una key extra SI falla el match -> Veredicto: SUFICIENTE, el comentario del test es correcto. Verificado: T2 pasa con el mock devolviendo null y fallaria si el header se colara.
- Claim spec section 9 "localStorage no disponible: L/L, tests stubean getActiveEmpresaId" -> Veredicto: DEBIL. El test stubea la funcion entera, asi que NUNCA ejercita el `localStorage.getItem` real. El riesgo de que `getActiveEmpresaId` lance en runtime queda SIN cobertura por construccion. La mitigacion citada no mitiga el riesgo que dice mitigar.

## Verdict
- Strong objections (must address): NINGUNA bloqueante. No hay IDOR, no hay regresion del fix anterior, el cambio es correcto y los tests pasan.
- Residual risks (accept and document):
  1. (FUERTE) Manejo de error indiscriminado: un 403 por empresa stale/revocada (F2) entra en reconnect loop identico a un 503 transitorio. No es regresion, pero vale un short-circuit (no reintentar en 403). Decidir explicitamente: se acepta el loop silencioso?
  2. (MENOR) Comportamiento no especificado: cambiar empresa activa durante un stream vivo NO re-mintea (dep array no incluye empresa). Documentar en spec section 4 que es esperado.
  3. (MENOR) Deuda no-ticketeada: el follow-up "consolidar fetch del ticket con api-client" (spec section 8) no tiene stub en `.specs/_followups/`. Crearlo o borrar la mencion.
  4. (MENOR) Spec section 9 sobre-vende la mitigacion de "localStorage no disponible": los tests stubean la funcion, asi que el riesgo real (getItem lanza) queda sin cobertura. Corregir el texto del riesgo.
  5. (MENOR) El docblock del hook (use-chat-stream.ts:13-21) no menciona X-Empresa-Id. Actualizar para que el por-que del header quede en el archivo, no solo en el spec.
- Out of scope for this review: el diseno de la resolucion de membership default (userContextMiddleware), el fix-sse-ticket-auth ya mergeado (#461), la arquitectura de Pub/Sub del stream.
