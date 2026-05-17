# Runbook — Agent query helper (queries headless contra Cloud SQL prod)

**Audience**: agentes Claude/SDK + operadores humanos debugando lo que el agente reportó.

**Spec**: [`docs/specs/2026-05-17-agent-query-helper.md`](../specs/2026-05-17-agent-query-helper.md)
**Plan**: [`docs/plans/2026-05-17-agent-query-helper.md`](../plans/2026-05-17-agent-query-helper.md)
**ADR**: [`docs/adr/045-agent-query-helper.md`](../adr/045-agent-query-helper.md)

---

## Quick start

```bash
# Query inline
scripts/db/agent-query.sh -c "SELECT to_regclass('public.usuarios')"

# Query desde archivo
scripts/db/agent-query.sh -f scripts/sql/check-something.sql

# Si el SQL contiene DML/DDL keywords (UPDATE/DELETE/etc.) y querés saltearlo
scripts/db/agent-query.sh -y -c "..."
```

Output va a stdout. Errors a stderr. Exit code 0 si query exitosa, ≠0 en cualquier error (preconditions, tunnel, SQL).

---

## Cuándo usar

| Caso | Ejemplo |
|---|---|
| Verificar existencia de tabla/columna tras migration | `SELECT to_regclass('public.log_acceso_stakeholder')` |
| Contar registros con condición | `SELECT count(*) FROM viajes WHERE estado='entregado' AND fecha > now() - interval '7 days'` |
| Últimos N timestamps para forensia | `SELECT id, creado_en FROM ofertas ORDER BY creado_en DESC LIMIT 20` |
| Verificar migration aplicada | `SELECT tag, when_ms FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5` |
| Inspeccionar estado tras incidente | `SELECT estado, count(*) FROM viajes GROUP BY estado` |

---

## Cuándo NO usar

- **Mutations** (UPDATE/INSERT/DELETE/DDL): usar migrations en `apps/api/drizzle/` + Drizzle migrator. El helper avisa con warning + abort si stdin no es TTY.
- **Queries >MB de resultado**: lento + pesado para el bastion VPC connector. Para data export grande usar `gcloud sql export` directamente.
- **Loops automatizados**: el bastion no está dimensionado para alto throughput. Si necesitás >20 queries/min sostenidos, evaluar `booster_query_tool` read-only rol + monitor de tasa.
- **Queries que requieren transacciones multi-statement**: el script ejecuta `psql -c <SQL>` por invocación; cada call abre+cierra sesión.

---

## Comparación con `scripts/db/connect.sh`

| Aspecto | `connect.sh` | `agent-query.sh` |
|---|---|---|
| Audience | Operador humano interactivo | Agente headless |
| Auth | `gcloud auth login` (user OAuth) | ADC vía `--access-token-file` |
| Persistencia tunnel | Sesión psql interactiva | Per-invocación (script up + tear-down) |
| Auth mode default | IAM (PGUSER=email) | Password (booster_app via Secret Manager) |
| Funciona headless | NO (`gcloud auth print-access-token` falla si user OAuth expira) | SÍ |
| Local port default | 5433 | 5436 (para coexistir) |
| DML warning | No | Sí (soft + confirmation) |

---

## Pre-requisitos

1. **ADC activo en la laptop**: `gcloud auth application-default login` (corrido al menos 1 vez; persiste). Verificable:
   ```bash
   gcloud auth application-default print-access-token | head -c 20
   # → ya29....
   ```
2. **`psql` instalado**: el script auto-instala con `brew install libpq && brew link --force libpq` si falta.
3. **`dev@boosterchile.com` como Owner del project**: garantiza IAP tunneling transitivo. Verificable:
   ```bash
   gcloud projects get-iam-policy booster-ai-494222 \
     --filter="bindings.members:user:dev@boosterchile.com AND bindings.role:roles/owner" \
     --format=json | head -20
   ```
4. **Bastion `db-bastion` RUNNING** en zona `southamerica-west1-a`. Verificable vía REST con ADC token (gcloud user OAuth opcional):
   ```bash
   TOKEN=$(gcloud auth application-default print-access-token)
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://compute.googleapis.com/compute/v1/projects/booster-ai-494222/zones/southamerica-west1-a/instances/db-bastion" \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name'), d.get('status'))"
   # → db-bastion RUNNING
   ```

---

## Env vars (overrides opcionales)

| Var | Default | Cuándo cambiar |
|---|---|---|
| `PROJECT_ID` | `booster-ai-494222` | Otro proyecto (no aplica hoy) |
| `ZONE` | `southamerica-west1-a` | Si bastion se mueve de zona |
| `BASTION_NAME` | `db-bastion` | Si se renombra |
| `LOCAL_PORT` | `5436` | Si 5436 está ocupado (ej. otra sesión del script o `connect.sh`) |
| `DB_NAME` | `booster_ai` | Otra DB del mismo cluster (no aplica hoy) |
| `STATEMENT_TIMEOUT_S` | `30` | Query que legítimamente toma más (ej. análisis sobre tabla grande) |
| `TUNNEL_TIMEOUT_S` | `30` | Red lenta hacia GCP |

---

## Troubleshooting

### 1. "No hay credenciales ADC válidas"

Mensaje exacto: `✗ No hay credenciales ADC válidas. Corré: gcloud auth application-default login`

Causa: ADC nunca configurado en este host, o el refresh token expiró (>90 días sin uso).

Fix: corré `gcloud auth application-default login` una vez. El comando abre browser, una vez authorizado el refresh token persiste localmente en `~/.config/gcloud/application_default_credentials.json`.

### 2. Tunnel no quedó listening tras 30s

Mensaje exacto: `✗ tunnel no quedó listening tras 30s. Log:` seguido del log de gcloud.

Causas posibles + fix:

- **Bastion DOWN**: verificá con la query del pre-requisito #4. Si status ≠ RUNNING, escalá a SRE — bastion estaba previsto siempre RUNNING (per ADR-013).
- **IAP firewall rule eliminada**: poco probable; la regla `allow-iap` existe en Terraform (`infrastructure/modules/iap-bastion/main.tf`). Si fue eliminada, restaurar via terraform apply.
- **Red local rara**: VPN corporativa puede bloquear IAP TCP (35.235.240.0/20 origin range). Probar desconectando VPN.
- **Increase `TUNNEL_TIMEOUT_S=60`**: red lenta hacia GCP.

### 3. `psql: command not found`

El script auto-instala con `brew install libpq && brew link --force libpq`. Si brew no está, instalarlo desde [brew.sh](https://brew.sh/).

### 4. `Permission denied for relation X` o similar

El usuario DB es `booster_app` (con full DML/DDL en `public.*` por defecto). Permission denied indica que se está consultando schema fuera de `public.*` o `drizzle.*`. Verificar `current_user` y `current_database()`:

```bash
scripts/db/agent-query.sh -c "SELECT current_user, current_database()"
```

### 5. `bind: Address already in use`

Otro proceso (probablemente sesión previa del helper o `connect.sh` en LOCAL_PORT=5433 → puerto distinto, pero `agent-query.sh` usa 5436 por default) ocupa el puerto.

Fix: cambiar puerto via `LOCAL_PORT=5440 scripts/db/agent-query.sh ...` o matar el proceso (`lsof -iTCP:5436 -sTCP:LISTEN`).

### 6. Query corre y retorna `(0 rows)` cuando esperabas resultados

Verifica que `current_user` y `current_database()` son los esperados (ver troubleshooting #4). El script siempre conecta a `booster_ai` (DB de prod) — si esperabas otra DB, no aplica este helper.

---

## Audit trail

Toda invocación queda registrada en:

1. **Cloud Audit Logs** (acceso IAP tunnel):
   - Filtro: `protoPayload.serviceName="iap.googleapis.com"` AND `protoPayload.resourceName=~"db-bastion"`.
   - Captura: timestamp + email del invocador (dev@boosterchile.com via ADC) + IP origen.

2. **pg_audit en Cloud SQL** (queries ejecutadas):
   - Configurado a nivel instance (ver Terraform `infrastructure/data.tf`).
   - Captura el SQL bajo identidad `booster_app` (no del invocador del IAP — gap conocido, ADR-013 Capa 2 lo cierra cuando migremos a IAM database auth).

Para forensia post-incidente: cruzar los timestamps de los dos logs identifica qué humano/agente corrió qué query.

---

## Limitaciones conocidas

| Limitación | Status |
|---|---|
| pg_audit captura como `booster_app`, no per-invocador | ADR-013 Capa 2 pendiente |
| Sin rate limit explícito | OK para uso esperado (pocas queries/sesión). Si subimos, evaluar |
| Soft warning DML, no hard reject | Confiamos en agente + humano review. Si hay incidente, escalar a `booster_query_tool` read-only role |
| Sin caching de tunnel entre invocaciones | Cada call: ~3s setup overhead. Aceptable |
| Solo prod (no dev/staging) | Para dev usar `booster_test_prototype` local |

---

## Cambios futuros (out-of-scope v1)

- `booster_query_tool` read-only role via Terraform (defense in depth si patrón se vuelve frecuente).
- IAM database auth (ADR-013 Capa 2) para audit per-invocador real.
- Wrapper TS si bash script crece >150 LOC.
