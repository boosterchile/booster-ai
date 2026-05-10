#!/usr/bin/env bash
# Smoke test del endpoint TLS de telemetry-tcp-gateway (Wave 3).
#
# Validaciones que hace este script en orden:
#
#   1. DNS resuelve `telemetry-tls.boosterchile.com`.
#   2. La IP resuelta coincide con `terraform output telemetry_tls_lb_ip`
#      (detecta drift del manifest K8s vs IP reservada).
#   3. TCP connect a puerto 5061 (LB acepta conexión).
#   4. TLS handshake exitoso a TLSv1.2+ con cert de Let's Encrypt.
#   5. CN/SAN del cert coincide con el dominio esperado.
#   6. Cert no expirado y tiene >7 días de vigencia (early warning).
#   7. (Opcional, --imei <IMEI>) handshake IMEI Teltonika contra el gateway:
#      envía los 17 bytes "IMEI length + IMEI ASCII" y verifica byte 0x01 ACK.
#
# Para el endpoint DR (`telemetry-dr.boosterchile.com`) pasar --dr.
#
# Pre-requisitos:
#   - openssl >= 1.1
#   - dig (BIND tools) o getent
#   - terraform (opcional, si se quiere validar drift de IP)
#
# Usage:
#   ./scripts/smoke-test-wave-3-tls.sh
#   ./scripts/smoke-test-wave-3-tls.sh --dr
#   ./scripts/smoke-test-wave-3-tls.sh --imei 863238075489155
#   ./scripts/smoke-test-wave-3-tls.sh --skip-ip-drift  # sin terraform local

set -euo pipefail

PRIMARY_HOST="telemetry-tls.boosterchile.com"
DR_HOST="telemetry-dr.boosterchile.com"
TLS_PORT="5061"

HOST="$PRIMARY_HOST"
CHECK_IP_DRIFT="true"
IMEI=""

# Parse args.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dr) HOST="$DR_HOST"; shift ;;
    --imei) IMEI="$2"; shift 2 ;;
    --skip-ip-drift) CHECK_IP_DRIFT="false"; shift ;;
    -h|--help)
      grep '^#' "$0" | head -30
      exit 0
      ;;
    *) echo "Arg desconocido: $1"; exit 2 ;;
  esac
done

ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36mℹ\033[0m %s\n' "$*"; }

# -----------------------------------------------------------------------------
# 1. DNS
# -----------------------------------------------------------------------------
info "Resolviendo $HOST..."
if command -v dig >/dev/null 2>&1; then
  RESOLVED_IP=$(dig +short "$HOST" A | head -1)
elif command -v getent >/dev/null 2>&1; then
  RESOLVED_IP=$(getent ahostsv4 "$HOST" | head -1 | awk '{print $1}')
else
  RESOLVED_IP=$(host "$HOST" | awk '/has address/ { print $4 }' | head -1)
fi

if [[ -z "$RESOLVED_IP" ]]; then
  fail "DNS no resolvió $HOST"
fi
ok "DNS resolvió a $RESOLVED_IP"

# -----------------------------------------------------------------------------
# 2. IP drift vs Terraform
# -----------------------------------------------------------------------------
if [[ "$CHECK_IP_DRIFT" == "true" && -d infrastructure ]]; then
  info "Comparando IP DNS con terraform output..."
  TF_OUTPUT_NAME="telemetry_tls_lb_ip"
  [[ "$HOST" == "$DR_HOST" ]] && TF_OUTPUT_NAME="dr_lb_ip"
  TF_IP=$( (cd infrastructure && terraform output -raw "$TF_OUTPUT_NAME" 2>/dev/null) || echo "")
  if [[ -z "$TF_IP" ]]; then
    info "No se pudo leer terraform output $TF_OUTPUT_NAME (skipea con --skip-ip-drift si es intencional)"
  elif [[ "$TF_IP" != "$RESOLVED_IP" ]]; then
    fail "Drift: DNS=$RESOLVED_IP pero terraform output=$TF_IP. El manifest K8s o el A record están desactualizados."
  else
    ok "IP DNS coincide con terraform output ($TF_IP)"
  fi
fi

# -----------------------------------------------------------------------------
# 3. TCP connect
# -----------------------------------------------------------------------------
info "TCP connect a $HOST:$TLS_PORT (5s timeout)..."
if ! timeout 5 bash -c "</dev/tcp/$HOST/$TLS_PORT" 2>/dev/null; then
  fail "No se pudo abrir TCP a $HOST:$TLS_PORT — LB caído o firewall bloqueando"
fi
ok "TCP abierto"

# -----------------------------------------------------------------------------
# 4. TLS handshake
# -----------------------------------------------------------------------------
info "TLS handshake a $HOST:$TLS_PORT..."
TLS_OUTPUT=$(echo | timeout 10 openssl s_client \
  -connect "$HOST:$TLS_PORT" \
  -servername "$HOST" \
  -tls1_2 \
  -verify_return_error \
  2>&1 || true)

if ! echo "$TLS_OUTPUT" | grep -q "Verify return code: 0 (ok)"; then
  echo "$TLS_OUTPUT" | tail -20
  fail "TLS handshake falló o cert chain inválido"
fi
ok "TLS handshake OK (TLSv1.2+, cert chain válido contra raíces públicas)"

# -----------------------------------------------------------------------------
# 5. CN/SAN check
# -----------------------------------------------------------------------------
info "Verificando subject del cert..."
CERT_SUBJECT=$(echo "$TLS_OUTPUT" | sed -n 's/^subject=//p' | head -1)
if ! echo "$CERT_SUBJECT" | grep -q "$HOST"; then
  echo "subject: $CERT_SUBJECT"
  fail "El subject del cert no contiene $HOST"
fi
ok "Subject incluye $HOST"

# -----------------------------------------------------------------------------
# 6. Vigencia >7 días
# -----------------------------------------------------------------------------
info "Verificando vigencia del cert..."
CERT_PEM=$(echo "$TLS_OUTPUT" | awk '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/')
END_DATE=$(echo "$CERT_PEM" | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')
if [[ -z "$END_DATE" ]]; then
  fail "No se pudo parsear notAfter del cert"
fi

END_TS=$(date -u -d "$END_DATE" +%s 2>/dev/null || date -u -j -f "%b %e %T %Y %Z" "$END_DATE" +%s 2>/dev/null || echo 0)
NOW_TS=$(date -u +%s)
DAYS_REMAINING=$(( (END_TS - NOW_TS) / 86400 ))

if [[ "$END_TS" -le "$NOW_TS" ]]; then
  fail "Cert ya expirado (notAfter=$END_DATE)"
elif [[ "$DAYS_REMAINING" -lt 7 ]]; then
  fail "Cert expira en $DAYS_REMAINING días — cert-manager debería haber renovado, revisar logs"
fi
ok "Cert vigente — $DAYS_REMAINING días restantes (renueva @30d)"

# -----------------------------------------------------------------------------
# 7. (Opcional) handshake IMEI Teltonika
# -----------------------------------------------------------------------------
if [[ -n "$IMEI" ]]; then
  info "Probando handshake IMEI Teltonika con $IMEI..."
  IMEI_LEN=${#IMEI}
  # Header: 2 bytes big-endian con la longitud del IMEI, seguido del IMEI ASCII.
  IMEI_LEN_HEX=$(printf '%04x' "$IMEI_LEN")
  IMEI_HEX=$(printf '%s' "$IMEI" | xxd -p | tr -d '\n')
  PACKET_HEX="${IMEI_LEN_HEX}${IMEI_HEX}"

  # openssl s_client en background con stdin del packet IMEI.
  ACK=$(printf '%s' "$PACKET_HEX" | xxd -r -p | \
    timeout 10 openssl s_client -connect "$HOST:$TLS_PORT" -servername "$HOST" -tls1_2 -quiet 2>/dev/null | \
    head -c 1 | xxd -p | tr -d '\n' || true)

  if [[ "$ACK" == "01" ]]; then
    ok "Gateway respondió ACK 0x01 al handshake IMEI"
  else
    fail "Gateway no respondió ACK válido (recibido=0x$ACK, esperado=0x01). Verificar: device aprobado en BD o auto-enrollment habilitado."
  fi
fi

echo
ok "Smoke test Wave 3 TLS PASS contra $HOST"
