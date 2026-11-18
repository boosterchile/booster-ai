# One-shot — pasar matching `sombra` → `activa` en prod

**Fecha**: 2026-11-16 · America/Santiago  
**Precondiciones cumplidas**: `RUTAS_API_ACTIVADA=true` en prod (revisión
`booster-ai-api-00477-6tg`, 100 % tráfico); smoke `/feature-flags` + `/rutas`
401; ruta con dos cargas punta a punta (#975).  
**Alcance de este paso**: solo `MATCHING_ELEGIBILIDAD_MODO`. **No** tocar
`RUTAS_API_ACTIVADA` (sigue `true`).  
**Visto PO**: **sí** (explícito «sí» al flip; luego dijo «corrido» asumiendo apply).  
**Estado runtime (re-verificado 2026-11-16 00:32 -03)**: **sigue `sombra`** — el apply
**no** aterrizó. Última revisión lista sigue `booster-ai-api-00477-6tg` (misma que
el flip de rutas). Re-pasar este oneshot ya. Evidencia sombra previa:
`docs/handoff/2026-11-16-evidencia-matching-sombra.md` (0 comparaciones live al
corte #969).

## Por qué ya está «cableado» (a diferencia de rutas pre-#971)

- `var.matching_elegibilidad_modo` ya vive en `infrastructure/variables.tf`
  (default `sombra`) y se inyecta en `module.service_api` vía
  `MATCHING_ELEGIBILIDAD_MODO` (`infrastructure/compute.tf`).
- No hace falta un PR de cableado TF como #971. El flip es un apply con
  `-var=matching_elegibilidad_modo=activa` (o cambiar el default a `activa`
  con visto del PO y luego apply).
- `cursor-agent@` **no** tiene `run.services.update` → no puede hacer el
  interim `gcloud run services update`. Apply canónico = owner / Claude Code
  con ADC (`docs/runbooks/terraform-apply.md`).

## One-shot canónico (preferido) — Terraform

Correr como `dev@boosterchile.com` (ADC / Claude Code con cuenta owner), con
`main` al día (`1aaa3c07` o más nuevo; rutas ya ON; matching aún sombra):

```bash
cd infrastructure
terraform plan \
  -target=module.service_api \
  -var=matching_elegibilidad_modo=activa \
  -out=tf-matching-activa.plan
# Revisar el plan: debe proponer cambiar solo
#   MATCHING_ELEGIBILIDAD_MODO = "activa"
# en booster-ai-api. NO debe tocar RUTAS_API_ACTIVADA (sigue true).
# Si el plan arrastra drift ajeno, acotar o descartar; no reconciliar
# drift no pedido en este apply.
node ../scripts/repo-checks/check-validated-secret-placeholders.mjs \
  <(terraform show -json tf-matching-activa.plan)
terraform apply tf-matching-activa.plan
```

Reverso:

```bash
terraform apply -target=module.service_api \
  -var=matching_elegibilidad_modo=sombra
# o -var=matching_elegibilidad_modo=vigente (rollback ADR-090)
```

## One-shot interim (solo si hace falta antes del apply)

Crea revisión nueva; el **siguiente** `terraform apply` sin `-var=activa`
volverá a `sombra` (default del repo). Consolidar con el apply canónico.

```bash
gcloud run services update booster-ai-api \
  --project=booster-ai-494222 \
  --region=southamerica-west1 \
  --update-env-vars=MATCHING_ELEGIBILIDAD_MODO=activa
```

Reverso interim:

```bash
gcloud run services update booster-ai-api \
  --project=booster-ai-494222 \
  --region=southamerica-west1 \
  --update-env-vars=MATCHING_ELEGIBILIDAD_MODO=sombra
```

## Smoke post-apply (America/Santiago)

```bash
TZ=America/Santiago date
curl -sS https://api.boosterchile.com/health
curl -sS https://api.boosterchile.com/ready
curl -sS https://api.boosterchile.com/feature-flags
# rutas_api_activada debe seguir true
gcloud run services describe booster-ai-api \
  --project=booster-ai-494222 --region=southamerica-west1 \
  --format='yaml(status.latestReadyRevisionName,spec.template.spec.containers[0].env)' \
  | grep -A1 -E 'MATCHING_ELEGIBILIDAD_MODO|RUTAS_API_ACTIVADA'
# Esperado: MATCHING_ELEGIBILIDAD_MODO=activa; RUTAS_API_ACTIVADA=true
```

Tras el primer matching real en `activa`: revisar logs
`matching: elegibilidad por carga` y la métrica
`workload.googleapis.com/matching_elegibilidad_comparaciones_total`
(`scripts/ops/matching-sombra-evidencia.sh` sigue útil para contraste).

## Baseline pre-flip (re-verificado 2026-11-16 00:32 -03)

| Check | Resultado |
|---|---|
| `GET /health` | 200 ok |
| `GET /ready` | 200 ready (db ok, 37 ms) |
| `GET /feature-flags` | `rutas_api_activada: true` (elegibilidad **no** se expone aquí) |
| Revisión lista | `booster-ai-api-00477-6tg` (100 % tráfico; tag canary en `00476-lts` sin %) |
| `RUTAS_API_ACTIVADA` (gcloud) | `true` |
| `MATCHING_ELEGIBILIDAD_MODO` (gcloud) | `sombra` (**apply no aterrizó**) |

Baseline anterior (23:48–23:49 -03): mismo resultado (`sombra`, rutas ON, misma revisión).

## Qué NO hace este documento

- No ejecuta `terraform apply` ni `gcloud run services update` desde Cursor
  (`cursor-agent` sin `run.services.update`).
- No cambia el default de Terraform a `activa` (queda `sombra` hasta
  decisión del PO; el flip va por `-var` o por un PR aparte con visto).
- Tras un apply exitoso: actualizar `docs/handoff/CURRENT.md` (matching
  `activa` + rutas ON) con smoke fresco.
