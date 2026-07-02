# WhatsApp template — `safety_alert` (v2 aprobado + live)

Template del fan-out de seguridad (P0-G): notifica al transportista ante eventos crash/unplug/jamming. Categoría **UTILITY** (notificación transaccional, no marketing → enviable fuera de la ventana de 24h).

## Estado actual (2026-06-22) — ✅ APROBADO Y EN PRODUCCIÓN

`safety_alert_v2` (`HX48d541ad8f2cab4e4f65165cb26489b1`) está **`approved`** por Meta y **cargado** en el secret `content-sid-safety-alert` + montado en el api. El canal WhatsApp de safety está **vivo**: las alertas se entregan al transportista (confirmado en prod, 2026-06-22).

Tardó ~7 días en `pending` (revisión humana de Meta, por el contenido sensible: contactos de emergencia + tono de alarma), bastante por encima del típico 5min–48h — pero **no estaba muerto**, Meta terminó aprobándolo. Verificación del estado en cualquier momento:

```bash
TW_SID="$(gcloud secrets versions access latest --secret=twilio-account-sid --project=booster-ai-494222)"
TW_TOK="$(gcloud secrets versions access latest --secret=twilio-auth-token  --project=booster-ai-494222)"
curl -sS -u "$TW_SID:$TW_TOK" \
  "https://content.twilio.com/v1/Content/HX48d541ad8f2cab4e4f65165cb26489b1/ApprovalRequests" | python3 -m json.tool
# whatsapp.status == "approved"
```

## Historial de aprobación

| Template | Content SID | Estado |
|---|---|---|
| `safety_alert_v1` | `HX0d6363fd0162c2d71519ed4e3afe2e3d` | **rejected** (subCode 2388293: "too many variables for its length") |
| `copy_of_safety_alert_v1` | `HX80819b02ce9a546b855d09ada1aac944` | **rejected** (mismo subCode) |
| `safety_alert_v2` | `HX48d541ad8f2cab4e4f65165cb26489b1` | **approved + live** ✅ (submiteado 2026-06-15, aprobado tras ~7d de revisión humana) |
| `safety_alert_v3` | _(no creado)_ | **fallback de-riesgado** (no submitear salvo que v2 se pause/disable — ver abajo) |

## Body (v2 — el que está en producción)

```
🚨 Alerta de seguridad Booster AI

Detectamos un evento en uno de tus vehículos que requiere tu atención.

🚚 Vehículo (patente): {{1}}
⚠️ Evento detectado: {{2}}
🕐 Hora (Chile): {{3}}
📍 Viaje asociado: {{4}}

Por favor verifica cuanto antes el estado del conductor y de la carga. Si se trata de una emergencia, llama a los servicios de emergencia (131 ambulancia · 133 Carabineros) y luego avísanos por este mismo chat. Si fue una falsa alarma, responde OK para que quede registrado.
```

## Variables — sample values

Las 4 variables son **idénticas** entre v2 y el fallback v3 (mismo orden), por eso `dispatch-safety-notification.ts` no cambia si algún día se rota el template.

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

> El orden 1→4 y el mapping están fijados en `apps/api/src/services/dispatch-safety-notification.ts:121-126`. Si se rota el template, NO reordenar ni agregar variables sin tocar también ese servicio (y sus tests). El código referencia por **Content SID**, no por nombre.

## Fallback de-riesgado (`safety_alert_v3`) — solo si Meta pausa/disable v2

Meta puede **pausar** o **deshabilitar** un template aprobado si acumula feedback negativo (bloqueos/spam reports). Si eso pasa con v2, hay un reemplazo **pre-de-riesgado** listo en `scripts/create-safety-alert-template.sh` (apunta a `safety_alert_v3`): mismo set de 4 variables, pero sin la instrucción de servicios de emergencia (van por app/push), sin líneas en blanco (`\n\n`→`\n`) y con tono transaccional sin emojis de alarma — para maximizar la probabilidad de auto-aprobación rápida.

```
Hola, te escribe el sistema de Booster AI. Detectamos un evento en uno de tus vehículos que necesita tu atención.
Vehículo (patente): {{1}}
Evento detectado: {{2}}
Hora (Chile): {{3}}
Viaje asociado: {{4}}
Revisa cuanto antes el estado del vehículo y de la carga, y respóndenos por este chat para confirmar que recibiste este aviso. Encontrarás el detalle y los contactos de ayuda en la app de Booster AI.
```

Flujo de rotación (solo si hace falta): correr el script → anota el SID de v3 → al aprobar Meta, `gcloud secrets versions add content-sid-safety-alert` (nueva versión) + redeploy del api. El env var ya está montado (mount A7 de #526), así que no toca Terraform.

## Checklist

- [x] Crear `safety_alert_v2`, submitear a Meta (UTILITY, es, 4 sample values). — 2026-06-15.
- [x] Aprobación de Meta. — **approved** (tras ~7d de revisión humana).
- [x] Cargar el SID en `content-sid-safety-alert` + montar en el api. — live en prod.
- [x] Confirmar entrega real de WhatsApp al transportista. — confirmado 2026-06-22.
- [ ] _(solo si Meta pausa/disable v2)_ rotar al fallback v3 vía el script.
