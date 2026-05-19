# ADR-052: Refactor de Terraform a multi-env (5 environments con state mv quirúrgico)

- **Fecha**: 2026-05-19
- **Status**: Accepted
- **Decisores**: Felipe Vicencio (PO)
- **Tags**: terraform, infrastructure, multi-env, refactor, migration, state-mv, p1, sprint-planning

---

## Relación con otros ADRs

- **Supersede campo "secuencia" de**: ADR-055 (PR #308). Inserta Fase 1.5 entre Mini-Sprint 0 y S1b. ADR-055 mantiene válida su justificación (Opción 2a-refinado vs alternativas rechazadas) y la composición conceptual de sus 3 fases; solo se modifica la secuencia agregando el refactor multi-env entre Fase 1 y Fase 2.
- **Cierra**: R-013 (alineación CLAUDE.md ↔ realidad Terraform) — la alineación ocurre vía refactor de realidad al diseño, no vía actualización de doc.
- **Amplía**: R-014 (purga binarios Terraform). Alcance ampliado tras diagnóstico — incluye `.terraform/providers/` además de `apply-plan.tfplan` y `terraform.tfvars.local`.
- **Coordina con**: ADR-050 (PR #305 — OTel base), ADR-053 (PR #306 — security headers).

---

## Contexto y problema

### Realidad observada (auditoría 2026-05-19)

`./infrastructure/` en el repo canónico contiene layout **flat single-project**:

- 22 archivos `.tf` al nivel raíz (project, data, outputs, messaging, compute, logging-exclusions, crash-traces, api-cost-guardrails, wave-3-tls, versions, scheduling, storage, org-policies, networking, telemetry-monitoring, cloudbuild, security, variables, monitoring, iam, backend, dr-region).
- 3 submódulos en `modules/`: `cloud-run-job`, `cloud-run-service`, `iap-bastion`.
- Sin `environments/{X,Y,Z}/`.
- Sin `main.tf` único.

**~120 recursos Terraform declarados** (panorámica via `grep ^resource`):

```
14 google_pubsub_topic
14 google_monitoring_alert_policy
12 google_dns_record_set
10 google_project_iam_member
 8 google_logging_metric
 6 google_storage_bucket
 6 google_service_account
 6 google_pubsub_subscription
 6 google_kms_crypto_key
 5 google_bigquery_dataset
 4 google_compute_global_address
 3 google_cloud_scheduler_job
 2 google_sql_user
 2 google_secret_manager_secret_version
 2 google_container_cluster
 ... (~30 tipos adicionales con conteo 2-4)
```

### Realidad declarada (CLAUDE.md líneas 74-90 y 131-136)

```
infrastructure/
├── main.tf                  ← NO EXISTE como archivo único
├── modules/
│   ├── gke-telemetry/       ← NO EXISTE
│   ├── cloud-run-service/   ← EXISTE
│   ├── pubsub-topic/        ← NO EXISTE
│   ├── firestore/           ← NO EXISTE
│   └── secret/              ← NO EXISTE
└── environments/{dev,staging,prod}/   ← NO EXISTE
```

### Drift caracterizado

- **Módulos**: declarados 5, reales 3. Coincide solo `cloud-run-service`. Cuatro módulos declarados son fantasma; dos reales (`cloud-run-job`, `iap-bastion`) no declarados.
- **Estructura**: declarada multi-env (`environments/{dev,staging,prod}/`), real flat single-project.
- **Riesgo del contrato del agente** (R-013): un agente Claude leyendo CLAUDE.md asume capacidades multi-env Terraform inexistentes; puede generar PRs con paths inválidos o instrucciones que asumen aislamiento de envs.
- **Binarios checked-in** (R-014 ampliado): `infrastructure/.terraform/providers/registry.terraform.io/hashicorp/google/6.50.0/...` + `google-beta/6.50.0/...` (binarios providers ~100MB cada uno) + `apply-plan.tfplan` + `terraform.tfvars.local`.

### Recursos persistentes con datos críticos (confirmados)

| Recurso | Identificación | Criticidad |
|---|---|---|
| `google_sql_database_instance.main` | `data.tf:109` | Data Booster AI completa |
| `google_sql_database.booster_ai` | `data.tf:211` | Schema productivo |
| `google_bigquery_dataset.telemetry` | `data.tf:364-368` (ADR-005) | Histórico Teltonika |
| `google_bigquery_dataset.*` adicionales | 4 más en `data.tf` | Analytics persistentes |
| `google_kms_crypto_key.*` | 6 keys | Acceso a data encriptada (irreversible si destruido) |
| `google_storage_bucket.*` | 6 buckets | Archivos persistentes |
| `google_secret_manager_secret_version.*` | 2 secrets | Credenciales activas |
| `google_container_cluster.telemetry` | GKE telemetry-tcp-gateway | Stack Teltonika productivo |
| `google_compute_global_address.*` | 4 IPs reservadas | DNS apunta a estas IPs |
| `google_pubsub_topic.telemetry_events` | `messaging.tf:22` | Pipeline Wave 2 (safety-p0, security-p1, eco-score, trip-transitions) |

---

## Decisión PO

**Opción B refinada**: refactor a multi-env real con **5 environments** (`dev`, `staging`, `prod`, `dr`, `sandbox`), migración via `terraform state mv` quirúrgico, ejecutado **pre-S1b** (entre Mini-Sprint 0 y S1b de ADR-055).

### Sub-decisiones consolidadas

| Sub-decisión | Valor |
|---|---|
| Número de envs | 5: dev, staging, prod, dr, sandbox |
| Estrategia migración | `terraform state mv` quirúrgico (sin destroy+recreate, sin downtime de recursos persistentes) |
| Sprint placement | Pre-S1b (Fase 1.5 nueva en ADR-055) |
| Backend state | GCS bucket único `booster-ai-tfstate` con prefix por env: `env/{dev,staging,prod,dr,sandbox}/` |
| State locking | GCS nativo (Terraform 1.0+) |
| Variables strategy | `terraform.tfvars` por env + módulos con `variables.tf` compartidos |
| Provisioning real | Solo `dev` se aplica automáticamente; `staging/prod/dr/sandbox` declarados pero gated por aprobación manual hasta sub-ADRs futuros |
| CI/CD gating | Manual approval para `apply` a `prod`, `dr`. Auto-apply en merge a `main` para `dev`. `staging/sandbox` config TBD en sub-ADR |

---

## Alternativas evaluadas (en ADR-052 propiamente)

Las 3 alternativas A/B/C (flat documentado / multi-env / workspaces) fueron evaluadas en la sesión de decisión 2026-05-19. PO eligió B. La justificación profesional del PO es coherente con regla operativa "Siempre desarrollo profesional, no MVP": eliminar drift estructural completo (no solo documental) sienta base para escalar sin deuda.

Sub-alternativas dentro de B también evaluadas:

| Sub-alternativa | Rechazada porque |
|---|---|
| B.2.b destroy+recreate | Pérdida catastrófica de data Teltonika, Cloud SQL, KMS keys |
| B.2.c paralelo con cutover | Calendar más largo sin beneficio claro vs state mv |
| B.3.b post-S1b | S1b se construiría sobre infra drifteada — refactor posterior obligaría a re-validar S1b |
| B.3.c sprint dedicado pre-Mini-Sprint 0 | Difiere OTel (R-001 P0) sin justificación |
| 3 envs sin `dr`/`sandbox` | `dr-region.tf` ya existe como código; `sandbox` solicitado por PO para iteración sin riesgo |

---

## Estructura objetivo

```
infrastructure/
├── environments/
│   ├── dev/
│   │   ├── backend.tf          # GCS prefix=env/dev/
│   │   ├── main.tf             # invoca modulos
│   │   ├── terraform.tfvars    # valores dev
│   │   └── versions.tf
│   ├── staging/
│   │   ├── backend.tf          # GCS prefix=env/staging/
│   │   ├── main.tf
│   │   ├── terraform.tfvars
│   │   └── versions.tf
│   ├── prod/
│   │   ├── backend.tf          # GCS prefix=env/prod/
│   │   ├── main.tf
│   │   ├── terraform.tfvars
│   │   └── versions.tf
│   ├── dr/
│   │   ├── backend.tf          # GCS prefix=env/dr/
│   │   ├── main.tf             # incluye dr-region.tf logic
│   │   ├── terraform.tfvars
│   │   └── versions.tf
│   └── sandbox/
│       ├── backend.tf          # GCS prefix=env/sandbox/
│       ├── main.tf
│       ├── terraform.tfvars
│       └── versions.tf
├── modules/
│   ├── cloud-sql/              # extraido de data.tf
│   ├── bigquery/               # extraido de data.tf
│   ├── pubsub-stack/           # extraido de messaging.tf
│   ├── kms/                    # extraido de security.tf
│   ├── gcs-bucket/             # extraido de storage.tf
│   ├── gke-telemetry/          # extraido de compute.tf
│   ├── cloud-run-service/      # ya existe
│   ├── cloud-run-job/          # ya existe
│   ├── iap-bastion/            # ya existe
│   ├── dns-zone/               # extraido (DNS record sets)
│   ├── secret-manager/         # extraido de security.tf
│   ├── monitoring/             # extraido (alert policies + uptime)
│   ├── logging/                # extraido (metrics + exclusions)
│   ├── networking/             # extraido (VPC + subnets + routers + NAT)
│   └── lb-https/               # extraido (URL maps + backend services)
└── shared/
    ├── project.tf              # google_project_service, project-wide config
    ├── org-policies.tf         # org-level policies
    └── README.md               # explica scope project-wide vs por-env
```

`shared/` contiene resources project-wide que NO son por-env (project APIs habilitadas, org policies, etc.). Estos se mantienen en un único state separado.

---

## Plan de implementación — 6 fases

### Fase A — Preparación y backup (~2-3 días)

1. **Backup state actual completo**:
   ```
   cd infrastructure
   terraform state pull > /tmp/state-pre-migration-$(date +%Y%m%d-%H%M%S).json
   gsutil cp /tmp/state-pre-migration-*.json gs://booster-ai-tfstate-backups/
   ```
2. **Backup recursos persistentes**:
   - Cloud SQL: snapshot manual del instance `main` (`gcloud sql backups create --instance=main`).
   - BigQuery: export del dataset `telemetry` a `gs://booster-ai-bq-exports/pre-migration-2026-05-XX/`.
   - Secret Manager: dump de versiones activas a `infrastructure/migration-snapshots/secrets-inventory.json` (solo nombres + metadata, NUNCA values).
   - KMS: documentar key rings + crypto keys (no se pueden exportar; solo audit trail).
3. **Mapeo recurso → destino**: script `scripts/terraform-migration/build-mapping.sh` produce CSV con `address_actual → address_destino` para los ~120 recursos.

### Fase B — Modularización (~4-5 días)

1. Crear estructura `infrastructure/modules/` completa según diseño.
2. Extraer recursos del flat actual a módulos:
   - `modules/cloud-sql/` ← `data.tf:109-300` (SQL instance + database + users)
   - `modules/bigquery/` ← `data.tf:364-500` aprox (5 datasets)
   - `modules/pubsub-stack/` ← `messaging.tf` completo (14 topics + 6 subs)
   - `modules/kms/` ← keys distribuidos en `security.tf` + `data.tf`
   - `modules/gcs-bucket/` ← `storage.tf`
   - `modules/gke-telemetry/` ← `compute.tf` (cluster GKE telemetry)
   - `modules/networking/` ← `networking.tf`
   - (resto)
3. Cada módulo expone `variables.tf` parametrizados (no hardcode).
4. Tests: `terraform validate` en cada módulo standalone.

### Fase C — Declaración de envs (~2-3 días)

1. Crear `infrastructure/environments/dev/`, `staging/`, `prod/`, `dr/`, `sandbox/`.
2. Cada `main.tf` invoca módulos con `terraform.tfvars` específicos.
3. `dev/terraform.tfvars`: valores actuales (los del flat, ya productivos para Booster AI greenfield).
4. `staging/prod/dr/sandbox/terraform.tfvars`: valores diferenciados (proyectos GCP separados, regiones distintas para dr, recursos mínimos para sandbox).
5. `backend.tf` por env apunta a GCS prefix `env/{nombre}/`.
6. Migrar `dr-region.tf` (actualmente en flat) → `environments/dr/main.tf` con su lógica específica.

### Fase D — Migration del state (~3-5 días) **— FASE MÁS CRÍTICA**

1. **Solo aplica a `dev`** (los demás envs no tienen state existente; serán declaración pura).
2. Cd a `environments/dev/`, `terraform init` con nuevo backend.
3. Por cada uno de los ~120 recursos, `terraform state mv` desde state antiguo a state nuevo:
   ```
   terraform state mv \
     -state=/tmp/state-pre-migration-*.json \
     'google_sql_database_instance.main' \
     'module.cloud_sql.google_sql_database_instance.main'
   ```
4. Script automatizado `scripts/terraform-migration/execute-state-mv.sh` consume el CSV de Fase A.
5. **Validation crítica**: `terraform plan` en `environments/dev/` debe mostrar `0 to add, 0 to change, 0 to destroy`. Si muestra cualquier diff, el state mv tiene error y se rollback.
6. Backup state nuevo: `terraform state pull > /tmp/state-post-migration-dev.json`.

### Fase E — Cleanup y R-014 ampliado (~1-2 días)

1. Verificar `terraform plan` en `dev` sigue mostrando 0 changes (idempotencia post-migration).
2. `git rm` recursos del flat antiguo:
   ```
   git rm infrastructure/*.tf
   git rm -r infrastructure/modules/cloud-run-job  # mover primero a modules/ del nuevo layout
   git rm -r infrastructure/modules/cloud-run-service
   git rm -r infrastructure/modules/iap-bastion
   ```
3. **R-014 ampliado**:
   ```
   git rm --cached infrastructure/apply-plan.tfplan
   git rm --cached infrastructure/terraform.tfvars.local
   git rm -r --cached infrastructure/.terraform/
   ```
4. Reforzar `.gitignore` en raíz del repo:
   ```
   # Terraform
   **/.terraform/
   **/*.tfstate
   **/*.tfstate.*
   **/*.tfplan
   **/*.tfvars.local
   **/crash.log
   **/override.tf
   **/override.tf.json
   ```
5. Subagent de seguridad inspecciona los archivos purgados antes del `git push` para clasificar si contenían secrets activos que requieren rotación.

### Fase F — CI/CD y validación final (~2-3 días)

1. Actualizar GitHub Actions workflows con paths nuevos:
   - `.github/workflows/terraform-dev.yml`: trigger en cambios a `infrastructure/environments/dev/**` o `infrastructure/modules/**`, auto-apply en merge a main.
   - `.github/workflows/terraform-staging.yml`: manual trigger, manual approval.
   - `.github/workflows/terraform-prod.yml`: manual trigger, manual approval doble.
   - `.github/workflows/terraform-dr.yml`: manual trigger, manual approval doble.
   - `.github/workflows/terraform-sandbox.yml`: manual trigger, sin approval (entorno descartable).
2. Smoke tests post-migration:
   - Gateway TCP responde (`telnet <ip> <puerto>`).
   - Cloud SQL queryable: `gcloud sql connect main`.
   - BigQuery `telemetry` dataset queryable: `bq query "SELECT count(*) FROM telemetry.events"`.
   - Pub/Sub: publish + consume en `telemetry-events`.
3. Actualizar **CLAUDE.md** §74-90 y §131-136 reflejando layout multi-env real (cierra R-013).
4. Crear runbook operations en `docs/runbooks/terraform-multi-env-operations.md`.

---

## Migración del state — catálogo de movimientos críticos

Lista no exhaustiva; el mapping completo se genera en Fase A.

| Address actual (flat) | Address destino (multi-env dev) | Tier |
|---|---|---|
| `google_sql_database_instance.main` | `module.cloud_sql.google_sql_database_instance.main` | 1 |
| `google_sql_database.booster_ai` | `module.cloud_sql.google_sql_database.booster_ai` | 1 |
| `google_bigquery_dataset.telemetry` | `module.bigquery.google_bigquery_dataset.telemetry` | 1 |
| `google_kms_crypto_key.*` (6x) | `module.kms.google_kms_crypto_key.*` | 1 |
| `google_storage_bucket.*` (6x) | `module.gcs_bucket["*"].google_storage_bucket.this` | 1 |
| `google_secret_manager_secret_version.*` (2x) | `module.secret_manager.google_secret_manager_secret_version.*` | 1 |
| `google_container_cluster.telemetry` | `module.gke_telemetry.google_container_cluster.this` | 2 |
| `google_compute_global_address.*` (4x) | `module.lb_https.google_compute_global_address.*` | 2 |
| `google_dns_record_set.*` (12x) | `module.dns_zone.google_dns_record_set.*` | 2 |
| `google_pubsub_topic.*` (14x) | `module.pubsub_stack.google_pubsub_topic.*` | 3 |
| `google_pubsub_subscription.*` (6x) | `module.pubsub_stack.google_pubsub_subscription.*` | 3 |
| Monitoring, logging, IAM bindings | `module.monitoring.*`, `module.logging.*` | 4 |

**Tier 1**: pérdida catastrófica si state mv falla y se decide recreate.
**Tier 2**: disruption operativa significativa si state mv falla.
**Tier 3**: recreables con downtime breve, pero state mv preferible para no perder mensajes en flight.
**Tier 4**: config-only, recreables sin impacto.

---

## ADRs futuros condicionados

Los siguientes ADRs se programan como follow-ups específicos, no se resuelven en ADR-052:

| ADR futuro | Trigger | Scope |
|---|---|---|
| ADR-056 | Decisión de provisionar `staging` real | Cuándo, qué proyecto GCP, qué subset de recursos, gating |
| ADR-057 | Aproximación a TRL-10 | Provisioning de `prod`: cutover desde `dev`, plan blue-green, runbook |
| ADR-058 | Necesidad operativa de DR | Estrategia detallada: RTO, RPO, failover procedures, frecuencia de drills |
| ADR-059 | Política sandbox | Efímero por developer / compartido / auto-destroy, costos, IAM |

---

## Calendario

Total estimado **14-21 días hábiles** (~3 semanas calendar). Encaja en Fase 1.5 de ADR-055 modificado.

| Fase | Días hábiles | Descripción |
|---|---|---|
| A | 2-3 | Preparación, backups, mapeo |
| B | 4-5 | Modularización (15 módulos) |
| C | 2-3 | Declaración 5 envs |
| D | 3-5 | Migration state via `state mv` |
| E | 1-2 | Cleanup + R-014 ampliado |
| F | 2-3 | CI/CD + validación + doc |

### Calendar consolidado (ADR-055 + ADR-052)

```
Mini-Sprint 0 (~1 sem)         → R-001 P0 OTel + 5 quick wins
  ↓
Fase 1.5 Refactor TF (~3 sem)  → 6 fases A-F segun ADR-052     [NUEVA]
  ↓
S1b ajustado (~2 sem)          → spec.md sobre infra multi-env correcta
  ↓
Mini-Sprint residual (~3-5 d)  → R-003, R-007/R-008 si no absorbidos
```

**Calendar total**: ~40-47 días (~6-7 semanas), extendido desde ~26 días del ADR-055 original.

---

## Riesgos identificados + mitigations

| Riesgo | Severidad | Mitigation |
|---|---|---|
| `terraform state mv` falla parcialmente | Alto | Backup state pre-migration (Fase A.1); rollback documented; ejecutar en batches por tier |
| Provider version drift durante refactor | Medio | Pin `versions.tf` antes de comenzar; no actualizar provider hasta post-Fase F |
| KMS key destruction accidental | Catastrófico | `lifecycle { prevent_destroy = true }` explícito en módulo `kms/` antes de migration |
| Cloud SQL replica/snapshot desincronizada post-migration | Alto | Snapshot pre-migration (Fase A.2) + validation query post-Fase D |
| DNS propagation issues | Medio | No tocar `google_dns_record_set` hasta validación de IP estable; TTL bajo (300s) durante ventana de migration |
| Secret rotation requerida si binarios contenían secrets | Alto | Subagent inspecciona en Fase E.5; rotation gated por hallazgo |
| Workflows GitHub Actions rotos durante transición | Medio | Workflows nuevos en paralelo; cutover via merge atómico |
| `staging`/`prod`/`dr`/`sandbox` mal configurados al primer apply | Bajo (no se aplican aún) | Gating manual approval; primer apply real es ADR futuro |

---

## Cierres explícitos

- **R-013** queda CERRADO al completar Fase F.3 (CLAUDE.md actualizado al layout multi-env real). El drift desaparece porque la realidad cambió al diseño documentado nuevo.
- **R-014** queda CERRADO al completar Fase E.3-E.4 (purga binarios ampliada + `.gitignore` reforzado).
- **ADR-055 secuencia** queda SUPERSEDED por la inserción de Fase 1.5. Demás campos de ADR-055 (justificación de Opción 2a-refinado, fases conceptuales, absorción oportunista) se preservan.

---

## Refs

- `infrastructure/` (estructura flat actual, 22 `.tf` + 3 módulos)
- `audit-outputs/06_REFACTOR_PRIORITIES.md` (R-013, R-014, cross-cutting Terraform)
- `audit-outputs/03_SECURITY_FINDINGS.md` (binarios checked-in, security.tf)
- `audit-outputs/01_ARCHITECTURE.md` §H-ARCH-02, §H-ARCH-06, §5, §6.3
- CLAUDE.md §74-90, §131-136 (declaración drifteada)
- ADR-005 — Telemetría Teltonika
- ADR-049 (PR #307) — react-pdf-renderer
- ADR-050 (PR #305) — OTel observabilidad
- ADR-053 (PR #306) — security headers
- ADR-054 (PR #303) — Arquitecto Maestro
- ADR-055 (PR #308) — colisión Sprint 1 vs S1b (secuencia ahora superseded)

---

## Apéndice — comandos de validación post-implementación

```
# 1. Idempotencia dev (debe mostrar 0 changes)
cd infrastructure/environments/dev
terraform init
terraform plan

# 2. Resto de envs (debe mostrar declaracion completa)
for env in staging prod dr sandbox; do
  cd infrastructure/environments/$env
  terraform init
  terraform plan -out=/tmp/plan-$env.tfplan
done

# 3. Smoke test Cloud SQL dev
gcloud sql connect main --user=booster_ai --quiet --project=$DEV_PROJECT_ID

# 4. Smoke test BigQuery telemetry
bq query --use_legacy_sql=false --project_id=$DEV_PROJECT_ID \
  'SELECT COUNT(*) FROM telemetry.events WHERE _PARTITIONDATE = CURRENT_DATE()'

# 5. Validar binarios purgados
git ls-files infrastructure/ | grep -E '\.(tfstate|tfplan|tfvars\.local)$|\.terraform/'
# Output esperado: vacio

# 6. Validar .gitignore aplicado
git check-ignore infrastructure/.terraform/test-file
git check-ignore infrastructure/apply-plan.tfplan
# Output esperado: ambos retornan exit code 0 (ignored)
```
