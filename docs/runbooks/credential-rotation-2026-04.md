# Runbook: Rotación de credenciales expuestas (Sesión 2026-04-29)

**Fecha:** 2026-04-29
**Severidad:** Medium. Las credenciales se compartieron en chat con el
agente AI durante setup. Sesión Cowork es local pero el chat queda
persistido en disco. Buena práctica: rotar todas.
**Owner:** dev@boosterchile.com

## Credenciales a rotar

| # | Credencial | Donde está expuesta | Acción |
|---|---|---|---|
| 1 | Twilio Auth Token | Chat sesión 2026-04-29 | Rotar en Twilio + actualizar `twilio-auth-token` secret |
| 2 | Meta App Secret | Chat sesión 2026-04-29 | Rotar en Meta App Dashboard + actualizar `whatsapp-app-secret` secret |
| 3 | Meta Access Token | Chat sesión 2026-04-29 | Rotar en Meta Business System User + actualizar `whatsapp-access-token` secret |
| 4 | Postgres password Cloud SQL | Chat sesión 2026-04-29 | Regenerar via Terraform `random_password` taint |
| 5 | Webhook verify token | Chat sesión 2026-04-29 | Bajar prioridad: secret está deprecated (Meta path no se usa) |

Valores específicos NO se replican en este runbook (push protection los
bloquea). Recuperar de la sesión chat de la fecha indicada o de
`gcloud secrets versions access` si fueron escritos a Secret Manager.

NO sensibles (no requieren rotación):

- Twilio Account SID — equivale a un user-id, no funciona sin auth token.
- Phone Number IDs Meta — identifiers públicos.
- Business Account IDs — públicos.

## Pasos

### 1. Twilio Auth Token (PRIORIDAD ALTA)

El Auth Token actual habilita: enviar mensajes WhatsApp en nombre de la
cuenta + recibir webhooks firmados. Si lo tiene un atacante, puede
suplantar el bot.

```sh
# 1. Login a https://console.twilio.com con dev@boosterchile.com
# 2. Sidebar → Account → API keys & tokens → Auth Tokens
# 3. Click "Create new Auth Token" → confirmar
# 4. Twilio te muestra el primary y secondary. El primary es el activo,
#    el secondary se promueve cuando rotas otra vez.
# 5. Copiar el NUEVO primary auth token.
# 6. Subirlo a Secret Manager:

echo -n '<NEW_AUTH_TOKEN>' | gcloud secrets versions add twilio-auth-token \
  --data-file=- --project=booster-ai-494222

# 7. Forzar nueva revisión del bot para que recargue el secret:

gcloud run services update booster-ai-whatsapp-bot \
  --update-secrets=TWILIO_AUTH_TOKEN=twilio-auth-token:latest \
  --region=southamerica-west1 \
  --project=booster-ai-494222

# 8. Verificar que webhooks Twilio sigan validando: mandar un mensaje
#    desde tu WhatsApp al sandbox, verificar logs:

gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="booster-ai-whatsapp-bot" AND severity>=WARNING' \
  --project=booster-ai-494222 --limit=10 --freshness=2m
# No debería aparecer "Twilio webhook signature invalid".

# 9. En Twilio: revoke/promote el token VIEJO al secondary tras 1 hora
#    (ventana para detectar regresiones).
```

### 2. Meta App Secret (DEPRECATED PATH — baja prioridad)

Meta App Secret se usa SOLO si volvemos a Meta Cloud API directo (Fase 6.4
nos migró a Twilio). El secret está en Secret Manager pero ningún Cloud
Run lo monta. Aún así, rotar por hygiene.

```sh
# 1. Login a https://developers.facebook.com/apps/1374508168037432/settings/basic/
# 2. App Secret → Show → Reset (Meta exige password de la cuenta).
# 3. Copiar el nuevo secret.
# 4. Subirlo:

echo -n '<NEW_APP_SECRET>' | gcloud secrets versions add whatsapp-app-secret \
  --data-file=- --project=booster-ai-494222

# 5. No hace falta redeploy porque el bot no monta este secret. Quedará
#    listo para cuando se reactive el path Meta.
```

### 3. Meta Access Token (DEPRECATED PATH — baja prioridad)

Mismo razonamiento que el App Secret. El access token de Business System
User no se usa actualmente.

```sh
# 1. Login a Meta Business → System Users → click el system user que generó
#    el token actual.
# 2. Generate New Token → seleccionar app + permisos (whatsapp_business_*).
# 3. Copiar el nuevo token.
# 4. Subirlo:

echo -n '<NEW_ACCESS_TOKEN>' | gcloud secrets versions add whatsapp-access-token \
  --data-file=- --project=booster-ai-494222
```

### 4. Postgres password Cloud SQL

El password fue mostrado en pantalla durante debugging del DATABASE_URL.
Aunque la conexión es vía VPC privado, rotar es defensa en profundidad.

```sh
# Hay dos opciones:

# OPCIÓN A — Rotación manual via gcloud (simple, sin tocar Terraform).
#   No es 100% Terraform-managed después → drift.

NEW_PW=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
gcloud sql users set-password booster_app \
  --instance=booster-ai-pg-07d9e939 \
  --password="$NEW_PW" \
  --project=booster-ai-494222

# Reconstruir DATABASE_URL con urlencode + uselibpqcompat:
NEW_URL="postgresql://booster_app:$(node -e "console.log(encodeURIComponent('$NEW_PW'))")@<PRIVATE_IP>:5432/booster_ai?sslmode=require&uselibpqcompat=true"
echo -n "$NEW_URL" | gcloud secrets versions add database-url \
  --data-file=- --project=booster-ai-494222

# OPCIÓN B (RECOMENDADA) — taint del random_password en Terraform:

cd infrastructure
terraform taint random_password.pg_app_password
terraform plan
# Verificar que cambia: pg password regenerated, sql_user updated, secret
# database-url updated. Cloud Run api revisión nueva (re-mounts secret).
terraform apply

# Forzar redeploy del api para que tome el secret nuevo:
gcloud run services update booster-ai-api \
  --update-secrets=DATABASE_URL=database-url:latest \
  --region=southamerica-west1 \
  --project=booster-ai-494222
```

### 5. Webhook verify token (Meta) — DEFER

Este secret es para el handshake GET de Meta webhook (path Meta direct).
Como migramos a Twilio, no se usa. Rotar sólo si se reactiva Meta path.
Está documentado como deprecated en `infrastructure/security.tf`.

## Validación post-rotación

```sh
# Para cada secret rotado, verificar que la versión nueva existe:
for secret in twilio-auth-token whatsapp-app-secret whatsapp-access-token database-url; do
  echo "--- $secret ---"
  gcloud secrets versions list "$secret" --project=booster-ai-494222 --limit=3
done

# Smoke test end-to-end del bot:
# 1. Mandar "hola" desde WhatsApp al sandbox/sender.
# 2. Verificar que el bot responde con menú normal.
# 3. Completar flow hasta tracking code → confirma que api también funciona.
```

## Lecciones aprendidas / acción correctiva

- **Causa raíz:** durante debugging, fue más rápido pegar tokens en chat
  para iterar que generar tokens nuevos / usar `gcloud secrets versions
  access` indirectamente.
- **Mitigación futura:**
  1. Para tokens sensibles, usar siempre comandos que NO los muestran:
     `gcloud secrets versions access latest --secret=X --project=Y` redirige
     a archivo temporal o pipe directo.
  2. Habilitar Secret Manager **secret rotation** automática para tokens
     que lo soporten (Twilio API keys con scoped permissions).
  3. Considerar `gcloud secrets versions add` desde stdin no-tty cuando
     posible.
  4. Para credenciales que necesitan generarse con `openssl rand`, usar
     `tee /dev/null` o pipe directo sin echo intermedio.
