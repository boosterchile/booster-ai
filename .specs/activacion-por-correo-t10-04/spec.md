# Spec: activacion-por-correo-t10-04 — el código de activación le llega solo a la persona

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase A, criterio T10-04 (`.specs/trl10/spec.md`, ADR-082)
- Antecedentes: `conductor-activacion-correo` (correo del conductor), `alta-desde-panel-admin` (alta del dueño), INC-2026-06-19 (montaje gateado de secretos)

## 1. Problema

T10-04 exige que la activación del conductor y del dueño salga sola por WhatsApp o correo en prod. Hoy, en el código, en Terraform y en el canal:

- **Conductor:** el alta envía un WhatsApp (`activacion_conductor_v2`) y un correo con el PIN. El WhatsApp **no lleva el PIN**: Meta rechazó la v1 por llevar un código fuera de la categoría *Authentication* (decisión A del PO, 2026-08-03). El PIN solo viaja por correo, y el correo no sale: `RESEND_API_KEY` no existe en prod y `crearEmailSender` cae al `LoggingEmailSender`.
- **Dueño (alta desde el panel):** `POST /admin/empresas/:id/miembros` y `POST /admin/empresas/:id/miembros/:membershipId/codigo` devuelven el código **solo al admin**, que tiene que dictárselo a la persona. No sale nada por ningún canal.
- **Terraform** no declara el secreto `resend-api-key` ni monta `RESEND_API_KEY` en el api.

## 2. Entradas

- `EmailSender` existente (`services/notifications/email-sender.ts`) con `ResendEmailSender` y `LoggingEmailSender`.
- Las dos rutas del alta del dueño en `routes/admin-empresa-miembros.ts`.

## 3. Salidas

1. **Correo de activación de cuenta** (`services/notifications/cuenta-activacion-email.ts`).
   - Contenido: nombre, empresa, rol, RUT, código de 6 dígitos y enlace a `<WEB_APP_URL>/activar`.
   - Nunca lanza y nunca escribe el código en un log.
   - Escapa el HTML de los campos variables.
2. **El alta del dueño envía el correo.**
   - `POST /admin/empresas/:id/miembros` lo envía cada vez que emite un código: persona nueva, o provisoria sin código.
   - `POST …/codigo` lo envía con el código nuevo.
   - Destinatario: el correo registrado de la persona.
   - La respuesta HTTP no cambia: el admin sigue viendo el código, como respaldo.
3. **El correo del conductor escapa el HTML** de nombre y empresa, que hoy van crudos.
4. **Terraform:**
   - secreto `resend-api-key` en el mapa `secrets` de `security.tf`, con versión placeholder;
   - `RESEND_API_KEY` montado en el api solo cuando `var.resend_api_key_ready = true`, mismo patrón que `content_sid_ready`. Un placeholder montado haría que `ResendEmailSender` intente enviar con una key inválida.

## 4. Criterios de éxito

1. Rojo exhibido antes de la implementación:
   - los tests del correo nuevo fallan porque el módulo no existe;
   - los tests de las dos rutas fallan porque no se llama a `sender.send`.
2. Después: los tests pasan, `tsc` limpio, coverage del API ≥ 80 % y `terraform fmt` limpio.
3. El código no aparece en ningún log en los tests (`info`, `warn` y `error`).
4. Con una cuenta ya activa (`vinculo = cuenta_activa`) no se envía correo: no hay código.

## 5. Fuera de alcance

- Invitaciones de miembros que hace la propia empresa (`me-empresa-miembros`) y de organizaciones stakeholder: mismo patrón, frente aparte.
- WhatsApp con el PIN: exige una plantilla de categoría *Authentication* aprobada por Meta, de formato fijo. Va como frente aparte si el PO la quiere.
- Que `/activar` precargue el RUT desde la URL (cambio de UI).

## 6. Acciones del PO para cerrar T10-04 en prod

1. Crear la cuenta de Resend y verificar el dominio `boosterchile.com`. Resend entrega registros DNS (SPF/DKIM); se agregan a Cloud DNS por Terraform en un PR aparte, o por consola.
2. Cargar la API key: `gcloud secrets versions add resend-api-key`.
3. `resend_api_key_ready = true` en el tfvars, más `terraform apply` con plan registrado.
4. Verificarlo con un alta real: un conductor o un dueño nuevo activa su cuenta sin que nadie le dicte el código. Esa es la evidencia de T10-04.
