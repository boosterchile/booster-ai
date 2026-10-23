# Spec: presupuesto-clp

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-23
- Status: **Pedida por el PO el 2026-10-23** en el chat de la sesión de la auditoría de costos («Alinear»). Toca `infrastructure/project.tf` (archivo protegido: declara facturación) con su visto explícito; el merge necesita además su visto en el PR.
- Origen: auditoría de costos GCP del 2026-10-21/23. El presupuesto de la cuenta de facturación estaba en CLP 180 y saltaba todos los días 1. El PO lo cambió a CLP 450.000 con `gcloud billing budgets update` el 2026-10-23.
- El `terraform apply` lo ejecuta el PO. Este PR no aplica nada.

## 1. Objective

Que el repo diga cuál es el presupuesto real y que el dashboard compare el pronóstico contra ese mismo monto.

Hoy el repo dice otra cosa que GCP:

| Dónde | Qué dice | Qué hay en GCP |
|---|---|---|
| `infrastructure/project.tf`, runbook del budget | 500 USD, alcance el proyecto, nombre «Booster AI — prod» | CLP 450.000, toda la cuenta de facturación, «Booster GCP mensual (CLP 450.000)», umbrales 50/90/100 % |
| `var.monthly_budget_usd` (default 500) y `terraform.tfvars.example` | USD 500; la descripción dice alertas a 50/75/90/100 % | La variable no crea ningún budget: solo alimenta la pestaña Forecast (`MONTHLY_BUDGET_USD × dólar del día`, `apps/api/src/services/observability/forecast-service.ts`) |

## 2. Entradas y salidas

- Entradas: el budget vivo `billingAccounts/019461-C73CDE-DCE377/budgets/d3604cde-159e-439c-895f-fe16a7c5b4cd` (CLP 450.000) y el dólar observado del 2026-09-28 (964 CLP/USD, el de `docs/audits/costos-servicios-2026-09-28.md`).
- Salidas: comentario de `project.tf` con el budget vigente y el comando para cambiarlo; `monthly_budget_usd` en 467 (450.000 / 964) en `variables.tf` y `terraform.tfvars.example`.

## 3. Success criteria

- [ ] SC-1: el runbook de `project.tf` describe el budget vivo (id, nombre, alcance, monto, umbrales) y el comando `gcloud` que lo cambia, con la nota de que `percent` va como fracción.
- [ ] SC-2: `var.monthly_budget_usd` vale 467 por defecto y su descripción dice que solo alimenta el Forecast.
- [ ] SC-3: `terraform.tfvars.example` usa 467.
- [ ] SC-4: `terraform fmt -check -recursive infrastructure/` pasa (es el check de Terraform que corre CI en cada PR).
- [ ] SC-5: el código del api y de la web no cambia: el Forecast sigue calculando `budgetClp = budgetUsd × dólar`; con 467 da ≈ CLP 450.000 al dólar de 964.

## 4. Fuera de alcance

- Pasar el Forecast a un presupuesto en CLP (variable y env nuevas). Evita que el monto se mueva con el dólar (±2 % con un dólar entre 940 y 985), pero cambia código del api y textos de la UI. Queda como opción si el PO la pide.
- `infrastructure/environments/staging/terraform.tfvars.example` (250): el proyecto de staging no existe todavía.
- Documentos fechados que citan USD 500 (`docs/audits/costos-servicios-2026-09-28.md`, `docs/specs/2026-05-13-observability-dashboard.md`): son registros de su fecha.

## 5. Efecto del apply

`MONTHLY_BUDGET_USD` del api pasa de 500 a 467: el apply crea una revisión nueva de `booster-ai-api`. El tráfico del api lo gestiona el canary (`traffic_managed_externally = true`), así que el valor llega al dashboard cuando esa revisión recibe tráfico. Hasta el apply, el drift check diario (`terraform-drift.yml`, corre con los defaults) va a marcar este diff.
