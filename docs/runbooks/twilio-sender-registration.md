# Runbook: Registrar +1 938-336-5293 como Twilio WhatsApp Sender

**Fecha:** 2026-04-29
**Estado:** Pendiente. Sandbox funcionando como workaround temporal.
**Owner:** dev@boosterchile.com

## Contexto

El número `+1 938-336-5293` está provisionado en Twilio (no como WhatsApp
Sender, sólo como número de voz/SMS). Para que el bot pueda usarlo en
producción y que cualquier shipper de Chile pueda mandarle un WhatsApp,
hay que registrarlo via la consola de Twilio.

Mientras tanto el bot opera en el **sandbox de Twilio** (`+14155238886`).
Limitaciones del sandbox:

- Cada usuario debe enviar `join familiar-action` antes de poder mensajear.
- Sandbox compartido entre todas las cuentas Twilio que estén en developer
  mode → no apto para producción.
- No se puede personalizar display name.

## Pre-requisitos

1. Cuenta Twilio con billing activo (no trial).
2. Cuenta Meta Business activa con verificación de negocio en proceso o
   completada (Twilio actúa como BSP/ISV en el flow de aprobación).
3. Display name aprobado por Meta (puede tomar 24-48h).
4. SIM/voz del +1 938-336-5293 disponible para recibir SMS de verificación
   (si Twilio lo pide).

## Pasos

### 1. Iniciar registro en Twilio

1. Login en <https://console.twilio.com> con la cuenta dueña del número.
2. Sidebar → **Messaging → Senders → WhatsApp senders**.
3. Click **"Create new sender"** (top right).

### 2. Wizard de Twilio

Twilio te va a llevar a través de 4-5 pantallas:

#### a) Selección de número

- Elegir **"Use existing Twilio phone number"**.
- Seleccionar `+1 938-336-5293` del dropdown.
- Si el número no aparece, volver a Phone Numbers → Active numbers y
  asegurarse de que esté activo y compatible con messaging.

#### b) Display name + categoría

- **Display name:** "Booster AI" (debe coincidir con la marca registrada
  o aprobada por Meta. Si todavía no se hizo el trámite con Meta, hacerlo
  primero en Meta Business Manager → WhatsApp Manager → Create profile).
- **Categoría:** Logística / Transporte / Servicios profesionales.
- **Descripción corta:** "Marketplace B2B de transporte de carga en Chile.
  Conectamos shippers con carriers verificados."

#### c) Profile info (visible en WhatsApp Business)

- **Email:** dev@boosterchile.com
- **Website:** https://boosterchile.com
- **Address:** dirección comercial registrada en Chile (Booster TVO SpA o
  el RUT correspondiente).
- **About:** "Solicita tu transporte por WhatsApp. Booster AI te conecta
  con el carrier más adecuado en minutos."

#### d) Webhook URL (para inbound)

- **Inbound URL:**
  `https://booster-ai-whatsapp-bot-469283083998.southamerica-west1.run.app/webhooks/whatsapp`
  (o `https://api.boosterchile.com/webhooks/whatsapp` cuando DNS migre).
- **Method:** POST
- **Status callback URL:**
  `https://booster-ai-whatsapp-bot-469283083998.southamerica-west1.run.app/webhooks/twilio-status`

#### e) Submit a Meta para review

- Click **"Submit"**.
- Meta puede tomar entre **2 y 7 días hábiles** en aprobar.
- Estados intermedios: `pending` → `under_review` → `approved` (o
  `rejected` con feedback).

### 3. Mientras espera aprobación

- En Twilio el sender está en estado **"Pending"**, no podés mandar
  templates aún a cualquier número.
- Para preparar templates a usar post-approval, ir a **Messaging →
  Content Template Builder** y crear los templates necesarios:
  - `welcome_message` — saludo inicial fuera de ventana 24h
  - `cargo_match_proposal` — propuesta de carrier
  - `cargo_status_update` — actualizaciones de estado del trip
- Cada template requiere review propio (~1-2 días).

### 4. Una vez aprobado

1. Actualizar Terraform: `infrastructure/variables.tf` → cambiar
   `twilio_from_number` default de `"+14155238886"` a `"+19383365293"`.
2. `terraform plan` → verificar que solo cambia el env var del bot.
3. `terraform apply tfplan`.
4. (Cloud Run crea nueva revisión del bot que monta el FROM nuevo).
5. Test desde un WhatsApp NO suscrito al sandbox: mandar "hola" a
   +1 938-336-5293 directamente.
6. Verificar logs: debe haber webhook entrante normal sin necesidad de opt-in.

### 5. Configurar Twilio webhook URL final

Mientras estamos en sandbox, la webhook URL la configuramos en **Sandbox
settings**. Una vez aprobado el sender real, hay que configurarla en el
sender mismo:

1. Twilio Console → Messaging → Senders → WhatsApp senders → click el
   sender aprobado.
2. **"Inbound Settings"** → confirmar/setear:
   - When a message comes in:
     `https://booster-ai-whatsapp-bot-469283083998.southamerica-west1.run.app/webhooks/whatsapp`
   - Method: POST
3. **"Status callback URL"** → setear:
   `https://booster-ai-whatsapp-bot-469283083998.southamerica-west1.run.app/webhooks/twilio-status`

### 6. Notificar a stakeholders

- Email a dev@boosterchile.com confirmando go-live.
- Update del README con el número público.
- Slack/canal interno con la URL pública del bot para QA / pruebas.

## Rollback

Si después de aprobado descubrimos un problema bloqueante:

1. Revertir `twilio_from_number` a `+14155238886` en variables.tf.
2. `terraform apply`.
3. (Bot vuelve a usar sandbox; usuarios que tenían 24h-window pierden ventana).

## Costos

- **Sandbox:** gratis para desarrollo.
- **Sender registrado:** Twilio cobra por número (~$1.15/mes) + por
  conversación según tier Meta (`utility`, `marketing`, `service`,
  `authentication`). Ver pricing actual en
  <https://www.twilio.com/whatsapp/pricing>.
- **Templates:** sin costo de creación; cada envío fuera de ventana 24h
  genera una "marketing/utility conversation" con costo Meta.

## Referencias

- Docs Twilio: <https://www.twilio.com/docs/whatsapp/self-sign-up>
- Meta Business verification: <https://business.facebook.com/business/help/2058515294227817>
- Twilio status webhook docs: <https://www.twilio.com/docs/usage/webhooks/messaging-webhooks>
