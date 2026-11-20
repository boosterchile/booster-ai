# One-shot — encender `RUTAS_API_ACTIVADA` en prod

**Fecha**: 2026-11-16 · America/Santiago  
**Visto PO**: «ok, dale» tras «Esperando tu visto para: `RUTAS_API_ACTIVADA` → luego matching sombra→activa».  
**Alcance de este paso**: solo rutas. **No** tocar `MATCHING_ELEGIBILIDAD_MODO` (sigue `sombra`).

## Por qué no lo aplicó el agente Cursor

- Mecanismo canónico del repo para flags de Cloud Run: **Terraform** (`infrastructure/variables.tf` → `compute.tf` → env del `module.service_api`), igual que `AUTH_UNIVERSAL_V1_ACTIVATED` / `SIGNUP_REQUEST_FLOW_ACTIVATED`.
- Hasta este cableado, `RUTAS_API_ACTIVADA` **no** estaba en Terraform: solo `booleanFlag(false)` en `apps/api/src/config.ts` (ausente = falsa).
- `cursor-agent@` tiene `roles/viewer` + Scheduler writer (#962). **No** tiene `run.services.update`.
- Intento 2026-11-15 22:20 -03:

```text
gcloud run services update booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --update-env-vars=RUTAS_API_ACTIVADA=true
→ PERMISSION_DENIED: Permission 'run.services.update' denied …
  (authenticated as cursor-agent@booster-ai-494222.iam.gserviceaccount.com)
```

- `docs/runbooks/terraform-apply.md`: el agente no corre `terraform apply` en prod (credenciales = owner / Claude Code con ADC del PO).

## One-shot canónico (preferido) — Terraform

Correr como `dev@boosterchile.com` (ADC / Claude Code con cuenta owner), con el PR de cableado ya en `main` (o en el working tree que se aplica):

```bash
cd infrastructure
terraform plan \
  -target=module.service_api \
  -out=tf-rutas.plan
# Revisar el plan: debe proponer agregar/cambiar
#   RUTAS_API_ACTIVADA = "true"
# en booster-ai-api. NO debe tocar MATCHING_ELEGIBILIDAD_MODO (sigue sombra).
# Si el plan arrastra drift ajeno (p. ej. RESEND_API_KEY), acotar o
# descartar y re-planear; no reconciliar drift no pedido en este apply.
node ../scripts/repo-checks/check-validated-secret-placeholders.mjs \
  <(terraform show -json tf-rutas.plan)
terraform apply tf-rutas.plan
```

Reverso:

```bash
terraform apply -target=module.service_api -var=rutas_api_activada=false
# o revertir default en variables.tf a false + apply
```

## One-shot interim (solo si hace falta antes del apply)

Crea revisión nueva; el **siguiente** `terraform apply` sin el var cableado la borraría. Con el cableado mergeado, el apply siguiente la consolida.

```bash
gcloud run services update booster-ai-api \
  --project=booster-ai-494222 \
  --region=southamerica-west1 \
  --update-env-vars=RUTAS_API_ACTIVADA=true
```

Reverso interim:

```bash
gcloud run services update booster-ai-api \
  --project=booster-ai-494222 \
  --region=southamerica-west1 \
  --update-env-vars=RUTAS_API_ACTIVADA=false
```

## Smoke post-apply (America/Santiago)

```bash
TZ=America/Santiago date
curl -sS https://api.boosterchile.com/health
curl -sS https://api.boosterchile.com/ready
curl -sS https://api.boosterchile.com/feature-flags
# Esperado: "rutas_api_activada": true
# GET /rutas sin auth → 401 (el flag ya no 404-ea antes del auth;
# con auth de transportista → 200 lista).
curl -sS -o /dev/null -w '%{http_code}\n' https://api.boosterchile.com/rutas
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)' \
  | grep -A1 RUTAS_API_ACTIVADA
```

## Baseline pre-apply (agente, 2026-11-15 22:19–22:20 -03)

| Check | Resultado |
|---|---|
| `GET /health` | 200 ok |
| `GET /ready` | 200 ready |
| `GET /feature-flags` | `rutas_api_activada: false` |
| `GET /rutas` (sin auth) | 401 Unauthorized |
| Revisión lista | `booster-ai-api-00476-lts` |
| `MATCHING_ELEGIBILIDAD_MODO` | `sombra` (sin cambio) |

## Siguiente paso (NO en este apply)

Tras smoke de rutas en verde y (ideal) una ruta con dos cargas punta a punta: pedir visto explícito del PO para `MATCHING_ELEGIBILIDAD_MODO=activa` (`-var=matching_elegibilidad_modo=activa`). No va en el mismo one-shot.
