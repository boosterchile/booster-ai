# ADR-014 — Cloud SQL Auth Proxy en bastion con `--auto-iam-authn` para dev local

- **Estado**: Accepted
- **Fecha**: 2026-05-03
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede parcialmente**: [ADR-013](./013-database-access-pattern.md) — sección "Capa 1 — Acceso humano (a implementar)" y comentarios de `infrastructure/modules/iap-bastion/main.tf` que decían "el proxy NO usa --auto-iam-authn".

## Contexto

ADR-013 estableció el patrón de 3 capas para acceso a Cloud SQL. La Capa 1 (operadores humanos) se implementó como:

```
laptop ──► gcloud start-iap-tunnel ──► bastion ──► cloud-sql-proxy ──► Cloud SQL
                                                     (sin --auto-iam-authn)
```

El operador humano pasa su `gcloud auth print-access-token` como `PGPASSWORD` desde la laptop (ver `scripts/db/connect.sh` líneas 115-118). Eso preserva audit per-usuario en `pg_audit` (cada query queda atribuida al email del operador). Funciona para queries ad-hoc.

Pero al integrar **MCP postgres server** de Claude Code para queries asistidas y al automatizar el flujo dev local, este patrón rompe en 2 puntos:

1. **El access token expira a los ~60 min**. El MCP server espera una connection string estable; cuando expira, todas las queries fallan hasta que el operador re-corra `connect.sh`. No hay refresh automático en el path actual.
2. **El connection string cambia cada sesión** (token regenerado). Imposible persistirlo en `~/.claude.json` o en un LaunchAgent del Mac.

Resultado observado: dev pierde 5-10 min cada hora reabriendo el túnel, y el MCP postgres no puede vivir como servicio user-scope persistente.

## Decisión

Trasladar `--auto-iam-authn` al `cloud-sql-proxy` que corre en el bastion. Cambios:

1. **Bastion systemd unit** (`infrastructure/modules/iap-bastion/main.tf:59`):
   ```diff
   - ExecStart=$PROXY_BIN --address=0.0.0.0 --port=5432 --private-ip ${conn_name}
   + ExecStart=$PROXY_BIN --address=0.0.0.0 --port=5432 --private-ip --auto-iam-authn ${conn_name}
   ```
2. **SA del bastion**: añadir `roles/cloudsql.instanceUser` (ya tenía `cloudsql.client`).
3. **Postgres role**: registrar `db-bastion-sa@booster-ai-494222.iam` como `CLOUD_IAM_SERVICE_ACCOUNT` (`google_sql_user.bastion_sa` en `data.tf`).
4. **GRANTs SQL post-apply**: `scripts/sql/2026-05-03-grant-bastion-sa.sql` aplica los privilegios al rol nuevo (CONNECT a `booster_ai`, USAGE en `public`, SELECT/INSERT/UPDATE/DELETE en todas las tablas + default privileges para futuras tablas).
5. **Flow dev local nuevo**: el operador levanta un IAP tunnel **persistente** vía LaunchAgent (`scripts/db/iap-tunnel.plist.template`) que mantiene `127.0.0.1:5432` siempre listening. El proxy del bastion refresca tokens automáticamente (el SA del bastion tiene metadata service local — refresh 100% transparente, sin expiry visible al cliente).
6. **MCP postgres** y cualquier tooling local (psql, DBeaver, drizzle-kit) conectan a `127.0.0.1:5432` con connection string fijo:
   ```
   postgresql://db-bastion-sa%40booster-ai-494222.iam:dummy@127.0.0.1:5432/booster_ai?sslmode=disable
   ```
   El `dummy` password se ignora — el proxy del bastion lo reemplaza por el access token del SA. `sslmode=disable` porque IAP TCP cifra el segmento laptop↔bastion y el proxy cifra bastion↔Cloud SQL; la conexión local TCP plana es solo dentro del túnel.

### Diagrama actualizado

```
┌─────────┐    IAP TCP tunnel    ┌─────────────────┐    cloud-sql-proxy
│ laptop  │◄────(persistent)────►│  bastion VM     │    --auto-iam-authn
│  Mac    │   localhost:5432     │  (private IP)   │◄─── (systemd, port 5432)
│         │                      │                 │       │
│ ┌─────┐ │                      │  IAM token de   │       │
│ │psql │─┼──── stable conn ─────┤  db-bastion-sa  │       ▼
│ │MCP  │ │                      │  (refresh auto) │   Cloud SQL
│ │drizz│ │                      │                 │   (private IP)
│ └─────┘ │                      └─────────────────┘
└─────────┘
```

## Alternativas consideradas y rechazadas

### A. Habilitar IP pública en Cloud SQL + IAM auth + ephemeral cert (sin authorized networks)

- **Cómo**: `ipv4_enabled = true`, sin lista de IPs (acceso solo via Cloud SQL Auth Proxy con IAM token + cert mTLS).
- **Por qué se rechazó**: aunque técnicamente seguro, contradice el commitment de "Cloud SQL nunca tiene IP pública" del ADR-013 ("Alternativas rechazadas — A. Public IP + Authorized Networks"). El team prefiere la consistencia conceptual: si en algún momento aparece un misconfig (ej. expose de Postgres por error), una instancia que **nunca** habilitó IP pública es más simple de auditar que una que la tuvo "restringida solo al proxy".

### B. Private Service Connect (PSC) en Cloud SQL + endpoint en VPC

- **Por qué se rechazó**: PSC resuelve acceso desde otra VPC, no desde laptop. Para que la laptop alcance el endpoint PSC interno, igual hace falta Cloud Interconnect/VPN/IAP TCP. Termina siendo el patrón de este ADR + complejidad extra de PSC.

### C. Mantener `--auto-iam-authn` en proxy local de la laptop (sin bastion)

- **Por qué se rechazó**: el `cloud-sql-proxy` v2 desde laptop necesita ruta IP al backend. Cloud SQL es private-only. Sin PSC ni IAP, no hay ruta. El proxy local fallaría con timeout al conectar al backend.

### D. Cloud Workstations

- **Por qué se rechazó (de nuevo)**: USD 50+/mes/usuario, overkill para team de 1-2. Decisión idéntica al ADR-013.

## Consecuencias

### Positivas

- **Connection string estable**: `127.0.0.1:5432` siempre listening (LaunchAgent), MCP postgres + DBeaver + drizzle-kit funcionan sin re-config cada hora.
- **Token refresh transparente**: el proxy del bastion corre en VM con metadata service — el access token de la SA se refresca automáticamente cada ~50 min sin intervención. Cliente no ve expiry.
- **Setup user-scope durable**: `claude mcp add postgres --scope user ...` queda persistente en `~/.claude.json` y funciona en cualquier proyecto que necesite la DB.
- **CI/CD y jobs no afectados**: Capas 2 (Cloud Run services) y 3 (Cloud Run Jobs) del ADR-013 siguen idénticas, con sus propios mecanismos de auth.

### Negativas

- **Pérdida de audit per-humano en `pg_audit`**: todas las queries via bastion quedan atribuidas a `db-bastion-sa@booster-ai-494222.iam`. No es posible distinguir cuál humano corrió cada query desde `pg_audit` solo.
- **Mitigación**: la atribución per-humano vive en **Cloud Audit Logs de IAP** (`logName="projects/booster-ai-494222/logs/cloudaudit.googleapis.com%2Fdata_access"` con `resource.type="iap_tunnel_dest_group"`). Para reconstruir "quién corrió esta query a las HH:MM:SS", se cruza:
  ```sql
  -- pg_audit: query timestamp + statement
  SELECT ts, statement FROM pg_audit_log WHERE ts BETWEEN '...';
  -- IAP audit log: humano que tenía túnel activo en ese rango
  -- (gcloud logging read filter por iap.tunnel + protoPayload.authenticationInfo.principalEmail)
  ```
  Runbook detallado: `docs/runbooks/audit-bastion-queries.md` (a crear si se requiere análisis forense real; queda fuera del scope de este ADR).
- **SPOF**: si el bastion se cae, ningún humano puede conectar (idéntico a ADR-013, no peor).
- **`scripts/db/connect.sh` AUTH_MODE=iam ya no aplica como estaba**: el script usaba IAM token del operador como password. Con el nuevo flujo, eso fallaría porque el proxy ya pone el token de la SA. Acción: deprecar el modo `iam` del script y dejar `password` como único modo legítimo (para emergencias / GRANTs de admin); el flujo principal pasa a ser `connect-local.sh` o conexión directa al túnel persistente.

### Riesgos abiertos

- **El operador puede ejecutar cualquier query con privilegios de la SA**. Mitigación: los GRANTs (`scripts/sql/2026-05-03-grant-bastion-sa.sql`) limitan a `SELECT/INSERT/UPDATE/DELETE` en `public`. Sin `DROP`, sin `TRUNCATE`, sin `CREATE`. DDL queda restringido a `booster_app` (password mode, uso explícito).
- **El bastion es bisagra**. Si su systemd se rompe, todo dev pierde acceso. Mitigación: alerta de monitoring sobre el health del proxy + runbook de re-provisión via Terraform.

## Implementación

| # | Cambio | Estado |
|---|--------|--------|
| 1 | `infrastructure/modules/iap-bastion/main.tf` — `--auto-iam-authn` en systemd unit | ✅ commiteado |
| 2 | `infrastructure/iam.tf` — `cloudsql.instanceUser` en `db_bastion_roles` | ✅ commiteado |
| 3 | `infrastructure/data.tf` — `google_sql_user.bastion_sa` (CLOUD_IAM_SERVICE_ACCOUNT) | ✅ commiteado |
| 4 | `scripts/sql/2026-05-03-grant-bastion-sa.sql` — GRANTs al rol SA | ✅ commiteado |
| 5 | `scripts/db/connect-local.sh` — wrapper de IAP tunnel + opcional psql | ✅ commiteado |
| 6 | `scripts/db/iap-tunnel.plist.template` — LaunchAgent template | ✅ commiteado |
| 7 | `terraform apply` + restart systemd del bastion | ⏳ Felipe en Mac |
| 8 | Aplicar `2026-05-03-grant-bastion-sa.sql` con `AUTH_MODE=password` | ⏳ Felipe en Mac |
| 9 | Cargar LaunchAgent + verificar túnel persistente | ⏳ Felipe en Mac |
| 10 | `claude mcp add postgres --scope user ...` | ⏳ Felipe en Mac |

## Referencias

- [ADR-013](./013-database-access-pattern.md) — patrón 3 capas (este ADR supersede sección Capa 1)
- `infrastructure/modules/iap-bastion/main.tf` — implementación del bastion
- `scripts/db/connect-local.sh` — wrapper para túnel + psql
- `scripts/db/iap-tunnel.plist.template` — LaunchAgent macOS
- `scripts/sql/2026-05-03-grant-bastion-sa.sql` — GRANTs post-apply
- Cloud SQL — [IAM database authentication](https://cloud.google.com/sql/docs/postgres/iam-authentication)
- Cloud SQL Auth Proxy — [`--auto-iam-authn` flag](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy#authentication-options)
