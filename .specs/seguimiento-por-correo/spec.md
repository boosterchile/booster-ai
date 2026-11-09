# Spec: seguimiento-por-correo

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Aceptada por el PO (pedido del 2026-11-04, plan por etapas, etapa 1, punto 5; proveedor Resend decidido el 2026-11-09)
- Linked: `.specs/whatsapp-destinatarios-alertas/` (envío del enlace por WhatsApp), `apps/api/src/services/notifications/email-sender.ts`

## 1. Objetivo

El enlace de seguimiento le llega por correo al generador de carga y, si lo consignó, al destinatario. Hoy solo sale por WhatsApp.

## 2. Estado verificado en `main` (2026-11-09)

- **Envío del enlace.** Al aceptar la oferta, `offer-actions.ts` llama a `notifyTrackingLinkAtAssignment` después de la transacción, en modo fire-and-forget.
  - Manda por WhatsApp (template `tracking_link_v1`) al generador (`usuarios.whatsapp_e164` de `viajes.creado_por_id`) y al destinatario (`viajes.destinatario_whatsapp_e164`) si es otro número.
  - Si falta Twilio o el Content SID, no envía nada.
  - La idempotencia está en `asignaciones.tracking_link_enviado_en`.
- **Correo.** `EmailSender` (Resend, `RESEND_API_KEY` + `EMAIL_FROM`) existe, nunca lanza y sin clave registra el intento a nivel `warn`. Hoy solo envía la activación de cuentas.
  - El secreto `resend-api-key` no existe en GCP. Hay que crearlo, y es tarea del PO.
- **Destinatario.** La carga guarda nombre (`destinatario_nombre`) y WhatsApp (`destinatario_whatsapp_e164`), sin correo. El formulario `apps/web/src/routes/cargas.tsx` y `tripRequestCreateInputSchema.consignee` solo tienen nombre y teléfono.
- **URL pública.** `WEB_APP_URL` (default `https://app.boosterchile.com`) + `/tracking/<asignaciones.tracking_token_publico>`.

## 3. Cambios

### BD (migración expand-only, número siguiente libre al abrir el PR)

- `viajes.destinatario_email varchar(254) NULL`.
- `asignaciones.tracking_link_email_enviado_en timestamptz NULL`: idempotencia del correo, independiente de la del WhatsApp. Si Twilio está caído, igual sale el correo, y al revés.
- `asignaciones.tracking_link_enviado_en timestamptz NULL`: la idempotencia del WhatsApp que `notify-tracking-link.ts:19-22` da por hecha, pero que no existe en el schema (verificado el 2026-11-09). Sin ella, un reintento del despacho duplica el WhatsApp. Se toma con el mismo `UPDATE … WHERE … IS NULL RETURNING`.

### Contrato

- `tripRequestCreateInputSchema.consignee.email`: opcional, `z.string().trim().toLowerCase().email().max(254)`.
- El detalle de la carga no cambia en esta spec. Editar el correo del destinatario después de creada la carga es parte de `editar-anular-cargas` (datos libres).

### Servicio `notify-tracking-link-email.ts`

- Se llama desde `offer-actions.ts` justo después del WhatsApp, también fire-and-forget y con su propio `try/catch` que loguea.
- Toma la marca de idempotencia con un `UPDATE … SET tracking_link_email_enviado_en = now() WHERE id = $1 AND tracking_link_email_enviado_en IS NULL RETURNING`. Si no devuelve fila, ya se envió y responde `already_notified`. Así, dos despachos concurrentes no duplican.
- **Destinatarios:**
  - el generador, por `usuarios.email` de `viajes.creado_por_id`;
  - el destinatario, por `viajes.destinatario_email` si es distinto (comparado sin mayúsculas).
- Se descartan los correos sintéticos (dominio `.invalid`, como `drivers+…@boosterchile.invalid`).
- **Contenido:** texto plano y HTML simple, en español.
  - Asunto: «Seguimiento de tu carga {codigo}».
  - Cuerpo: código, ruta por región (`regionLabel`), transportista y patente si están, y el enlace. No lleva precio ni datos del otro destinatario.
- Si `EmailSender` devuelve `enviado: false`, se libera la marca (`SET … = NULL`) para que un reintento pueda enviarlo, y se loguea con el motivo.
- Métrica de negocio y span: `notificaciones.tracking_correo` con `outcome`.

### Web

- En el formulario de nueva carga, junto al nombre y el WhatsApp del destinatario: «Correo del destinatario (opcional)». Se valida el formato antes de enviar.

## 4. Criterios de éxito

- **SC1.** La migración agrega las dos columnas como nulas. El test de integración contra `information_schema` va en rojo antes de la migración.
- **SC2.** Al aceptar una oferta, sale un correo al generador y otro al destinatario si tiene un correo distinto. Un segundo despacho no reenvía.
- **SC3.** Sin `RESEND_API_KEY` no se envía nada, la marca queda libre y el WhatsApp sigue igual. Si Twilio no está configurado, el correo sale igual.
- **SC4.** Un correo `.invalid` o vacío no se usa. Un destinatario con el mismo correo que el generador recibe un solo correo.
- **SC5.** Crear una carga con `consignee.email` lo guarda en minúsculas. Un formato inválido da 400 con el mensaje bajo su campo.
- **SC6.** Tests, lint, typecheck y build en verde, con cobertura de 80% o más en el código nuevo.

## 5. Fuera de alcance

- Crear la cuenta de Resend, verificar el dominio y cargar el secreto `resend-api-key` (tarea del PO). Hasta entonces, el correo queda registrado como intento.
- Mostrar remitente y nombre del conductor en el seguimiento público. Depende de la revisión legal de la Ley 21.719.
- Avisos por correo de otros eventos (entrega, cancelación).
