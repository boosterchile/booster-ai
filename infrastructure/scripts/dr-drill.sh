#!/usr/bin/env bash
# Drill de DR por restauración (T10-20, ADR-082 §3). Runbook: docs/runbooks/dr-drill.md
#
# Mide RTO y RPO reales de dos escenarios SIN tocar la instancia primaria:
#   A) pérdida o corrupción de datos → clon PITR en la misma región.
#      Objetivo: RTO ≤ 1 h, RPO ≤ 5 min.
#   B) pérdida de la región → restore del último backup automático en una
#      instancia nueva en otra región. Objetivo: RTO ≤ 8 h, RPO ≤ 24 h.
#      (Mide la capa de datos; la reconstrucción del resto desde Terraform
#      se cronometra aparte, ver runbook §Escenario B.)
#
# Por defecto es una CORRIDA EN SECO: lee el estado (solo lectura) e imprime
# los comandos que ejecutaría. Con --execute crea las instancias temporales
# `dr-drill-a-<fecha>` / `dr-drill-b-<fecha>`, cronometra y escribe el reporte.
# Con --cleanup borra al final las instancias que creó (sin --cleanup quedan
# para verificar datos; se cobran por hora mientras existan).
#
# Usage:
#   dr-drill.sh [--execute] [--cleanup] [--scenario a|b|ab] [--dr-region R] [--report PATH]
#   dr-drill.sh --execute --solo-limpieza [--fecha YYYY-MM-DD]   # borra las dr-drill-* de esa fecha
#
# Permisos del que ejecuta: roles/cloudsql.admin sobre el proyecto (clonar,
# crear, restaurar, borrar instancias). Nunca modifica ni borra la primaria:
# todo comando de escritura apunta a una instancia con prefijo dr-drill-.

set -euo pipefail

PROJECT="${PROJECT:-booster-ai-494222}"
REGION="${REGION:-southamerica-west1}"
DR_REGION="southamerica-east1"
EXECUTE=0
CLEANUP=0
SOLO_LIMPIEZA=0
SCENARIO="ab"
STAMP="$(date -u +%Y-%m-%d)"
REPORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --cleanup) CLEANUP=1 ;;
    --solo-limpieza) CLEANUP=1; SOLO_LIMPIEZA=1 ;;
    --fecha) STAMP="$2"; shift ;;
    --scenario) SCENARIO="$2"; shift ;;
    --dr-region) DR_REGION="$2"; shift ;;
    --report) REPORT="$2"; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$SCENARIO" in a|b|ab) ;; *) echo "--scenario debe ser a, b o ab" >&2; exit 2 ;; esac
REPORT="${REPORT:-docs/runbooks/dr-drill-${STAMP}.md}"

CLONE_A="dr-drill-a-${STAMP}"
DEST_B="dr-drill-b-${STAMP}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
epoch() { date -u +%s; }
iso_to_epoch() { date -u -d "$1" +%s; }
fmt_dur() { local s=$1; printf '%dh %02dm %02ds' $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }

# Ejecuta un comando de ESCRITURA solo con --execute; en seco lo imprime.
# Guarda contra tocar la primaria: el comando debe nombrar una instancia dr-drill-.
write_cmd() {
  case "$*" in *dr-drill-*) ;; *) echo "ABORT: comando de escritura sin instancia dr-drill-: $*" >&2; exit 3 ;; esac
  if [ "$EXECUTE" -eq 1 ]; then
    log "EXEC: $*"
    "$@"
  else
    echo "  [seco] $*"
  fi
}

# Igual que write_cmd, para operaciones largas de Cloud SQL: lanza con --async
# y espera sin límite (el wait por defecto de gcloud corta a los 300 s).
write_async() {
  if [ "$EXECUTE" -eq 1 ]; then
    case "$*" in *dr-drill-*) ;; *) echo "ABORT: comando de escritura sin instancia dr-drill-: $*" >&2; exit 3 ;; esac
    log "EXEC (async): $*"
    local op
    op="$("$@" --async --format='value(name)')"
    log "operación $op: esperando"
    gcloud sql operations wait "$op" --project "$PROJECT" --timeout=unlimited >/dev/null
  else
    write_cmd "$@"
  fi
}

gcloud auth print-access-token >/dev/null 2>&1 || { echo "gcloud sin credenciales válidas" >&2; exit 1; }

RES_A=""; RES_B=""

drill() {
# --- Preflight (solo lectura) ------------------------------------------------
SRC="$(gcloud sql instances list --project "$PROJECT" --filter="name~^booster-ai-pg-" --format='value(name)' | head -1)"
[ -n "$SRC" ] || { echo "no se encontró la instancia booster-ai-pg-*" >&2; exit 1; }
DESC="$(gcloud sql instances describe "$SRC" --project "$PROJECT" --format=json)"
jget() { python3 -I -c "import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1].split('.'):
    v=v.get(k) if isinstance(v,dict) else None
print('' if v is None else v)" "$1" <<<"$DESC"; }
TIER="$(jget settings.tier)"
DBVER="$(jget databaseVersion)"
EDITION="$(jget settings.edition)"
NETWORK="$(jget settings.ipConfiguration.privateNetwork)"
PITR="$(jget settings.backupConfiguration.pointInTimeRecoveryEnabled)"
STATE="$(jget state)"
log "primaria: $SRC ($DBVER, $TIER, $EDITION, estado $STATE, PITR=$PITR)"
[ "$STATE" = "RUNNABLE" ] || { echo "la primaria no está RUNNABLE; no se corre el drill" >&2; exit 1; }

BACKUPS="$(gcloud sql backups list --instance "$SRC" --project "$PROJECT" \
  --filter='status=SUCCESSFUL AND type=AUTOMATED' --sort-by=~endTime --limit=1 \
  --format='value(id,endTime,location)')"
read -r BK_ID BK_END BK_LOC <<<"$BACKUPS"
log "último backup automático: id=$BK_ID fin=$BK_END ubicación=${BK_LOC:-<sin dato>}"


# --- Escenario A: clon PITR --------------------------------------------------
if [[ "$SCENARIO" == *a* ]]; then
  [ "$PITR" = "True" ] || { echo "PITR deshabilitado en la primaria: escenario A no aplica" >&2; exit 1; }
  log "Escenario A: clon PITR → $CLONE_A"
  T0="$(epoch)"
  LATEST="$(gcloud sql instances get-latest-recovery-time "$SRC" --project "$PROJECT" --format='value(latestRecoveryTime)')"
  RPO_A=$(( T0 - $(iso_to_epoch "$LATEST") ))
  log "latestRecoveryTime=$LATEST → RPO medido $(fmt_dur "$RPO_A")"
  write_async gcloud sql instances clone "$SRC" "$CLONE_A" --project "$PROJECT" --point-in-time="$LATEST"
  if [ "$EXECUTE" -eq 1 ]; then
    T1="$(epoch)"
    RTO_A=$(( T1 - T0 ))
    log "clon RUNNABLE: RTO (capa de datos) $(fmt_dur "$RTO_A")"
    RES_A="| A — datos (PITR) | ≤ 1h / ≤ 5m | $(fmt_dur "$RTO_A") | $(fmt_dur "$RPO_A") | $([ $RTO_A -le 3600 ] && [ $RPO_A -le 300 ] && echo cumple || echo NO cumple) |"
  fi
fi

# --- Escenario B: backup → otra región ---------------------------------------
if [[ "$SCENARIO" == *b* ]]; then
  [ -n "$BK_ID" ] || { echo "no hay backup automático exitoso: escenario B no aplica" >&2; exit 1; }
  log "Escenario B: backup $BK_ID → $DEST_B en $DR_REGION"
  T0="$(epoch)"
  RPO_B=$(( T0 - $(iso_to_epoch "$BK_END") ))
  write_async gcloud sql instances create "$DEST_B" --project "$PROJECT" --region "$DR_REGION" \
    --database-version "$DBVER" --tier "$TIER" --edition "$(echo "$EDITION" | tr '[:upper:]' '[:lower:]')" \
    --network "$NETWORK" --no-assign-ip --no-deletion-protection
  write_async gcloud sql backups restore "$BK_ID" --restore-instance "$DEST_B" --backup-instance "$SRC" --project "$PROJECT" --quiet
  if [ "$EXECUTE" -eq 1 ]; then
    T1="$(epoch)"
    RTO_B=$(( T1 - T0 ))
    log "restore completo: RTO (capa de datos) $(fmt_dur "$RTO_B")"
    RES_B="| B — región (backup) | ≤ 8h / ≤ 24h | $(fmt_dur "$RTO_B") + Terraform (ver abajo) | $(fmt_dur "$RPO_B") | $([ $RPO_B -le 86400 ] && echo "RPO cumple; RTO total pendiente de sumar Terraform" || echo "RPO NO cumple") |"
  fi
fi

}

if [ "$SOLO_LIMPIEZA" -eq 0 ]; then
  drill
fi

# --- Limpieza ----------------------------------------------------------------
if [ "$CLEANUP" -eq 1 ]; then
  for inst in "$CLONE_A" "$DEST_B"; do
    if [ "$EXECUTE" -eq 0 ] || gcloud sql instances describe "$inst" --project "$PROJECT" >/dev/null 2>&1; then
      write_cmd gcloud sql instances patch "$inst" --project "$PROJECT" --no-deletion-protection --quiet
      write_cmd gcloud sql instances delete "$inst" --project "$PROJECT" --quiet
    fi
  done
fi

# --- Reporte -----------------------------------------------------------------
if [ "$EXECUTE" -eq 1 ] && [ "$SOLO_LIMPIEZA" -eq 0 ]; then
  {
    echo "# DR drill — ${STAMP}"
    echo
    echo "Generado por \`infrastructure/scripts/dr-drill.sh\` (T10-20, ADR-082 §3). Runbook: [\`dr-drill.md\`](dr-drill.md)."
    echo
    echo "- Primaria: \`$SRC\` ($DBVER, $TIER, $EDITION), región $REGION, PITR=$PITR"
    echo "- Último backup automático: \`$BK_ID\`, fin $BK_END, ubicación ${BK_LOC:-sin dato}"
    echo "- Región de DR del escenario B: $DR_REGION"
    echo
    echo "| Escenario | Objetivo RTO / RPO | RTO medido | RPO medido | Resultado |"
    echo "|---|---|---|---|---|"
    [ -n "$RES_A" ] && echo "$RES_A"
    [ -n "$RES_B" ] && echo "$RES_B"
    echo
    echo "RTO = desde el inicio del comando hasta la instancia restaurada RUNNABLE (capa de datos)."
    echo "RPO A = ahora − latestRecoveryTime; RPO B = ahora − fin del último backup."
    echo
    echo "## Pendiente de completar a mano"
    echo
    echo "- [ ] Verificación de datos en la(s) instancia(s) restaurada(s) (runbook §Verificación)."
    echo "- [ ] Escenario B: tiempo de reconstrucción desde Terraform y RTO total."
    echo "- [ ] Instancias temporales borradas (o \`--cleanup\` usado)."
  } > "$REPORT"
  log "reporte escrito en $REPORT"
elif [ "$EXECUTE" -eq 0 ]; then
  echo
  echo "Corrida en seco completa. Para ejecutar: $0 --execute [--cleanup] --scenario $SCENARIO"
fi
