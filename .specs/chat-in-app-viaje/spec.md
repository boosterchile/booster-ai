# Chat in-app del viaje (sistema de registro)

**Estado**: aceptada (brief del PO, backlog #2, 2026-09-21) · **Rama**: `cursor/chat-in-app-viaje-98d8` · **Base**: `origin/main`

**Slot**: ninguno de los tres de `docs/frentes-vivos.md`. **Excepción explícita del PO**
(Felipe, 2026-09-20), acotada y ligada al Slot 3 «Conductor operativo» (canal del conductor),
mismo patrón que PR #689 (`tracking-live-unificado`). No abre serie ni frente nuevo.
**No se modifica** `docs/frentes-vivos.md`; la enmienda, si el PO la quiere, es suya.

## 1. El problema

La coordinación del viaje tiene API y UI de chat (`ChatPanel`, SSE, fallback WhatsApp),
pero el **conductor no la ve**: `/app/conductor` no monta `ChatPanel`. Generador
(`/app/cargas/$id/track`) y oficina (`/app/asignaciones/$id`) sí. El producto declara
que el chat in-app es el **sistema de registro**; WhatsApp es **solo notificación**
(alerta de no leído + deep-link). Hoy:

- El conductor no puede enviar ni leer texto in-app.
- La UI muestra «Reconectando…» de forma indefinida cuando el SSE no está live
  (incluido el fallo permanente 401/403, que ya no reintenta) y **no** degrada a
  polling aunque el comentario del API lo prometa.
- Tras recoger, `asignaciones.estado = recogido` (viaje `en_proceso`). El POST de
  mensajes exige `{asignado, en_proceso}` — `en_proceso` **no existe** en
  `estado_asignacion` → 409 `chat_closed` en el tramo T2 más operativo.
- El deep-link de WA/push apunta a `/app/chat/:id`, ruta que no existía.

## 2. Regla de producto

- **In-app es la fuente de verdad.** Texto A→B se persiste en `mensajes_chat` y se
  lee por REST + SSE (o refetch &lt; ~5 s si el stream no está live).
- **WhatsApp = notify-only.** El job `POST /admin/jobs/chat-whatsapp-fallback`
  manda el template `chat_unread_v1` (preview + deep-link). No hay bot bidireccional;
  la operación del viaje **no depende** de que WhatsApp esté configurado, el dueño
  tenga `whatsapp_e164`, ni Meta haya aprobado el template.
- Escritura: assignment `asignado` | `recogido` (viaje T2 `asignado` | `en_proceso`).
- Tras `entregado` / `cancelado`: GET y mark-read siguen; POST → 409 `chat_closed`;
  la UI pasa `readOnly` cuando conoce el estado.

## 3. Entradas y salidas

**Reuso (no se reinventan):** `apps/api/src/routes/chat.ts` (`resolveChatAccess`),
`chat-pubsub.ts`, `chat-whatsapp-fallback.ts`, `ChatPanel`, `use-chat-messages`,
`use-chat-stream`, specs `.specs/fix-sse-ticket-auth/`.

**API (arreglo de contrato ya declarado, no campo nuevo):** POST mensaje y
photo-upload-url aceptan escritura en `asignado` y `recogido`. Sigue 409 en
`entregado` y `cancelado`.

**Web:**

- `/app/conductor`: botón «Chat con el generador» en la tarjeta del servicio activo;
  overlay con el mismo `ChatPanel` y `readOnly` tras entrega en esa sesión.
- `/app/chat/$id`: landing del deep-link WA/push (mismo `ChatPanel`; 403/404 los
  resuelve `resolveChatAccess`).
- Indicador: «En vivo» solo con SSE conectado; si no, «Actualizando» + polling
  ~4 s. Nunca «Reconectando…» infinito. Nunca «En vivo» con polling.

**WhatsApp:** sin templates nuevos. El deep-link existente
`{WEB_APP_URL}/app/chat/{assignmentId}` ahora resuelve.

## 4. Criterios de salida

- [ ] Generador, oficina y conductor envían/leen texto en assignment `asignado` y
      `recogido` (viaje T2 `asignado`/`en_proceso`), mismo `resolveChatAccess`.
- [ ] Mensaje A→B visible por SSE o refetch &lt; ~5 s.
- [ ] Sin «Reconectando…» eterno; degrade honesto a polling; tests de reconnect
      con ticket nuevo (single-use).
- [ ] Tras `entregado`: `readOnly` en conductor/oficina/generador; API 409
      `chat_closed` (política documentada para el deep-link si no conoce el estado).
- [ ] WA opcional notify-only; in-app es SoR.
- [ ] Tests + PR con evidencia (rojo exhibido del 409/`recogido`, lint, typecheck,
      build).

## 5. Fuera de alcance

CRUD zonas, docs, tracking (#689), Fleet, carga de retorno, nativo, limpieza
`es_demo`, métricas north-star, rediseño de `ChatPanel`, templates WA más allá
de unread, enmendar `docs/frentes-vivos.md`.

## 6. Deudas conscientes

- `/me/assignments` no lista entregadas: el chat read-only post-entrega vive en
  la sesión de cierre (igual que el resultado del viaje).
- El fallback WA notifica al **dueño** de la empresa destinataria, no al
  conductor. El conductor se entera in-app / push.
- Re-mint al cambiar empresa activa y consolidar el fetch del ticket con
  `api-client` siguen en `.specs/_followups/use-chat-stream-hardening.md`.
