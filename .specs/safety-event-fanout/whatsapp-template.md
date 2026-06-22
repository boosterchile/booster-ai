# WhatsApp template — `safety_alert` (v3)

Template del fan-out de seguridad (P0-G): notifica al transportista ante eventos crash/unplug/jamming. Categoría **UTILITY** (notificación transaccional, no marketing → aprobación más rápida y enviable fuera de la ventana de 24h).

**Forma de submit recomendada**: `scripts/create-safety-alert-template.sh` (crea el content vía Twilio Content API y lo submitea a Meta en un paso, sin hardcodear credenciales). El Content Editor de la consola también sirve, pero el script es reproducible.

---

## Estado actual (2026-06-22) — v2 atascado en Meta

`safety_alert_v2` (`HX48d541ad8f2cab4e4f65165cb26489b1`) lleva **>7 días en `pending`**, muy por encima del típico (5 min–48 h). Clave: v2 **pasó los auto-checks** de Meta (no quedó `rejected` como v1) — está atascado en **revisión humana**, casi seguro por su contenido sensible (contactos de emergencia 131/133, tono alarmista) que no se puede auto-triagear.

Hay **dos caminos** para resolverlo (no son excluyentes; el segundo es el recomendado):

| Camino | Acción | Quién | Trade-off |
|---|---|---|---|
| **A — destrabar v2** | Abrir un **Twilio support ticket** con el nombre `safety_alert_v2` + SID `HX48d541…`. Es la acción que Meta documenta para `pending >48h`. | Owner (consola Twilio) | Conserva el contenido exacto de v2 (con números de emergencia), pero depende de la cola de soporte. |
| **B — reemplazar por v3** ✅ | Correr `scripts/create-safety-alert-template.sh` (ya apunta a `safety_alert_v3`, body de-riesgado). | Owner (corre el script; lee creds de Secret Manager) | Path auto-aprobable (sin el contenido que dispara revisión humana). El detalle de emergencia se mueve a la app/push, no al texto WhatsApp. |

> Referencia de la regla de Meta: *"If a template remains in the Pending state for more than 48 hours, open a Twilio support ticket and include the template name."* (twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses).

## Historial de aprobación

| Template | Content SID | Estado |
|---|---|---|
| `safety_alert_v1` | `HX0d6363fd0162c2d71519ed4e3afe2e3d` | **rejected** (subCode 2388293: "too many variables for its length") |
| `copy_of_safety_alert_v1` | `HX80819b02ce9a546b855d09ada1aac944` | **rejected** (mismo subCode) |
| `safety_alert_v2` | `HX48d541ad8f2cab4e4f65165cb26489b1` | **pending >7d** (submiteado 2026-06-15T23:01Z) → atascado en revisión humana |
| `safety_alert_v3` | _(lo asigna el script al crearlo)_ | **por submitear** (camino B) |

**Por qué v3 cambia respecto de v2** (sin tocar el código — mismas 4 variables, mismo orden):

1. **Sin la instrucción de servicios de emergencia** (131/133). Pedirle al usuario que llame a emergencias es contenido sensible que Meta rutea a revisión humana. Esos contactos viven en la app / el push, no en el texto del template.
2. **Sin líneas en blanco** (`\n\n` → `\n`). Meta lista "newlines, tabs, or more than four consecutive spaces" como motivo de fricción/rechazo; v3 usa solo saltos simples.
3. **Tono claramente transaccional, sin emojis de alarma** (🚨⚠️ fuera). Un aviso sobre el propio vehículo del usuario es UTILITY legítimo; el tono neutro ayuda al auto-triage.

> El código referencia el template por **Content SID**, no por nombre — el nombre nuevo (`safety_alert_v3`) no impacta nada. Se usa nombre nuevo porque Meta bloquea reusar el nombre de un template existente/rechazado por 30 días.

## Metadatos

| Campo | Valor |
|---|---|
| **Template name** | `safety_alert_v3` (Twilio exige snake_case minúscula) |
| **Category** | UTILITY |
| **Language** | Spanish (`es`) |
| **Content type** | `twilio/text` (body-only) — ver abajo variante con botón |

## Body (v3 — el que va a producción)

```
Hola, te escribe el sistema de Booster AI. Detectamos un evento en uno de tus vehículos que necesita tu atención.
Vehículo (patente): {{1}}
Evento detectado: {{2}}
Hora (Chile): {{3}}
Viaje asociado: {{4}}
Revisa cuanto antes el estado del vehículo y de la carga, y respóndenos por este chat para confirmar que recibiste este aviso. Encontrarás el detalle y los contactos de ayuda en la app de Booster AI.
```

<details>
<summary>Body de v2 (atascado — solo referencia)</summary>

```
🚨 Alerta de seguridad Booster AI

Detectamos un evento en uno de tus vehículos que requiere tu atención.

🚚 Vehículo (patente): {{1}}
⚠️ Evento detectado: {{2}}
🕐 Hora (Chile): {{3}}
📍 Viaje asociado: {{4}}

Por favor verifica cuanto antes el estado del conductor y de la carga. Si se trata de una emergencia, llama a los servicios de emergencia (131 ambulancia · 133 Carabineros) y luego avísanos por este mismo chat. Si fue una falsa alarma, responde OK para que quede registrado.
```
</details>

## Variables — sample values (Meta los exige para aprobar)

Las 4 variables son **idénticas** entre v2 y v3 (mismo orden), por eso `dispatch-safety-notification.ts` no cambia.

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

## Variante con botón (opcional — no en v3)

Se podría agregar un **botón URL dinámico** (`Ver vehículo` → `https://app.boosterchile.com/app/flota?v={{1}}`), pero agrega una variable extra y alarga la revisión de Meta. El deep-link igual sale por push, así que v3 va **body-only** para maximizar probabilidad de aprobación. El botón se evalúa en una v4 si se decide.

## Después de aprobar

Meta devuelve (vía Twilio) el estado `approved` para el Content SID. El env var `CONTENT_SID_SAFETY_ALERT` **ya está montado** en el api en prod (wiring de #476 + mount condicional A7 de #526), así que basta cargar el SID aprobado como nueva versión del secret + redeploy para tomar `:latest`:

```bash
# Reemplazá HX… por el Content SID que devolvió el script (v3) o el de v2 si se aprueba por el camino A.
echo -n "HX…" | gcloud secrets versions add content-sid-safety-alert --data-file=- --project=booster-ai-494222
gcloud run services update booster-ai-api --region=southamerica-west1 \
  --update-secrets=CONTENT_SID_SAFETY_ALERT=content-sid-safety-alert:latest --project=booster-ai-494222
```

> El secret ya tiene una versión cargada en prod (el SID de v2, post-recovery INC-2026-06-19), por eso el api bootea sano hoy aunque el template esté pending. El canal WhatsApp solo queda **funcional** cuando el SID cargado corresponde a un template **approved**; hasta entonces el código degrada a **solo push** (sin romper nada). Detalle completo en `docs/runbooks/load-content-sids.md`.

## Checklist

**Camino B (v3 — recomendado):**
- [ ] Correr `scripts/create-safety-alert-template.sh` (crea `safety_alert_v3` con el body de-riesgado y lo submitea, category UTILITY, language `es`).
- [ ] Anotar el Content SID nuevo que imprime el script y registrarlo en la tabla de arriba.
- [ ] Vigilar aprobación (`ApprovalRequests`; con v3 debería auto-aprobarse en minutos–horas, no días).
- [ ] Al aprobar: cargar el SID en `content-sid-safety-alert` + redeploy (comandos arriba).
- [ ] Smoke: disparar un evento de safety de prueba → confirmar que llega el WhatsApp.

**Camino A (destrabar v2 — alternativa):**
- [ ] Abrir Twilio support ticket: template `safety_alert_v2`, SID `HX48d541ad8f2cab4e4f65165cb26489b1`, "pending >7d, request manual review".
- [ ] Si Meta lo aprueba: cargar `HX48d541…` en el secret + redeploy.
- [ ] Si Meta lo rechaza: descartar y seguir el camino B.
