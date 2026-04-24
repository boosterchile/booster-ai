# ADR-006 — WhatsApp Business como canal primario (no secundario)

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md)

---

## Contexto

El mercado objetivo de Booster AI es el **transporte micro, pequeño y mediano en Chile**. La cultura operativa del sector tiene tres características relevantes:

1. **WhatsApp es la herramienta principal** de coordinación. Shippers y carriers intercambian mensajes, fotos, audios y PDFs por WhatsApp para solicitar y aceptar fletes.
2. **Baja disciplina digital**: muchos carriers no usan software ERP, no tienen email corporativo activo, y rechazan instalar apps desconocidas.
3. **Transaccionalidad informal**: una orden de transporte se genera con un mensaje ("¿Puedes llevar 5 tons de fierro de Santiago a Rancagua mañana?") y se acepta con otro ("Sí, te lo llevo en 4 millones").

Si Booster AI obliga al shipper/carrier a ingresar al portal web para cada interacción, **pierde al segmento mayoritario del mercado**. WhatsApp no puede ser un canal secundario o "nice-to-have" — debe ser **ciudadano de primera clase** en el modelo de datos y los flujos.

## Decisión

Integrar **Meta WhatsApp Business Cloud API** directamente (sin intermediarios como Twilio/WATI) como canal primario de creación y gestión de órdenes. El canal debe cubrir:

- **Inbound**: shipper escribe a Booster por WhatsApp y el bot crea una orden pendiente.
- **Outbound**: Booster envía ofertas de carga, notificaciones de asignación, updates de trip, confirmaciones, recordatorios.
- **Rich content**: botones interactivos, listas, imágenes, ubicación, documentos (PDF, JPG).
- **Handoff a humano**: escalado automático a agente humano admin cuando el bot no puede resolver.

### Por qué Meta Cloud API directo, no Twilio/WATI/360dialog

| Criterio | Meta Cloud API (elegido) | Twilio | 360dialog/WATI |
|----------|--------------------------|--------|----------------|
| Costo por conversación | Tarifa oficial Meta | +margen Twilio | +margen provider |
| Latencia | Directa Meta | +hop Twilio | +hop provider |
| Control | Total | Mediado | Mediado |
| Features bleeding-edge | Primero en Meta | Catch-up | Catch-up |
| Auditabilidad TRL 10 | Webhooks directos de Meta, audit logs GCP | Depende de Twilio exports | Depende de provider |
| Dependencia de terceros | Solo Meta (que ya se usa) | Meta + Twilio | Meta + Provider |
| Setup | Complejo (Meta Business Manager + verificación) | Simple | Simple |
| Migration cost | N/A (es la raíz) | Futuro migrar a Meta para ahorrar | Futuro migrar a Meta para ahorrar |

Elegimos Meta Cloud API **a pesar del setup complejo** porque:
- Minimiza dependencias (principio CLAUDE.md)
- Menor costo a escala (cada Billing Account maneja su propio WhatsApp Business Account)
- Mejor auditabilidad (menos hops intermediarios)
- Evita migración futura forzada

### Arquitectura del canal

```
┌───────────────────────────────────────────────────┐
│ INBOUND                                            │
│                                                    │
│  Usuario ──mensaje─► WhatsApp Meta                │
│                        │                           │
│                        ▼ webhook                   │
│  apps/whatsapp-bot (Cloud Run)                    │
│    - Verificación de signature (HMAC)             │
│    - Dedup de message_id                          │
│    - Publica a Pub/Sub: whatsapp-inbound-events   │
└──────────────────────────┬────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────┐
│ NLU + INTENT DETECTION                           │
│                                                   │
│ Consumer Cloud Run del topic:                    │
│   - Gemini 2.5 Flash con prompt estructurado     │
│   - Intents: create_order, query_status,         │
│              cancel_order, ask_info, chitchat,   │
│              human_handoff                        │
│   - Extracción de entidades: origen, destino,    │
│     carga, peso, vehículo, deadline              │
│   - Si incompleto → bot pregunta siguiente dato  │
│   - Si completo → crea CargoRequest borrador     │
│   - Confirma con el usuario antes de publicar    │
└──────────────────────────┬────────────────────────┘
                           ▼
                    API principal (trip service)
                           │
                           ▼
                  Base de datos + matching engine

┌──────────────────────────────────────────────────┐
│ OUTBOUND                                          │
│                                                   │
│  notification-service consume notification-events│
│    - Si canal=whatsapp                           │
│    - Usa template aprobado por Meta              │
│    - POST a Meta Cloud API                       │
│    - Registra delivery status en BD              │
└───────────────────────────────────────────────────┘
```

### Templates Meta (requisito operacional)

Meta exige que mensajes **outbound fuera de la ventana de 24h** (conversación activa) usen **templates pre-aprobados**. Cada template requiere:

- Aprobación por Meta (1-3 días hábiles)
- Categoría: Utility, Marketing, o Authentication
- Parámetros posicionales (placeholders numerados)

Templates iniciales necesarios (deben crearse antes de go-live):

| Nombre | Categoría | Uso |
|--------|-----------|-----|
| `order_matched_carrier_v1` | Utility | "Tienes una oferta de carga nueva: {{1}} → {{2}}, {{3}} kg" |
| `order_assigned_driver_v1` | Utility | "Te asignaron una carga: {{1}} → {{2}}. Retira en {{3}}" |
| `trip_started_shipper_v1` | Utility | "Tu carga salió. Sigue en vivo: {{1}}" |
| `trip_delivered_shipper_v1` | Utility | "Carga entregada. Confirma en {{1}}" |
| `payment_processed_carrier_v1` | Utility | "Pago procesado: {{1}} por trip {{2}}" |
| `incident_reported_admin_v1` | Utility | "Incidente reportado en trip {{1}}: {{2}}" |
| `order_draft_confirmation_v1` | Utility | "Confirma tu orden: {{1}} → {{2}}. Responde SI o NO" |
| `verification_code_v1` | Authentication | Código de verificación OTP para onboarding |

Los templates se versionan con sufijo `_v1`, `_v2`. Un cambio al texto genera un nuevo template (requiere nueva aprobación); nunca editar in-place.

### Mapeo conversación ↔ dominio

Un mensaje de WhatsApp se mapea a entidades del dominio:

- **Conversation**: por `phone_number` del usuario. Una conversación puede generar múltiples CargoRequests a lo largo del tiempo.
- **User**: si el número coincide con un `User` con `phone` registrado, se asocia. Si no, se crea usuario "lead" pendiente de confirmar email.
- **CargoRequest**: salida del NLU cuando intent=create_order + datos completos + confirmación.
- **Incident**: intent=report_incident abre ticket.

### Handoff a humano

Reglas de escalamiento:

- Intent = `human_handoff` (usuario pide explícitamente "hablar con una persona")
- Gemini confidence < threshold (ej. < 0.6)
- Usuario repite 3 veces sin avance
- Usuario marca respuesta como "no ayudó"

Al escalarse:
- Se asigna a un admin en Booster (via `apps/web` rol admin)
- El admin ve toda la conversación previa
- Responde desde la UI, los mensajes salen por el mismo canal WhatsApp
- Cuando cierra, el bot reanuda

### NLU con Gemini (detalles)

Prompt estructurado (`packages/whatsapp-client/prompts/intent-classifier.ts`):

```
Eres el bot de Booster AI, plataforma chilena de transporte de carga.
Tu tarea es identificar la intención del usuario y extraer entidades.

Intents disponibles:
- create_order: usuario quiere solicitar un transporte
- query_status: preguntar por una orden existente
- cancel_order: cancelar una orden
- report_incident: reportar problema
- ask_info: pregunta general sobre cómo funciona Booster
- human_handoff: quiere hablar con persona
- chitchat: saludo, gracias, no-op

Entidades a extraer (solo para create_order):
- origin: ciudad o dirección de origen
- destination: ciudad o dirección de destino
- cargo_type: tipo de carga (fierro, madera, frutas, etc.)
- weight_kg: peso en kilos
- volume_m3: volumen en m³ (opcional)
- vehicle_type_required: camión 1/4, 3/4, camión completo, semi, etc.
- pickup_date: fecha deseada
- budget_clp: presupuesto declarado por el shipper

Responde SIEMPRE en JSON válido:
{
  "intent": "...",
  "confidence": 0.0-1.0,
  "entities": {...},
  "missing_required_fields": ["..."],
  "suggested_next_question": "..."
}
```

La llamada a Gemini es `packages/ai-provider`, con fallback a Claude si falla.

### Verificación de phone ownership

Cuando alguien escribe por primera vez:
- Bot solicita verificación: "Hola. ¿Tienes cuenta en Booster AI? Responde tu email o 'NO'"
- Si responde email que coincide con User existente → envía OTP por WhatsApp (template `verification_code_v1`)
- Si confirma OTP → vincula `phone` al `User`
- Si responde "NO" → bot inicia flujo de onboarding guiado

### Seguridad y compliance

- **Webhook signature verification**: HMAC SHA-256 con `WHATSAPP_APP_SECRET` (Secret Manager)
- **Rate limiting**: max 5 mensajes/segundo por phone number (prevenir ataques)
- **PII en logs**: los mensajes se loguean pero números de teléfono se enmascaran (`+569XXXX1234`)
- **Retención**: mensajes en BD encriptados (Cloud SQL encryption at rest + Customer-Managed Encryption Key para el campo `content`). Retención 2 años default, configurable por requerimiento legal.
- **Opt-out**: comando "STOP" desactiva outbound (requerimiento Meta). Se registra en `User.whatsapp_opted_out=true`.

## Consecuencias

### Positivas

- **Accede al 80%+ del mercado** que no usaría portal web como primer touchpoint.
- **Reduce fricción** de onboarding: el shipper no necesita crear cuenta para hacer su primera orden (se crea implícitamente).
- **Compatible con cultura operativa**: los usuarios siguen trabajando en su herramienta preferida.
- **Auditabilidad**: cada mensaje queda en BD + BigQuery para auditoría; los contratos se forman via WhatsApp con trazabilidad.
- **Diferenciador competitivo**: competidores que solo ofrecen portal web quedan excluidos de este segmento.

### Negativas

- **Dependencia crítica de Meta**: caída de WhatsApp (sucede, ej. Oct 2021) suspende operaciones. Mitigación: canal web como fallback siempre activo.
- **Costos de templates a escala**: Meta cobra por conversación iniciada fuera de ventana 24h. Para 10K órdenes/mes → ~$500-1000 USD/mes. Justificable por revenue del canal.
- **NLU no es infalible**: Gemini puede malinterpretar intents. Mitigación: siempre pedir confirmación explícita antes de crear orden.
- **Setup operativo complejo**: Meta Business Manager + phone number verification + templates aprobación toma 1-2 semanas la primera vez. Plan: iniciar setup en paralelo al desarrollo para no bloquear go-live.
- **Legal Chile**: retención de mensajes puede considerarse "comunicación comercial" bajo Ley 19.628. Requisito: política de privacidad explícita + opt-out funcional. Cubierto.

## Implementación inicial

### Apps

- `apps/whatsapp-bot` — webhook receiver (Cloud Run). Verifica signature, dedup, publica a Pub/Sub.
- NLU + orchestration integrado en `apps/api` como bounded context.

### Packages

- `packages/whatsapp-client` — tipado fuerte de Meta Cloud API, templates typed, helpers para mensajes interactivos, prompts de NLU.

### Infra (Terraform)

- Secret Manager: `whatsapp-app-secret`, `whatsapp-access-token`, `whatsapp-phone-number-id`, `whatsapp-business-account-id`
- Pub/Sub topic: `whatsapp-inbound-events`
- Cloud Run service `whatsapp-bot` con public endpoint (Meta webhook)
- Cloud Armor regla limitante de rate + geo (solo IPs de Meta)
- Cloud Scheduler: job diario para rotar `whatsapp-access-token` si se usa token de larga duración

### Operativo

- Crear Meta Business Account (manual, humano)
- Verificar phone number de Booster
- Crear y someter los 8 templates iniciales
- Configurar webhook URL
- Runbook `onboarding-whatsapp-business` con todos los pasos

## Validación

- [ ] Un mensaje a Booster WhatsApp dispara webhook y llega a Pub/Sub
- [ ] Bot responde en español correctamente a saludos y preguntas básicas
- [ ] Crea CargoRequest válido desde conversación de 4-6 turnos
- [ ] Confirmación explícita antes de persistir orden
- [ ] OTP de verificación funciona
- [ ] Outbound con template `order_matched_carrier_v1` llega al carrier
- [ ] Comando "STOP" marca `whatsapp_opted_out=true` y cesa outbound
- [ ] Handoff a admin humano funciona end-to-end
- [ ] Audit log muestra todas las interacciones

## Referencias

- Meta WhatsApp Business Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Meta Pricing: https://developers.facebook.com/docs/whatsapp/pricing
- Templates guidelines: https://developers.facebook.com/docs/whatsapp/message-templates
- [ADR-004 — Modelo Uber-like](./004-uber-like-model-and-roles.md)
- [ADR-001 — Stack](./001-stack-selection.md)
