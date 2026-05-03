# Acceso a Cloud SQL (Booster AI)

Setup definitivo de acceso a la DB de producción para operadores humanos.

Patrones de acceso definidos en:
- **[ADR-013](../../docs/adr/013-database-access-pattern.md)** — patrón 3 capas (humanos / Cloud Run / jobs).
- **[ADR-014](../../docs/adr/014-cloud-sql-auto-iam-authn-bastion.md)** — `--auto-iam-authn` en bastion para dev local persistente.

## Filosofía

| Caso | Mecanismo | Auth | Atribución audit |
|------|-----------|------|------------------|
| **Cloud Run services productivos** | VPC connector → Cloud SQL privada | `booster_app` + password Secret Manager | n/a (service-level) |
| **Dev local recurrente** (psql, MCP postgres, DBeaver, drizzle-kit) | LaunchAgent IAP tunnel persistente → bastion proxy `--auto-iam-authn` | rol Postgres = SA `db-bastion-sa` | IAP audit logs (humano que abrió túnel) |
| **DDL / migrations / GRANTs / hotfix admin** | `connect.sh AUTH_MODE=password` → `gcloud start-iap-tunnel` ad-hoc → bastion proxy | `booster_app` + password Secret Manager | password mode — atribución manual |
| **Cloud Run Jobs (one-off ops)** | VPC connector + SA del Cloud Run | misma SA que services | execution log + git SHA |

El path **dev local recurrente** es el que cambió con ADR-014: connection string fijo, refresh de token transparente, MCP postgres usable como user-scope.

## Quick start — dev local recurrente (ADR-014)

### Una sola vez

```bash
# 1. Auth gcloud
gcloud auth login dev@boosterchile.com
gcloud config set project booster-ai-494222

# 2. Verificar que terraform apply ya aplicó los cambios del ADR-014
gcloud sql users list --instance=$(gcloud sql instances list --format='value(name)' | head -1) \
  | grep db-bastion-sa  # debe aparecer como CLOUD_IAM_SERVICE_ACCOUNT

# 3. Aplicar GRANTs al rol nuevo (booster_app + password mode)
bash scripts/db/connect.sh AUTH_MODE=password \
  -f scripts/sql/2026-05-03-grant-bastion-sa.sql

# 4. Instalar LaunchAgent (requiere editar el plist con paths absolutos primero)
GCLOUD_BIN=$(which gcloud)
sed "s|__GCLOUD_BIN__|${GCLOUD_BIN}|g; s|__ABSOLUTE_PATH__|$(pwd)|g" \
  scripts/db/iap-tunnel.plist.template \
  > ~/Library/LaunchAgents/com.booster.db-iap-tunnel.plist

launchctl load -w ~/Library/LaunchAgents/com.booster.db-iap-tunnel.plist

# 5. Verificar
bash scripts/db/connect-local.sh status
# → ✓ tunel activo en 127.0.0.1:5432

# 6. Setup MCP postgres user-scope (Claude Code Desktop / CLI)
claude mcp remove postgres 2>/dev/null || true
claude mcp add postgres --scope user -- \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://db-bastion-sa%40booster-ai-494222.iam:dummy@127.0.0.1:5432/booster_ai?sslmode=disable"
```

### Uso diario

```bash
# psql interactivo (rol = SA del bastion, permisos: SELECT/INSERT/UPDATE/DELETE)
bash scripts/db/connect-local.sh psql

# Una query rápida
bash scripts/db/connect-local.sh -c "SELECT count(*) FROM mensajes_chat"

# Un script SQL (queries de exploración, no DDL)
bash scripts/db/connect-local.sh -f scripts/sql/exploration-2026-05-03.sql

# Estado del túnel
bash scripts/db/connect-local.sh status
```

El MCP postgres queda funcionando 24/7 mientras el LaunchAgent esté cargado.

## Quick start — admin / DDL / migrations (`connect.sh` legacy)

Para operaciones que requieren `CREATE/ALTER/DROP/TRUNCATE` o cambiar passwords, usar el script clásico en password mode:

```bash
# psql como booster_app (acceso completo)
AUTH_MODE=password bash scripts/db/connect.sh

# Aplicar una migration
AUTH_MODE=password bash scripts/db/connect.sh -f scripts/sql/2026-05-03-add-column.sql
```

Este script levanta el túnel ad-hoc, conecta como `booster_app` (password de Secret Manager), y limpia el túnel al exit. **No usa** el LaunchAgent.

## Connection string para tooling externo

DBeaver / DataGrip / `psql` standalone / drizzle-kit / cualquier MCP postgres:

```
Host:       127.0.0.1
Port:       5432
Database:   booster_ai
Username:   db-bastion-sa@booster-ai-494222.iam
Password:   dummy   (literalmente — el proxy del bastion lo ignora)
SSL Mode:   disable
```

URL completa:
```
postgresql://db-bastion-sa%40booster-ai-494222.iam:dummy@127.0.0.1:5432/booster_ai?sslmode=disable
```

(`%40` es `@` URL-encoded — necesario porque el username contiene `@`)

## Agregar más operadores

Editar `infrastructure/data.tf` `local.db_iam_operators` con el nuevo email, `terraform apply`. Eso le da acceso a abrir el túnel IAP via su gcloud auth. **Una vez abierto el túnel**, el operador queda atribuido en IAP audit logs y puede consumir el proxy del bastion (que autentica como SA al backend Postgres).

```hcl
locals {
  db_iam_operators = [
    "dev@boosterchile.com",
    "nuevo@boosterchile.com",
  ]
}
```

El operador nuevo clona el repo, corre `gcloud auth login`, instala el LaunchAgent (5 min de setup), listo.

## Troubleshooting

### Connection refused en `127.0.0.1:5432`

```bash
bash scripts/db/connect-local.sh status
# → si dice "no hay tunel listening", el LaunchAgent murió
launchctl list | grep com.booster.db-iap-tunnel  # ver status
launchctl unload ~/Library/LaunchAgents/com.booster.db-iap-tunnel.plist
launchctl load -w ~/Library/LaunchAgents/com.booster.db-iap-tunnel.plist
tail -f /tmp/booster-iap-tunnel.stderr.log  # ver por qué murió
```

### `FATAL: pg_hba.conf rejects connection`

El rol `db-bastion-sa@booster-ai-494222.iam` no existe en Postgres. Verificar:
1. `terraform apply` corrió tras el merge del PR del ADR-014.
2. `gcloud sql users list` muestra el SA como `CLOUD_IAM_SERVICE_ACCOUNT`.
3. El proxy del bastion fue reiniciado tras el cambio del systemd unit:
   ```bash
   gcloud compute ssh db-bastion --zone=southamerica-west1-a --tunnel-through-iap \
     --command="sudo systemctl restart cloud-sql-proxy && systemctl status cloud-sql-proxy"
   ```

### `permission denied for table X` desde MCP / psql con SA

GRANTs no aplicados. Correr `scripts/sql/2026-05-03-grant-bastion-sa.sql` con `AUTH_MODE=password`.

### El access token "expira" — queries fallan tras horas

No deberían — el proxy del bastion refresca tokens automáticamente vía metadata service. Si pasa, es bug del proxy o del LaunchAgent. Reiniciar:
```bash
launchctl kickstart -k gui/$(id -u)/com.booster.db-iap-tunnel
gcloud compute ssh db-bastion --tunnel-through-iap --command="sudo systemctl restart cloud-sql-proxy"
```

### Quiero ver quién corrió una query concreta

`pg_audit` mostrará todo como `db-bastion-sa@...`. Cruzar con IAP audit log:

```bash
gcloud logging read \
  'resource.type="iap_tunnel_dest_group" AND timestamp>="2026-05-03T15:00:00Z"' \
  --project=booster-ai-494222 \
  --format='table(timestamp,protoPayload.authenticationInfo.principalEmail)' \
  --limit=20
```

Cruza con timestamp de la query en `pg_audit` para inferir el humano. Para análisis forense recurrente, escribir un runbook en `docs/runbooks/audit-bastion-queries.md`.
