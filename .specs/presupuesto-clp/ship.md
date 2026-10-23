# Ship: presupuesto-clp

- Spec: .specs/presupuesto-clp/spec.md
- Fecha: 2026-10-23. Apply ejecutado por el PO desde su Mac (`dev@boosterchile.com`), sobre un worktree limpio de `main` @ `42d84ca` (#830).

## Lista de verificación

- [x] Budget vivo en GCP: CLP 450.000, umbrales 50 / 90 / 100 % (`verify.md` §1).
- [x] Plan en seco guardado (`-out`) y revisado antes del apply.
- [x] Primer plan descartado, no se aplicó. Se corrió solo con los defaults más `billing_account` y, además del cambio, quitaba `RESEND_API_KEY` del api: prod corre con `resend_api_key_ready = true` y el default es `false`. Es la misma causa del falso drift que documenta #824.
- [x] Segundo plan con `-var=resend_api_key_ready=true`: `Plan: 0 to add, 1 to change, 0 to destroy`. Único cambio: `MONTHLY_BUDGET_USD` `"500"` → `"467"` en `module.service_api.google_cloud_run_v2_service.service`. Las exclusiones de logs de #821 (`gke-system-data-access`, `gke-node-default-noise`, `gke-node-serial-console`) están en el state y no cambian.
- [x] Apply del plan guardado.

## Evidencia del apply

Transcrita de la captura de la terminal del PO:

```
$ terraform apply presupuesto.plan
module.service_api.google_cloud_run_v2_service.service: Modifications complete after 22s
Apply complete! Resources: 0 added, 1 changed, 0 destroyed.

$ gcloud run services describe booster-ai-api --region=southamerica-west1 \
    --format="yaml(status.latestReadyRevisionName,status.traffic)"
status:
  latestReadyRevisionName: booster-ai-api-00458-fjw
  traffic:
  - revisionName: booster-ai-api-00457-zj8
    tag: canary-signup-18ce8e2278b0
  - latestRevision: true
    percent: 100
    revisionName: booster-ai-api-00458-fjw

$ curl -s -o /dev/null -w "%{http_code}\n" https://api.boosterchile.com/health
200
```

El 100 % del tráfico quedó en la revisión nueva, así que la pestaña Forecast ya compara contra 467 USD (≈ CLP 450.000).

## Próximo apply manual

Mientras #824 no esté en `main`, planificar con:

```
terraform plan -input=false \
  -var=billing_account=019461-C73CDE-DCE377 \
  -var=resend_api_key_ready=true \
  -out=<nombre>.plan
```

El drift check diario sigue en rojo por el falso `RESEND_API_KEY` hasta que se mergee #824; `MONTHLY_BUDGET_USD` ya no aparece en su diff.

## Rollback

Revertir #830 y aplicar con el mismo comando: `MONTHLY_BUDGET_USD` vuelve a 500. El budget de GCP no lo toca Terraform; se cambia con el comando `gcloud` documentado en `infrastructure/project.tf`.
