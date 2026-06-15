# WhatsApp template — `safety_alert_v2`

Template del fan-out de seguridad (P0-G): notifica al transportista ante eventos crash/unplug/jamming. Categoría **UTILITY** (notificación transaccional, no marketing → aprobación más rápida y enviable fuera de la ventana de 24h).

**Forma de submit recomendada**: `scripts/create-safety-alert-template.sh` (crea el content vía Twilio Content API y lo submitea a Meta en un paso, sin hardcodear credenciales). El Content Editor de la consola también sirve, pero el script es reproducible.

---

## Historial de rechazo (por qué v2)

| Template | Content SID | Estado |
|---|---|---|
| `safety_alert_v1` | `HX0d6363fd0162c2d71519ed4e3afe2e3d` | **rejected** por Meta |
| `copy_of_safety_alert_v1` | `HX80819b02ce9a546b855d09ada1aac944` | **rejected** por Meta |

Razón de Meta (`subCode 2388293`):

> *"This template has too many variables for its length. Reduce the number of variables or increase the message length."*

El body de v1 era demasiado corto para 4 variables (ratio variables/texto muy alto). **v2 mantiene las mismas 4 variables** (para no tocar `dispatch-safety-notification.ts`) pero **alarga el texto fijo** que las rodea, lo que resuelve el ratio. Las variables además quedan cada una precedida por una etiqueta estática (nunca adyacentes entre sí ni al inicio/fin del body), otra regla que Meta valida.

> El código referencia el template por **Content SID**, no por nombre — por eso el nombre nuevo (`safety_alert_v2`) no impacta nada. Se usa nombre nuevo porque Meta a veces bloquea reusar un nombre rechazado.

## Metadatos

| Campo | Valor |
|---|---|
| **Template name** | `safety_alert_v2` (Twilio exige snake_case minúscula) |
| **Category** | UTILITY |
| **Language** | Spanish (`es`) |
| **Content type** | `twilio/text` (body-only) — ver abajo variante con botón |

## Body (v2 — el que va a producción)

```
🚨 Alerta de seguridad Booster AI

Detectamos un evento en uno de tus vehículos que requiere tu atención.

🚚 Vehículo (patente): {{1}}
⚠️ Evento detectado: {{2}}
🕐 Hora (Chile): {{3}}
📍 Viaje asociado: {{4}}

Por favor verifica cuanto antes el estado del conductor y de la carga. Si se trata de una emergencia, llama a los servicios de emergencia (131 ambulancia · 133 Carabineros) y luego avísanos por este mismo chat. Si fue una falsa alarma, responde OK para que quede registrado.
```

## Variables — sample values (Meta los exige para aprobar)

| Var | Significado (app) | Origen en código | Sample para el submit |
|---|---|---|---|
| `{{1}}` | Patente del vehículo | `routing.vehicleLabel` (= `vehicle.plate`) | `RJXK-42` |
| `{{2}}` | Tipo de evento (label es) | `safetyEventLabel(eventType)` | `Posible colisión` |
| `{{3}}` | Hora local del evento | `formatHoraLocal(occurredAt)` | `15 jun, 10:00` |
| `{{4}}` | tracking_code del viaje, o fallback | `routing.trackingCode ?? 'Sin viaje activo'` | `BOO-7F3A2C` |

**Labels de `{{2}}` que usa el código** (`apps/api/src/services/safety-event-labels.ts`):
- `crash` → `Posible colisión`
- `unplug` → `Desconexión de energía (manipulación)`
- `jamming` → `Interferencia de señal GPS`

> El orden 1→4 y el mapping están fijados en `apps/api/src/services/dispatch-safety-notification.ts:121-126`. Si se cambia el body, NO reordenar ni agregar variables sin tocar también ese servicio (y sus tests).

## Variante con botón (opcional — no en v2)

Se podría agregar un **botón URL dinámico** (`Ver vehículo` → `https://app.boosterchile.com/app/flota?v={{1}}`), pero agrega una variable extra y alarga la revisión de Meta. El deep-link igual sale por push, así que v2 va **body-only** para maximizar probabilidad de aprobación. El botón se evalúa en una v3 si se decide.

## Después de aprobar

Meta devuelve (vía Twilio) el estado `approved` para el Content SID. Cargarlo en el secret `content-sid-safety-alert` (wiring de infra ya existe desde #476) y redeploy del api:

```bash
echo -n "HX<sid-de-v2>" | gcloud secrets versions add content-sid-safety-alert --data-file=- --project=booster-ai-494222
gcloud run services update booster-ai-api --region=southamerica-west1 \
  --update-secrets=CONTENT_SID_SAFETY_ALERT=content-sid-safety-alert:latest --project=booster-ai-494222
```

Hasta entonces el código skipea WhatsApp y notifica **solo por push** (sin romper nada). Detalle completo en `docs/runbooks/load-content-sids.md`.

## Checklist de submit

- [ ] Correr `scripts/create-safety-alert-template.sh` (o crear a mano en Content Editor con name `safety_alert_v2`, category UTILITY, language `es`, body de arriba, 4 sample values).
- [ ] Anotar el Content SID nuevo (`HX...`).
- [ ] Vigilar aprobación (`ApprovalRequests`, típico 24-48h).
- [ ] Al aprobar: cargar el SID en `content-sid-safety-alert` + redeploy (comandos arriba).
