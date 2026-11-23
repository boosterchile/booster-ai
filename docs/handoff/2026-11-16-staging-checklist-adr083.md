# Checklist en seco — staging gemelo (ADR-083)

**Fecha**: 2026-11-16  
**Alcance**: solo documentación / checklist. **No** create project, **no** billing, **no** `terraform apply`, **no** secretos, **no** flips de `RUTAS_API_ACTIVADA` ni matching `activa`.  
**Referencias**: [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md), [runbook staging](../runbooks/staging.md), [tfvars example](../../infrastructure/environments/staging/terraform.tfvars.example), [CURRENT](CURRENT.md).

## Veredicto (lectura del repo, 2026-11-16)

El código de soporte de staging **ya está en `main`**. El proyecto GCP gemelo **aún no existe**. `Deploy staging` en cada push a `main` termina **skipped** porque `STAGING_PROJECT_ID` no está definida. El Environment de GitHub `staging` **no aparece** (solo existe `production`). El nightly E2E sigue pegando a prod (deuda declarada en CLAUDE.md).

| Quién | Qué |
|---|---|
| **Ya en el repo** | Root module Terraform compartido · `environments/staging/{backend.hcl,terraform.tfvars.example}` · `release-staging.yml` · `e2e-staging.yml` (PR skip sin `STAGING_URL`) · runbook · drill microservicios · delegación DNS `staging_nameservers` en prod |
| **Solo el PO** | Crear proyecto · billing · `terraform apply` staging · secretos · Firebase/Maps/reCAPTCHA del proyecto nuevo · Environment/vars de GitHub · NS en prod · presupuesto |

---

## 1. Ya listo (agente / repo) — no requiere visto PO para existir

- [x] ADR-083 vigente; supersede parcial de ADR-048 / cierra preguntas de ADR-055 para staging.
- [x] `infrastructure/environments/staging/backend.hcl` → bucket propio `booster-ai-tfstate-stg-494222` (desde el 2026-11-23; antes compartía el de prod), prefix `terraform/staging`.
- [x] `infrastructure/environments/staging/terraform.tfvars.example` → ID propuesto `booster-ai-stg-494222`, sizing mínimo, `monthly_budget_usd = 250`.
- [x] Variable `staging_nameservers` + recurso `google_dns_record_set.staging_delegation` (count = 0 mientras lista vacía).
- [x] `.github/workflows/release-staging.yml` — push a `main` + `workflow_dispatch`; `if: vars.STAGING_PROJECT_ID != ''`.
- [x] `.github/workflows/e2e-staging.yml` — en PR se salta sin `STAGING_URL`; nightly sin staging → `PRODUCTION_URL`.
- [x] `docs/runbooks/staging.md` + `docs/runbooks/rollback-drill-microservicios.md` (document-service).
- [x] Evidencia 2026-11-16: último run Deploy staging en `main` @ `a2fd4396` → **skipped** ([run 43782922183](https://github.com/boosterchile/booster-ai/actions/runs/43782922183)).

---

## 2. Requiere visto / acción del PO (ADR-076 + CLAUDE.md)

Orden sugerido. Nada de esto lo ejecuta el agente en este frente.

### 2.1 Previos (lista ADR-076)

- [ ] `apply` de **prod** que crea el bucket de state de staging `booster-ai-tfstate-stg-494222` (agregado el 2026-11-23; el plan debe mostrar solo esa alta).
- [ ] Cuenta con `resourcemanager.projectCreator` + `billing.user`.
- [ ] Confirmar disponibilidad del ID `booster-ai-stg-494222` (si no, elegir otro y actualizar tfvars + vars GitHub).
- [ ] Copiar example → `infrastructure/environments/staging/terraform.tfvars` (gitignored) y completar `billing_account`.
- [ ] Aceptar presupuesto ~USD 150–250/mes (`monthly_budget_usd = 250`).
- [ ] Guardar salida del `plan` en `docs/runbooks/staging-plan-YYYY-MM-DD.txt` **antes** del apply.

### 2.2 Create project + apply (irreversible / billing)

- [ ] `terraform init -reconfigure -backend-config=environments/staging/backend.hcl`
- [ ] `terraform plan -var-file=environments/staging/terraform.tfvars -out=staging.plan`  
  Criterio en seco: **solo creates**; **cero** recursos con `project=booster-ai-494222`.
- [ ] Preflight de placeholders (`docs/runbooks/terraform-apply.md`) sobre el plan.
- [ ] `terraform apply staging.plan` — **solo PO**.
- [ ] Volver el backend local a prod: `terraform init -reconfigure` (sin `-backend-config`).

### 2.3 Secretos + Firebase (solo PO / consola)

- [ ] Secret Manager en el proyecto de staging ([secret-init-runbook.md](../runbooks/secret-init-runbook.md) con `--project=booster-ai-stg-494222`).
- [ ] Twilio / Resend de **prueba**, nunca prod.
- [ ] Firebase + App Check (reCAPTCHA) + Maps key restringida a `app.staging.boosterchile.com`.

### 2.4 DNS desde prod

- [ ] Leer `dns_zone_name_servers` del state de staging.
- [ ] En tfvars de **prod**: `staging_nameservers = [...]` → plan/apply prod (un solo NS). Lista de verificación de `terraform-apply.md`.

### 2.5 GitHub

- [ ] Crear Environment `staging` (hoy solo existe `production`).
- [ ] Repo vars: `STAGING_PROJECT_ID`, `STAGING_API_URL` (API) y `STAGING_URL` (PWA). Corregido el 2026-11-23; ver §3.
- [ ] Env vars: WIF deploy + Vite Firebase/Maps/reCAPTCHA (outputs del apply).

### 2.6 Post-apply

- [ ] `curl -fsS https://api.staging.boosterchile.com/health` → 200.
- [ ] Un push a `main` deja de skipear Deploy staging y termina verde.
- [ ] Nightly E2E apunta a staging.
- [ ] Bootstrap gateway GKE si se necesita telemetría en staging ([staging.md](../runbooks/staging.md) §7).
- [ ] Job de drift de staging en `terraform-drift.yml` (pendiente explícito en el runbook hasta que exista el entorno).

---

## 3. Gaps del runbook / docs (marcar; no bloquean el checklist)

| Gap | Estado | Notas |
|---|---|---|
| Proyecto / billing / apply | **Abierto · PO** | Staging gemelo no existe. |
| GitHub Environment `staging` | **Abierto · PO** | API de environments solo lista `production`. El runbook habla de vars pero no dice «crear el Environment». |
| `STAGING_URL` ambigua | **Resuelto el 2026-11-23**: `release-staging.yml` usa `STAGING_API_URL` y `STAGING_URL` queda para la PWA. Diagnóstico original: | `release-staging.yml` usa `STAGING_URL` como host del **API** (`/health`, `_VITE_API_URL`). `e2e-staging.yml` la usa como Playwright `BASE_URL` (PWA). `docs/ci-cd.md` sugiere `https://staging.boosterchile.com`; prod E2E usa `https://app.boosterchile.com`. Hay que fijar convención (p. ej. API = `https://api.staging.boosterchile.com` y var aparte para la PWA, o documentar un solo host). **No se cambia el workflow en este PR.** |
| tfvars example incompleto vs flags de prod | **Mitigado en este PR** | Defaults de Terraform cubren la mayoría; el example ahora declara explícitamente qué dejar en default y qué no tocar sin visto PO. |
| `terraform-drift` solo prod | **Abierto · post-existencia** | ADR-083 / runbook: agregar job staging cuando el entorno exista. |
| Nightly E2E → prod | **Deuda declarada** | Hasta `STAGING_URL`. |
| Seeds / PII | **Regla ADR-083** | Staging no copia prod; solo seeds + E2E. |
| Drill notification/matching | **Pendiente extracción** | Runbook de drill solo tiene document-service. |

---

## 4. Corrida en seco del plan (plantilla para el PO)

No se ejecuta aquí (faltan `billing_account` real y permisos de create project). Cuando el PO copie el tfvars:

```bash
# 1) Backend staging
terraform -chdir=infrastructure init -reconfigure \
  -backend-config=environments/staging/backend.hcl

# 2) Plan (revisar: solo create; project_id = booster-ai-stg-494222)
terraform -chdir=infrastructure plan \
  -var-file=environments/staging/terraform.tfvars \
  -out=staging.plan

# 3) Guardar evidencia textual
terraform -chdir=infrastructure show -no-color staging.plan \
  > docs/runbooks/staging-plan-$(date -u +%F).txt

# 4) Preflight placeholders (mismo gate que prod)
terraform -chdir=infrastructure show -json staging.plan > /tmp/staging.plan.json
node scripts/repo-checks/check-validated-secret-placeholders.mjs /tmp/staging.plan.json

# 5) Apply — SOLO con visto PO y lista ADR-076
# terraform -chdir=infrastructure apply staging.plan

# 6) Volver backend a prod antes de cualquier comando de prod
terraform -chdir=infrastructure init -reconfigure
```

**Criterios de aceptación del plan en seco**

1. `Plan:` solo `to add`; `to change` / `to destroy` = 0 en el primer apply.
2. Ninguna línea de recurso referencia `booster-ai-494222` como proyecto destino.
3. `environment = "staging"`, `domain = "staging.boosterchile.com"`.
4. Cloud SQL zonal `db-custom-1-3840`; Redis BASIC 1 GB; Cloud Run `min_instances` según defaults del módulo (API/web en 0).
5. Preflight de placeholders exit 0 **o** plan sin montar secrets validados hasta cargar valores reales (disciplina `terraform-apply.md`).

---

## 5. Fuera de alcance de este paquete

- Flips `RUTAS_API_ACTIVADA` / matching `sombra` → `activa`.
- Cualquier `terraform apply` (staging o prod).
- Create GCP project, billing link, secretos, IAM nuevo.
- Cambios a quality gates / workflows (salvo documentación de gaps).
- Extracción o shadow de microservicios en prod.

## 6. Qué mirar el PO

1. Este checklist (§2) como orden de trabajo cuando quiera habilitar staging.
2. Las dos URL de §2.5 al cablear GitHub (el gap de `STAGING_URL` se resolvió el 2026-11-23).
3. Confirmar ID de proyecto y `billing_account` en el tfvars (example en repo).
4. Seguir con flags de prod solo cuando decida; staging no desbloquea esos flips por sí solo.
