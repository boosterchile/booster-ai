# Verify: presupuesto-clp

- Spec: .specs/presupuesto-clp/spec.md
- Fecha: 2026-10-23. Nada se aplicó.

## 1. Budget vivo (entrada)

Salida de `gcloud billing budgets update` corrida por el PO el 2026-10-23 desde su Mac (`dev@boosterchile.com`), transcrita de su captura de pantalla:

```
Updated budget [d3604cde-159e-439c-895f-fe16a7c5b4cd].
amount:
  specifiedAmount:
    currencyCode: CLP
    units: '450000'
displayName: Booster GCP mensual (CLP 450.000)
thresholdRules:
- spendBasis: CURRENT_SPEND
  thresholdPercent: 0.5
- spendBasis: CURRENT_SPEND
  thresholdPercent: 0.9
- spendBasis: CURRENT_SPEND
  thresholdPercent: 1.0
```

Antes del cambio (`gcloud billing budgets list`, 2026-10-22): `currencyCode: CLP`, `units: '180'`, nombre `$150 Alerta de presupuesto mensual`, umbrales 1.0 / 1.5 / 2.0, `budgetFilter` solo con `calendarPeriod: MONTH` (alcance: toda la cuenta).

`percent` como fracción: `lib/surface/billing/budgets/update.yaml` y `create.yaml` (Google Cloud SDK 570.0.0) mapean `percent` directo a `thresholdPercent`, sin conversión. La ayuda de `update` dice «Integer between 0 and 100»; la de `create` dice «Number between 0.0 and 1.0». El budget anterior guardaba 1.0 / 1.5 / 2.0 para las alertas del 100 / 150 / 200 % que llegaban por correo, lo que confirma la escala de fracción.

## 2. Checks

| SC | Check | Resultado |
|---|---|---|
| SC-1 | Runbook de `project.tf` | Describe id, nombre, alcance, monto, umbrales y el comando `gcloud` |
| SC-2 | `var.monthly_budget_usd` | Default 467, descripción nueva |
| SC-3 | `terraform.tfvars.example` | 467 |
| SC-4 | `terraform fmt -check -recursive infrastructure/` (Terraform 1.9.8) | Sin diferencias |
| SC-5 | `vitest run` de `forecast-service`, `factory` y `admin-observability-route` | 3 archivos, 45 tests, todos pasan |
| SC-5 | `ForecastService.forecast({ budgetUsd: 467, ... })` | `budgetClp` = 438.980 (dólar 940), 450.188 (964), 459.995 (985) |

`terraform validate` no corrió: `terraform init` necesita registry.terraform.io y la red de la sesión lo bloquea (403). CI tampoco lo corre; su job de Terraform es solo `fmt`. El cambio es un número, una descripción y comentarios, y `fmt` parsea el HCL de todos los archivos.

## 3. Pendiente del PO

1. Visto en el PR (toca `project.tf`, archivo protegido).
2. Después del merge, `terraform apply` para que `MONTHLY_BUDGET_USD` del api pase de 500 a 467. Si el `terraform.tfvars` local tiene `monthly_budget_usd = 500`, cambiarlo a 467 o quitar la línea: el drift check diario corre con los defaults.
