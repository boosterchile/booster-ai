# Spec: chat-destinatario-conductor

- **Author**: agente (Cursor), por pedido del PO (opción 3 del plan post-deploy: spec chat destinatario–conductor)
- **Date**: 2026-11-16
- **Status**: **DRAFT / no rige / pendiente visto del PO.** No aceptada. No autoriza código, migración, feature flag ni deploy.
- **Linked**: legado **PR-L5** (`docs/handoff/2026-05-10-eco-route-loop-closure.md`, `docs/handoff/2026-05-10-feedback-feature-end-to-end.md`); `.specs/seguimiento-publico-minimizacion/`; chat shipper↔transportista (`apps/api/src/routes/chat.ts`, `mensajes_chat`); token público `assignments.tracking_token_publico`; `consignee` en `trip-request-create.ts`
- **Frente**: no inventa frente nuevo. Es el trabajo abierto «Etapas 0–2 — chat destinatario–conductor» ya listado en `docs/handoff/CURRENT.md`. Fuera de slot; no toca drafts #748 / #876 / #877; **no** enciende `RUTAS_API_ACTIVADA` ni matching `activa`.

## 1. Objetivo

Permitir que el **destinatario** (consignee) y el **conductor** intercambien mensajes de texto durante el viaje **sin que el destinatario tenga cuenta ni sesión**, autenticándose solo con el **token público de seguimiento** ya emitido al asignar. El chat shipper↔transportista existente no se mezcla con este canal.

Hasta el visto del PO, este documento fija el contrato propuesto (entradas, salidas, criterios). **No se escribe código.**

## 2. Estado verificado (2026-11-16, `main` post-#967)

| Pieza | Hecho |
|---|---|
| Seguimiento público | `GET /public/tracking/:token` + UI `/tracking/$token` sin auth; token UUID en `asignaciones.tracking_token_publico`; expiración `tracking_token_expira_en` / derivada |
| Minimización | `.specs/seguimiento-publico-minimizacion/` aceptada: zona origen/destino, patente enmascarada, sin nombre de conductor en la página pública |
| Datos del destinatario | Opt-in en create/edit: `consignee.name`, `phone_e164`, `email` → columnas `destinatario_*` en la carga |
| Chat actual | `mensajes_chat`: FK **notNull** a `empresas` + `users`; enum `rol_remitente_chat` ∈ {`transportista`, `generador_carga`}; endpoints autenticados bajo `/assignments/:id/messages` |
| Comentario de producto | `trip-request-create.ts` ya anuncia rol abstracto conductor↔destinatario como «futuro PR-L5» |
| Diseño legado PR-L5 | Tabla separada `public_tracking_messages` con `direction` enum — el consignee **no** es empresa ni user |

**Conclusión de cimiento:** reutilizar `mensajes_chat` tal cual **rompe** el modelo (FK obligatorias). La propuesta DRAFT sigue el diseño preliminar del handoff: **tabla y API públicas propias**, ancladas al token / asignación, no al membership.

## 3. Entradas

| Entrada | Origen / forma |
|---|---|
| Token público válido y no expirado | UUID de `asignaciones.tracking_token_publico`; mismas reglas de vigencia que `get-public-tracking` |
| Identidad del destinatario en el canal | El portador del token (sin Firebase Auth). No se exige que `consignee` esté poblado para leer el seguimiento; para **escribir** chat se exige al menos un mensaje con contenido válido (ver §5) |
| Identidad del conductor | Usuario autenticado (Firebase + RUT) que es el conductor de la asignación (`conductorDeAsignacion` / membership transportista con capacidad de viaje), o la UI conductor ya autenticada |
| Asignación en curso | `estado_asignacion` ∈ {`asignado`, `recogido`} para escritura; tras `entregado` / `cancelado` → solo lectura (espejo del chat B2B) |
| Contenido | v1: solo `texto` (1…4000 chars). Foto y ubicación **fuera** de v1 |
| Rate / abuso | Límite por token y por ventana (propuesta: ≤30 mensajes/hora desde el token; ≤60 desde el conductor) — cifra a validar con el PO |

## 4. Salidas (contrato propuesto; no implementado)

### 4.1 Persistencia (migración `expand`, solo tras spec Aceptada)

Tabla nueva, nombre SQL propuesto: `mensajes_seguimiento_publico` (TS: `publicTrackingMessages`).

| Columna (SQL) | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `asignacion_id` | uuid NOT NULL FK → `asignaciones` | restrict on delete |
| `direccion` | enum `direccion_mensaje_seguimiento` ∈ {`conductor_a_destinatario`, `destinatario_a_conductor`} | |
| `texto` | text NOT NULL | v1 solo texto |
| `leido_en` | timestamptz NULL | el otro lado marca lectura |
| `creado_en` | timestamptz NOT NULL default now() | mensajes inmutables |

Índice: `(asignacion_id, creado_en DESC)`. **Sin** FK a `empresas` ni `users` para el lado destinatario. Opcional posterior: `remitente_usuario_id` NULLABLE solo cuando `direccion = conductor_a_destinatario` (auditoría del conductor).

### 4.2 API pública (sin sesión; Zod en boundary)

- `GET  /public/tracking/:token/messages?cursor=&limit=` → lista paginada (más recientes primero)
- `POST /public/tracking/:token/messages` body `{ type: 'texto', text }` → inserta con `direccion = destinatario_a_conductor`
- `PATCH /public/tracking/:token/messages/read` → marca leídos los del conductor

Misma política de cabeceras que el tracking público (`Cache-Control: private, no-store`, `X-Robots-Tag`, `Referrer-Policy`). 404 uniforme si token inválido/expirado (sin filtrar existencia).

### 4.3 API autenticada (conductor)

- Extender o espejar bajo rutas de conductor/asignación (p. ej. `GET|POST|PATCH …/assignments/:id/public-tracking-messages`) con auth Firebase + autorización de conductor de esa asignación.
- `POST` inserta con `direccion = conductor_a_destinatario`.

### 4.4 UI

- Página `/tracking/$token`: panel de chat debajo del estado (mobile-first); sin pedir login.
- App conductor: hilo del destinatario en el detalle de la asignación (separado del chat shipper↔transportista).
- No mostrar nombre real del conductor al destinatario si la minimización vigente lo prohíbe; etiqueta fija «Conductor» (o alias que decida el PO).

### 4.5 Notificaciones (propuesta; detalle en plan posterior)

- Mensaje del destinatario → push/web al conductor (reutilizar infra de push del chat B2B si aplica).
- Mensaje del conductor → opcional WhatsApp/correo al `consignee` si hay contacto; **no** mezclar con el cron de fallback del chat B2B sin diseño explícito.
- Tiempo real (SSE/Pub/Sub) es mejora; v1 puede ser poll en el token + push al conductor.

## 5. Reglas de producto (propuestas; no rigen)

1. **Canal distinto** del chat `mensajes_chat`. Ningún mensaje de este canal aparece en el hilo shipper↔transportista y viceversa.
2. **Auth del destinatario = posesión del token** vigente. Quien tiene el link puede leer y escribir mientras la asignación lo permita.
3. **Escritura** solo con asignación `asignado` \| `recogido` y token no expirado. Tras entrega/cancelación: GET sí, POST → 409 `chat_closed` (o equivalente).
4. **v1 solo texto.** Sin foto, ubicación, voz ni archivos.
5. **Privacidad:** el destinatario no ve precio, patente completa, datos del generador ni del transportista más allá de lo ya permitido en seguimiento-publico-minimizacion. Los mensajes no se indexan ni se cachean en CDN.
6. **Retención / Ley 21.719:** retención y derechos del titular quedan a la revisión legal (misma deuda que el tracking público); la spec de implementación no inventa política nueva sin ese input.
7. **Flags:** este trabajo **no** enciende `RUTAS_API_ACTIVADA` ni pasa matching a `activa`.
8. **Shipper / generador:** en v1 **no** participa de este hilo (solo conductor ↔ destinatario). Si el PO quiere copia o moderación, se decide antes de implementar.

## 6. Criterios de éxito

### 6.1 De este draft (exigibles en el PR de docs)

1. Spec declara explícitamente **DRAFT / no rige / pendiente visto PO**.
2. Entradas, salidas y criterios de éxito están escritos y son verificables.
3. Documenta por qué no se reutiliza `mensajes_chat` (FK notNull) y apunta al legado PR-L5.
4. Sin cambios en `apps/`, `packages/` de runtime, flags, migraciones ni ADRs vigentes.
5. Marca las decisiones del PO (§10) como pendientes.

### 6.2 Tras visto PO + implementación (fuera de este PR; criterio de término del feature)

1. Spec pasa a **Aceptada** (o supersedida con criterios finales del PO).
2. Con token válido y asignación `asignado`/`recogido`, el destinatario envía texto y el conductor lo ve autenticado; el conductor responde y el destinatario lo ve en `/tracking/$token` sin login.
3. Token inválido/expirado → 404 en GET/POST de mensajes; sin fuga de existencia.
4. Tras `entregado`/`cancelado`, POST rechazado; historial legible según retención acordada.
5. Ningún mensaje de este canal en `mensajes_chat`; tests de aislamiento.
6. Coverage ≥80% en código nuevo; TDD en dominio de auth del token y autorización del conductor; `pnpm run ci` verde.
7. Observabilidad: logger con `trace_id`, sin `console.*`; métrica de negocio (p. ej. mensajes públicos enviados) en endpoints nuevos.
8. Sin encender flags de rutas/matching.

## 7. Fuera de alcance

- Código, migraciones, flags, IAM, ADRs nuevos (salvo que el PO pida ADR de privacidad del canal).
- Foto, ubicación, voz, adjuntos.
- Chat grupal generador+conductor+destinatario.
- Sustituir WhatsApp `tracking_link_v1` ni el envío del link.
- Regeneración/rotación del token (sigue `.specs/editar-anular-cargas` §12-P8 / decisión PO).
- Drafts #748, #876, #877; anexo tipos de carga (ADR-092); frentes de fase posterior.

## 8. Riesgos

- **Token = secreto compartido:** cualquiera con el link escribe al conductor. Mitigación: rate limit, expiración ya existente, posible CAPTCHA/turno humano (decisión PO), no filtrar PII extra en el hilo.
- **Confusión de canales** en la UI del conductor (dos chats). Mitigación: etiquetas claras «Generador» vs «Destinatario».
- **Notificar al destinatario** sin WhatsApp/correo poblado: el mensaje solo vive en la página abierta; hay que documentar la expectativa.
- **Moderación / abuso** (spam, acoso): sin tools de bloqueo en v1; el PO debe aceptar el riesgo o pedir kill-switch / mute.
- **Retención legal** aún abierta (Ley 21.719 desde 2026-12-01).

## 9. Dependencias

- Visto del PO sobre §10 (aceptar o corregir este contrato).
- Token público y página de tracking ya en prod (no bloquean el draft).
- Review legal de tracking/consignee (no bloquea el draft; sí condiciona retención y copy en implementación).
- **No** depende de encender `RUTAS_API_ACTIVADA` ni matching `activa`.

## 10. Decisiones del PO (**pendiente visto**)

| # | Pregunta | Estado |
|---|---|---|
| 1 | ¿Aceptar tabla separada `mensajes_seguimiento_publico` (diseño PR-L5) frente a relajar FKs de `mensajes_chat`? | **Pendiente** |
| 2 | ¿v1 solo texto, sin foto/ubicación? | **Pendiente** |
| 3 | ¿El generador ve o modera este hilo en v1, o queda solo conductor↔destinatario? | **Pendiente** |
| 4 | ¿Etiqueta visible al destinatario: «Conductor» anónimo, o nombre/alias? | **Pendiente** |
| 5 | ¿Notificar al destinatario por WhatsApp/correo en cada mensaje del conductor, o solo in-page? | **Pendiente** |
| 6 | ¿Límites de rate / kill-switch / retención alineados a revisión legal? | **Pendiente** |
| 7 | ¿Autorizar implementación (plan + TDD) tras aceptar esta spec, sin tocar flags? | **Pendiente** |

Sin esas respuestas esta spec permanece **Draft** y **no autoriza implementación**.
