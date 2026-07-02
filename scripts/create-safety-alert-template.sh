#!/usr/bin/env bash
#
# create-safety-alert-template.sh — crea el template WhatsApp `safety_alert_v3`
# vía Twilio Content API y lo submitea a Meta para aprobación.
#
# CONTEXTO
#   El fan-out de seguridad (P0-G) notifica al transportista ante eventos
#   crash/unplug/jamming. El canal WhatsApp usa un template Twilio cuyo Content
#   SID se carga en el secret `content-sid-safety-alert` (ver
#   docs/runbooks/load-content-sids.md). El wiring de infra ya existe (#476).
#
#   ESTADO (2026-06-22): `safety_alert_v2` (HX48d541ad8f2cab4e4f65165cb26489b1)
#   está APPROVED por Meta y LIVE en prod — el canal WhatsApp de safety funciona.
#   ESTE SCRIPT NO ES NECESARIO en condiciones normales; solo se corre como
#   FALLBACK si Meta llegara a pausar/deshabilitar v2 (por feedback negativo).
#
#   Historia de aprobación (Meta):
#     v1            HX0d6363fd0162c2d71519ed4e3afe2e3d  REJECTED (subCode 2388293)
#     copy_of_v1    HX80819b02ce9a546b855d09ada1aac944  REJECTED (mismo subCode)
#     v2            HX48d541ad8f2cab4e4f65165cb26489b1  APPROVED + LIVE (tardó ~7d
#                   en revisión humana por su contenido sensible, pero se aprobó).
#
#   El fallback v3 que crea este script de-riesga el contenido para auto-aprobar
#   rápido si v2 cae: (a) sin la instrucción de servicios de emergencia (van por
#   app/push); (b) sin líneas en blanco (\n\n → \n); (c) tono transaccional sin
#   emojis. Mantiene las MISMAS 4 variables {{1}}..{{4}} en el mismo orden → cero
#   cambios en dispatch-safety-notification.ts. Ver el spec para el flujo de rotación:
#   .specs/safety-event-fanout/whatsapp-template.md
#
# VARIABLES (las arma el código, ver dispatch-safety-notification.ts:121-126)
#   {{1}} patente del vehículo        (vehicleLabel = vehicle.plate)
#   {{2}} tipo de evento (label es)   (safetyEventLabel: Posible colisión, etc.)
#   {{3}} hora local Chile            (formatHoraLocal: "15 jun, 10:00")
#   {{4}} tracking_code del viaje      (o "Sin viaje activo")
#
# USO
#   ./scripts/create-safety-alert-template.sh
#
#   Requiere: gcloud autenticado con acceso a los secrets twilio-account-sid y
#   twilio-auth-token del proyecto, python3, curl. NO recibe ni hardcodea
#   credenciales — las lee de Secret Manager en runtime.
#
set -euo pipefail

PROJ="booster-ai-494222"
NAME="safety_alert_v3"

echo "→ Leyendo credenciales Twilio desde Secret Manager (proyecto $PROJ)…"
TW_SID="$(gcloud secrets versions access latest --secret=twilio-account-sid --project="$PROJ")"
TW_TOK="$(gcloud secrets versions access latest --secret=twilio-auth-token  --project="$PROJ")"

# Payload de creación: python3 arma el JSON para escapar bien newlines y acentos
# del body. El body es body-only (twilio/text); el deep-link al vehículo y los
# contactos de ayuda van por push / la app, no por el template.
CREATE_PAYLOAD="$(python3 - "$NAME" <<'PY'
import json, sys
name = sys.argv[1]
body = (
    "Hola, te escribe el sistema de Booster AI. Detectamos un evento en uno de "
    "tus vehículos que necesita tu atención.\n"
    "Vehículo (patente): {{1}}\n"
    "Evento detectado: {{2}}\n"
    "Hora (Chile): {{3}}\n"
    "Viaje asociado: {{4}}\n"
    "Revisa cuanto antes el estado del vehículo y de la carga, y respóndenos por "
    "este chat para confirmar que recibiste este aviso. Encontrarás el detalle y "
    "los contactos de ayuda en la app de Booster AI."
)
print(json.dumps({
    "friendly_name": name,
    "language": "es",
    # Sample values: Meta los exige para renderizar el template en la revisión.
    "variables": {
        "1": "RJXK-42",
        "2": "Posible colisión",
        "3": "15 jun, 10:00",
        "4": "BOO-7F3A2C",
    },
    "types": {"twilio/text": {"body": body}},
}))
PY
)"

echo "→ Creando content '$NAME' vía Content API…"
CREATE_RESP="$(curl -sS -u "$TW_SID:$TW_TOK" \
  -H 'Content-Type: application/json' \
  -X POST "https://content.twilio.com/v1/Content" \
  -d "$CREATE_PAYLOAD")"

CONTENT_SID="$(printf '%s' "$CREATE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sid"])')"
echo "✅ Content creado: $CONTENT_SID"

echo "→ Submiteando a Meta para aprobación WhatsApp (categoría UTILITY)…"
curl -sS -u "$TW_SID:$TW_TOK" \
  -H 'Content-Type: application/json' \
  -X POST "https://content.twilio.com/v1/Content/${CONTENT_SID}/ApprovalRequests/whatsapp" \
  -d "{\"name\": \"${NAME}\", \"category\": \"UTILITY\"}" | python3 -m json.tool

cat <<EOF

────────────────────────────────────────────────────────────────────────────
Content SID nuevo: ${CONTENT_SID}

Próximos pasos (detalle completo en docs/runbooks/load-content-sids.md):

  1. Vigilar la aprobación de Meta: consultar el endpoint ApprovalRequests de
     este Content SID (${CONTENT_SID}) hasta que whatsapp.status == "approved".
     El comando exacto (curl autenticado) está en el runbook.

  2. Al aprobar, cargar el SID como nueva versión del secret (el env var ya está
     montado en prod desde #476, así que basta agregar la versión + redeploy):
       echo -n "${CONTENT_SID}" | gcloud secrets versions add content-sid-safety-alert --data-file=- --project=${PROJ}
       gcloud run services update booster-ai-api --region=southamerica-west1 \\
         --update-secrets=CONTENT_SID_SAFETY_ALERT=content-sid-safety-alert:latest --project=${PROJ}
────────────────────────────────────────────────────────────────────────────
EOF
