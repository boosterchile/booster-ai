# ADR-013 — Patrón de acceso a base de datos en 3 capas

- **Estado**: Accepted
- **Fecha**: 2026-05-02
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

Booster AI usa Cloud SQL Postgres con `ipv4_enabled = false` (solo IP privada,
ver `infrastructure/data.tf:100`) — una decisión deliberada para reducir
superficie de ataque. Las tres clases de consumidores que necesitan acceso a
la DB tienen perfiles muy distintos:

1. **Cloud Run services productivos** (`apps/api`, `apps/whatsapp-bot`,
   `apps/telemetry-processor`, ...): tráfico continuo, baja latencia, autenticación
   automática, escalado horizontal. Hoy se conectan vía VPC connector +
   `DATABASE_URL` con password de `booster_app` (Secret Manager).

2. **Operadores humanos** (devs, DBA, data scientists): acceso ad-hoc para
   debug, queries de exploración, hotfixes manuales. Hoy bloqueados —
   `scripts/db/connect.sh` falla porque la laptop no tiene ruta IP a la VPC
   privada de Cloud SQL.

3. **Jobs one-off** (data fixes, backfills, migrations, merges): operaciones
   programáticas no recurrentes que requieren acceso transaccional con auditabilidad
   de quién/cuándo/qué. Hoy no existen como categoría — el primer caso real fue
   `merge-duplicate-users` (commit 7b07df4) y se creó el job vía `gcloud run jobs`
   manualmente, violando "no infra manual" de `CLAUDE.md`.

El incidente disparador fue intentar mergear 2 users de Firebase Auth duplicados.
La cadena de fallos reveló múltiples problemas: ADC reauth expirado, instancia
sin IP pública, falta de bastion, falta de patrón Cloud Run Job. Ninguna era
sorpresa individualmente — la suma demostró que el acceso a DB no estaba
modelado como sistema.

## Decisión

Adoptamos un patrón de **3 capas explícitas**, cada una con su propio mecanismo
de autenticación, red, y auditabilidad. Cada nuevo consumidor de la DB
**debe declarar** a qué capa pertenece — no hay acceso "ad hoc fuera del modelo".

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Capa 1 — Operadores humanos                                            │
│  Bastion VM (e2-micro, sin IP pública) + IAP TCP forwarding +           │
│  cloud-sql-proxy + IAM database authentication                          │
│  Audit: Cloud Audit Logs (IAP) + pg_audit (Postgres)                    │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│  Capa 2 — Cloud Run services                                            │
│  VPC connector → IP privada Cloud SQL                                   │
│  Auth: hoy `booster_app` + password en Secret Manager                   │
│        futuro: SA + IAM database auth (Phase 2 de este ADR)             │
│  Audit: pg_audit + structured logs por servicio                         │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│  Capa 3 — Cloud Run Jobs (one-off ops)                                  │
│  VPC connector → IP privada Cloud SQL                                   │
│  Auth: misma SA que Cloud Run services (`booster-cloudrun-sa`)          │
│  Audit: Cloud Run Job execution logs + git history del código del job   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Capa 1 — Acceso humano (a implementar)

- **Bastion VM** (`e2-micro`, ~USD 5/mes) en `booster-ai-vpc`, sin IP pública,
  imagen `debian-12`. Ver módulo `infrastructure/modules/iap-bastion/`.
- **IAP TCP forwarding** habilitado para el rol `roles/iap.tunnelResourceAccessor`
  asignado a la lista `local.db_iam_operators` (ya existe en `data.tf:181`).
- **cloud-sql-proxy** se ejecuta en la laptop con `--auto-iam-authn`, pero el
  socket que dial-ea apunta al puerto local del túnel IAP — el túnel forwardea
  hasta el bastion y desde ahí a la IP privada de Cloud SQL.
- **IAM database auth** (`cloudsql.iam_authentication = on`, ya aplicado en
  commit posterior al `7b07df4`): cada operador conecta como su email
  (`dev@boosterchile.com`) sin password. Los grants se asignan vía SQL una vez
  el role IAM existe.

Flow desde laptop:

```
$ bash scripts/db/connect.sh
↓
gcloud compute start-iap-tunnel bastion 5432 --local-host-port=127.0.0.1:5433
↓
cloud-sql-proxy <conn> --auto-iam-authn --port 5434
  (corre en bastion, pero el `--port` local apunta al túnel IAP)
↓
psql "host=127.0.0.1 port=5434 user=$(gcloud config get account) dbname=booster_ai sslmode=disable"
```

### Capa 2 — Cloud Run services (estado actual + Phase 2)

Hoy: `DATABASE_URL = postgresql://booster_app:<password>@<private_ip>/booster_ai?...`
inyectado vía Secret Manager. Funciona y se mantiene. **No requiere cambios
para shipping del producto**.

Phase 2 (post-MVP, cuando team >2 personas o regulación lo exija): migrar
`booster_app` password-auth a IAM database auth con el SA de Cloud Run
(`booster-cloudrun-sa`). Beneficios: rotación de credenciales automática vía
OAuth tokens, sin secrets de password en Secret Manager. Ver sección
"Plan de migración Capa 2" abajo.

### Capa 3 — Cloud Run Jobs (a estructurar)

- **Módulo Terraform** `infrastructure/modules/cloud-run-job/` (creado en este
  ADR). Espejo del `cloud-run-service` con: timeout largo, sin scaling, sin
  port, sin probes, max-retries configurable.
- **Convención de código**: `apps/<app>/src/jobs/<job-name>.ts`. Cada job es
  un entrypoint independiente que comparte runtime/Dockerfile con su app
  contenedora. tsup builds el job como entry adicional.
- **Convención de invocación**: `gcloud run jobs execute <name>` para one-off,
  o `cron` Scheduler para periódicos (ver ADR futuro de jobs periódicos).
- **Audit trail**: el código del job en git + Cloud Run Job execution logs
  (Cloud Logging structured JSON). Cada ejecución queda con `execution_name`
  único + duración + exit code + logs estructurados de la lógica.

Patrón establecido en commit `7b07df4` con `merge-duplicate-users`. Otros casos
previstos: `backfill-trip-metrics`, `recalculate-emissions`, `cleanup-orphaned-X`.

## Alternativas consideradas y rechazadas

### A. Public IP + Authorized Networks (acceso humano)

- **Cómo**: `ipv4_enabled = true` + lista de IPs autorizadas (ej. IP de oficina
  + IPs de operadores).
- **Por qué se rechazó**: superficie de ataque pública incluso con SSL
  forzado. Lista de IPs estática vs ISPs con DHCP residenciales. No escala a
  remote work distribuido. Confiar el perímetro a "es solo mi IP" es cargo cult
  security.

### B. VPN — Cloud VPN o Tailscale

- **Cómo (Cloud VPN)**: gateway VPN + cliente OpenVPN/IPsec en cada laptop.
- **Cómo (Tailscale)**: agente Tailscale en bastion + en cada laptop, mesh
  WireGuard.
- **Por qué se rechazó**: Cloud VPN tiene costo fijo elevado (~USD 60/mes
  + tráfico) para un equipo que arranca en 1-3 personas. Tailscale agrega
  un 3rd party crítico en el path de prod (su SaaS gestiona keys y discovery).
  Para Booster AI, que tiene compliance sostenibilidad como diferenciador, no
  agregamos vendor en el path crítico sin necesidad. Bastion + IAP es 100%
  Google y queda dentro del audit log nativo.

### C. Cloud Workstations

- **Cómo**: dev environment en la nube con browser-based IDE, full VPC access.
- **Por qué se rechazó (por ahora)**: USD 50+/mes/usuario. Overkill para un
  equipo de 1 persona. Re-evaluar cuando team ≥ 5. Sería el upgrade natural
  desde el bastion cuando crezca el uso.

### D. Cloud SQL Studio (UI Console)

- **Cómo**: GUI nativa en Cloud Console para ejecutar queries.
- **Por qué se aceptó como complemento, no como reemplazo**: válido para
  debug puntual de operadores con permisos. NO sirve para Capa 3 (jobs
  programáticos) ni para acceso de aplicaciones. Queda como herramienta de
  emergencia, no como pattern.

### E. Bastion con SSH público + key auth

- **Cómo**: VM con IP pública + `sshd`, claves SSH gestionadas vía OS Login.
- **Por qué se rechazó**: misma superficie pública que (A). IAP TCP forwarding
  ofrece el mismo workflow conceptual sin exponer puerto 22 al internet, con
  audit log nativo.

## Consecuencias

### Positivas

- **Auditabilidad por capa**: cada query queda atribuible a un humano
  (Capa 1, IAM email), un servicio (Capa 2, SA email), o un job versionado
  (Capa 3, git SHA + execution_name).
- **Sin secretos humanos en Secret Manager**: los operadores no manejan
  password de `booster_app` — ese password queda solo para Cloud Run en
  Phase 1 y se elimina en Phase 2.
- **Costo predecible y bajo**: ~USD 5/mes (bastion e2-micro) + USD 0
  (IAP, Cloud Run Jobs solo se cobran al ejecutar).
- **Reversible y escalable**: el día que el team crezca a >5, migrar Capa 1
  a Cloud Workstations cambia el módulo `iap-bastion` por
  `cloud-workstations` sin tocar Capas 2 y 3.

### Negativas

- **Latencia extra en Capa 1**: el túnel IAP suma ~50-100ms por roundtrip
  vs conexión directa. Aceptable para queries interactivas, no apto para
  benchmarks o load tests humanos (que tampoco corresponden desde laptop).
- **Bastion como SPOF de Capa 1**: si la VM se cae, ningún humano puede
  conectar a la DB. Mitigación: el bastion es stateless (sin disk persistente
  relevante), recrearlo es un `terraform apply` de 2-3 min. Para casos críticos
  donde se requiere acceso humano urgente con bastion caído, queda Cloud SQL
  Studio (UI Console) como fallback de emergencia.
- **Phase 2 (Capa 2 IAM auth) es trabajo no trivial**: requiere migrar el
  driver `pg` a usar tokens OAuth refrescables en lugar de password
  estática. La librería `cloud-sql-connector` para Node hace esto, pero
  cambia el pool init en cada service. Postergado hasta MVP shippeado.

### Riesgos abiertos

- **IAM token expiry vs long-running queries**: los OAuth tokens expiran a
  los 60min. Si una query/transacción humana dura más, la conexión se cae.
  Mitigación: para ops que requieran >60min, usar Capa 3 (Cloud Run Job con
  SA token refrescable automáticamente).
- **Drift de la lista `db_iam_operators`**: se mantiene manualmente en
  `data.tf`. Si alguien deja el equipo, hay que removerlo. Mitigación
  futura: integrar con Workspace groups vía `google_workspace_group`.

## Plan de migración Capa 2 (Phase 2)

**No bloquea este ADR**. Documentado para que cuando se decida ejecutar,
exista el procedimiento.

1. Crear IAM user para `booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com`
   (en `data.tf` análogo a `iam_operators` pero para SA). Asignar
   `roles/cloudsql.client` y `roles/cloudsql.instanceUser` al SA.
2. En código de los services: instalar `@google-cloud/cloud-sql-connector`,
   reemplazar `new pg.Pool({ connectionString })` con el connector que toma
   el `instance_connection_name` y el SA email, y maneja el refresh de tokens.
3. Deploy gradual: feature flag `USE_IAM_AUTH=true` → testear en `dev` →
   rollout a prod por servicio.
4. Una vez todos los services migrados: eliminar `google_sql_user.app`
   (`booster_app`) y la `random_password.pg_app_password` de TF. Eliminar
   el secret `database-url`.
5. Update `DATABASE_URL` de los services para usar `cloud-sql-connector://`
   o un esquema custom que el código resuelva.

Esfuerzo estimado: 1-2 días de un dev. Beneficio principal: cero rotación
manual de password, audit log mejor (token = SA email vs password = anónimo).

## Implementación de este ADR (estado actual)

- ✅ **Capa 3 — patrón Cloud Run Jobs**: módulo `cloud-run-job` creado.
  Primer caso (`merge-duplicate-users`) commiteado en `7b07df4`.
- ✅ **Capa 1 — flag IAM auth aplicado** en Cloud SQL (`cloudsql.iam_authentication = on`).
  Operador `dev@boosterchile.com` registrado como `CLOUD_IAM_USER`.
- ⏳ **Capa 1 — bastion + IAP**: módulo `iap-bastion` escrito pero **no
  instanciado** (requiere OK explícito porque crea infra billable).
- ⏳ **Capa 1 — `connect.sh` actualizado** para usar IAP tunnel: pendiente
  de instanciar el bastion.
- 📅 **Capa 2 — migración a IAM auth**: planificado, no ejecutado.

## Referencias

- ADR-001 — Stack selection (decisión original Cloud SQL Postgres)
- `infrastructure/data.tf:100-119` — config Cloud SQL con flags IAM
- `infrastructure/modules/cloud-run-job/` — módulo Capa 3
- `infrastructure/modules/iap-bastion/` — módulo Capa 1 (no instanciado)
- `apps/api/src/jobs/merge-duplicate-users.ts` — primer caso Capa 3
- Google Cloud — [Connecting using IAP TCP forwarding](https://cloud.google.com/iap/docs/using-tcp-forwarding)
- Google Cloud — [Cloud SQL IAM database authentication](https://cloud.google.com/sql/docs/postgres/iam-authentication)
