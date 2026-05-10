# Runbook — Cargar Content SIDs de Twilio en Secret Manager

Procedimiento para cargar (o rotar) los Content SIDs de templates
WhatsApp aprobados por Meta. Los secrets viven en Secret Manager:

| Secret | Uso | Friendly name Twilio |
|---|---|---|
| `content-sid-offer-new` | Notificar carrier de nueva oferta (B.8) | `offer_new_v1` |
| `content-sid-chat-unread` | Fallback WhatsApp para chat no leído (P3.d) | `chat_unread_v1` |
| `content-sid-coaching` | Coaching IA post-entrega al transportista (Phase 3 PR-J3) | `coaching_post_entrega_v1` |

### Body recomendado del template `coaching_post_entrega_v1`

Crear en Twilio Content Editor con este body (4 variables 1-indexed) — la
copia pasa los criterios de Meta para Utility templates (informa sobre
viaje recién finalizado, no es marketing):

```
🚛 Booster AI — Tu viaje terminó

📦 Viaje {{1}}
⭐ Score de conducción: {{2}}

💡 {{3}}

Ver detalles: {{4}}
```

Variable map:

| Var | Significado | Ejemplo |
|---|---|---|
| {{1}} | tracking_code del viaje | `BOO-K7M2X9` |
| {{2}} | score + nivel | `85/100 · Bueno` |
| {{3}} | mensaje de coaching IA (≤280 chars) | `Buen viaje. Anticipa frenadas y mantén distancia para bajar 5-10% el consumo.` |
| {{4}} | deep-link al detalle del trip | `https://app.boosterchile.com/app/viajes/{tripId}` |

Categoría Meta: **Utility** (no Marketing — el mensaje informa post-acción
del usuario, no promociona). Idioma: `es_CL` (caer a `es` si CL no
aprueba). Tiempo de aprobación típico: 24-48h.

## Cuándo usar este runbook

1. **Setup inicial** post `terraform apply`: los secrets se crean con
   versión placeholder (`ROTATE_ME_<name>`). El dispatcher del api
   detecta el placeholder y loguea warn sin enviar template — las
   offers se crean en DB y aparecen en `/app/ofertas` via poll, pero
   los carriers no reciben WhatsApp hasta que se cargue el real.

2. **Aprobación nueva**: Meta aprobó un template tras submit en Twilio
   Console (proceso típico 24-48h).

3. **Rotación**: el SID cambia (raro, generalmente Meta no fuerza
   rotación) o se cambia el friendly name del template.

## Pasos

### 1. Sacar el SID desde Twilio Console

Twilio Console → Content Editor → seleccionar el template aprobado
(`offer_new_v1` o `chat_unread_v1`) → copiar el "Content SID" (formato
`HX` + 32 hex chars).

### 2. Cargar la nueva versión en Secret Manager

```bash
# Para offer_new:
echo -n "HXa30e82ea818a72d08bb12a4214610a86" \
  | gcloud secrets versions add content-sid-offer-new \
      --data-file=- \
      --project=booster-ai-494222

# Para chat_unread (cuando esté aprobado):
echo -n "HXabcdef0123456789abcdef0123456789" \
  | gcloud secrets versions add content-sid-chat-unread \
      --data-file=- \
      --project=booster-ai-494222
```

### 3. Forzar re-deploy del api Cloud Run para tomar el nuevo valor

Cloud Run NO recarga secret values automáticamente — la nueva versión
solo se inyecta en revisiones nuevas. Para que entre:

```bash
# Opción A: redeploy con el mismo image (más rápido):
gcloud run services update booster-ai-api \
  --region=southamerica-west1 \
  --update-secrets=CONTENT_SID_OFFER_NEW=content-sid-offer-new:latest \
  --project=booster-ai-494222

# Opción B: forzar redeploy via dummy annotation:
gcloud run services update booster-ai-api \
  --region=southamerica-west1 \
  --update-annotations=last-secret-rotation=$(date +%s) \
  --project=booster-ai-494222
```

### 4. Verificar

```bash
# Verificar que el api lee el nuevo SID:
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-api"
  jsonPayload.msg=~"oferta enviada"' \
  --limit=5 --project=booster-ai-494222
```

Si las próximas offers loguean `oferta enviada` en lugar de `template
content_sid faltante, skip` → el SID está activo.

### 5. Test manual end-to-end

Crear una oferta de prueba en `/app/cargas/nueva` y confirmar que el
carrier recibe el WhatsApp con el deeplink correcto. Si no llega:

- Verificar que el número Twilio (`+19383365293`) tiene WhatsApp
  enabled y el sender está aprobado por Meta.
- Verificar que el carrier no esté en opt-out (Twilio Studio → Logs).
- Verificar que el template tiene las 4 variables `{{1}}..{{4}}`
  correctamente formateadas en el envío del api.

## Troubleshooting

### "Permission denied" al `gcloud secrets versions add`

Necesitás `roles/secretmanager.admin` o `secretmanager.secrets.update`
sobre el proyecto. Como owner (`dev@boosterchile.com`) deberías tenerlo
heredado. Si no:

```bash
gcloud projects add-iam-policy-binding booster-ai-494222 \
  --member=user:dev@boosterchile.com \
  --role=roles/secretmanager.admin
```

### Cloud Run no toma la nueva versión

Cloud Run cachea por revision. La env var `CONTENT_SID_OFFER_NEW` se
configura como `${secret}:latest` por defecto, pero la revisión actual
ya leyó el valor al crearse. Cualquier `gcloud run services update`
crea revisión nueva → toma el último latest.

Si la nueva revisión sigue mostrando el valor viejo:

```bash
# Ver qué versión está fija en la revisión actual:
gcloud run services describe booster-ai-api \
  --region=southamerica-west1 \
  --format='value(spec.template.spec.containers[0].env[].valueFrom.secretKeyRef.key)' \
  --project=booster-ai-494222
```

Debería mostrar `latest`. Si muestra `1` o un número fijo, el módulo
Terraform está pinneando la versión — ajustar `cloud-run-service`
module si es necesario.

### Verificar versión actual del secret

```bash
gcloud secrets versions list content-sid-offer-new \
  --project=booster-ai-494222
gcloud secrets versions access latest --secret=content-sid-offer-new \
  --project=booster-ai-494222 | head -c 50
echo
```

Si devuelve `ROTATE_ME_content-sid-offer-new` → todavía es el
placeholder, hay que cargar el real (paso 2).

## Refs

- ADR-006 (WhatsApp primary channel): `docs/adr/006-whatsapp-primary-channel.md`
- Twilio Content Editor: https://console.twilio.com/us1/develop/sms/content-editor
- Refactor que movió de variable Terraform a Secret Manager: incidente
  drift 2026-05-07 (apply iba a blanquear `CONTENT_SID_OFFER_NEW`
  productivo a `""`).
