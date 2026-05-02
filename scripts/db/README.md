# Acceso a Cloud SQL (Booster AI)

Setup definitivo de acceso a la DB de producción para operadores humanos.

## Filosofía

- **Cloud Run services** se conectan a Cloud SQL vía VPC privada usando el user
  `booster_app` con password de Secret Manager (`DATABASE_URL`). Eso no cambia.
- **Operadores humanos** (devs, db admins) se conectan via Cloud SQL Auth Proxy
  + IAM authentication. Sin passwords manuales, todo via OAuth tokens del
  Google account.

## Quick start

```bash
# Una vez por sesión de shell (si no tenés gcloud auth):
gcloud auth login dev@boosterchile.com

# Conectar a la DB e ir a psql interactivo:
bash scripts/db/connect.sh

# Ejecutar un archivo SQL:
bash scripts/db/connect.sh -f scripts/sql/2026-05-02-merge-fvicencio-users.sql
```

## Cómo funciona

1. Detecta si `cloud-sql-proxy` y `psql` están instalados, sino los instala
   con `brew`.
2. Verifica `gcloud auth` activo.
3. Detecta si la instancia tiene IAM auth habilitada (`database_flags.cloudsql.iam_authentication`).
   - **Sí (post `terraform apply` con el nuevo flag):** lanza el proxy con
     `--auto-iam-authn`, conecta como tu user IAM (`dev@boosterchile.com`)
     sin password.
   - **No (legacy):** lee `DATABASE_URL` de Secret Manager, parsea
     user/password de `booster_app`, conecta con eso.
4. Lanza el proxy en background al puerto local 5433.
5. Abre `psql` (o ejecuta el `.sql` que pasaste con `-f`).
6. Cleanup del proxy al exit (incluye Ctrl+C).

## Configuración

Override con env vars:

```bash
LOCAL_PORT=5434 bash scripts/db/connect.sh   # otro puerto
DB_NAME=postgres bash scripts/db/connect.sh  # otra DB
AUTH_MODE=password bash scripts/db/connect.sh # forzar password mode
```

## Agregar más operadores

Editar `infrastructure/data.tf`:

```hcl
locals {
  db_iam_operators = [
    "dev@boosterchile.com",
    "nuevo-operador@boosterchile.com",
  ]
}
```

Después `terraform apply`. Eso crea:
- `google_sql_user` tipo `CLOUD_IAM_USER` para el email
- Bindings IAM `roles/cloudsql.client` + `roles/cloudsql.instanceUser`

El nuevo operador clona el repo, corre `gcloud auth login`, listo.

## Permisos del IAM user dentro de Postgres

Por default el `CLOUD_IAM_USER` solo tiene `CONNECT` a la DB. Para hacer
queries necesitás GRANT explícito una vez:

```sql
GRANT CONNECT ON DATABASE booster_ai TO "dev@boosterchile.com";
GRANT USAGE ON SCHEMA public TO "dev@boosterchile.com";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "dev@boosterchile.com";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "dev@boosterchile.com";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "dev@boosterchile.com";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "dev@boosterchile.com";
```

Esto se corre **una sola vez** desde un user con permisos de admin (postgres
o booster_app) tras crear el IAM user.

## Troubleshooting

- **"could not connect to server: Connection refused"** — el proxy no se
  levantó. Ver el log que imprime el script y verificar IAM permissions.
- **"FATAL: Cloud SQL IAM user authentication failed"** — el user IAM no
  tiene los roles. `terraform apply` para crear los bindings.
- **"role 'dev@boosterchile.com' is not permitted to log in"** — el user
  IAM no fue creado. `terraform apply` (resource `google_sql_user.iam_operators`).
- **El usuario IAM puede conectar pero no SELECT** — falta el GRANT (ver
  arriba).
