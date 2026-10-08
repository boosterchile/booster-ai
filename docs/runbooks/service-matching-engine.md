# Runbook — Servicio `apps/matching-engine` (ranking de matching)

- **Estado**: Vigente desde T10-21 (`.specs/matching-engine-t10-21/spec.md`, [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)).
- **Servicio Cloud Run**: `booster-ai-matching-engine` · región `southamerica-west1`.
  - Escala: `min/max = 1/10`, `cpu = 1`, `memory = 512Mi`, request-driven.
  - Acceso: `ingress = ALL`, `public = false`; `roles/run.invoker` solo para el SA runtime del api (`infrastructure/matching-engine.tf`).
- **Naturaleza**: `POST /ranking` es cómputo puro: scoring v1/v2 y top-N con `@booster-ai/matching-algorithm`.
  - Sin base de datos, Redis ni secretos.
  - El api arma la solicitud con sus queries y persiste las offers.
  - Auth: Cloud Run IAM más verificación del ID token en la app (`aud` = URL del servicio, `email` = SA del api).

## Lo primero que tenés que saber

**Quién decide el ranking lo deciden dos flags del api** (`infrastructure/variables.tf` → env de `service_api`):

| `matching_via_microservice` | `matching_shadow` | Ranking que crea las offers | Rol del servicio |
|---|---|---|---|
| false | false | api (en proceso) | Ninguno |
| false | true | api | **Sombra**: tras el commit, el api le pide el mismo ranking y compara hashes. Sin efecto en el usuario |
| true | — | **este servicio** | Decide. Si falla (timeout 3 s, 401/403, 5xx, contrato), el api cae al **cálculo local**: el viaje igual recibe ofertas |

**El matching del usuario nunca depende solo de este servicio.** Ante cualquier falla hay fallback local con la misma función. Un incidente de matching (no salen ofertas) sigue siendo de `service-api.md`.

## Señales

| Señal | Significado |
|---|---|
| Alerta `matching-engine: divergencia en sombra` | Mismo input, distinto ranking. Causa típica: versiones distintas de `@booster-ai/matching-algorithm` en el api y en el servicio (release a medias, o la ventana de canary del api tras un cambio de algoritmo). Bloquea el corte hasta explicarla |
| Métrica `matching_shadow_errores` > 0 | La sombra no llegó al servicio: auth (binding `run.invoker`, `ALLOWED_CALLER_SA`), red o caída. Sin impacto en usuarios |
| Alerta `matching-engine: el api cayó al ranking local` | Con el corte activo, el servicio no respondió bien. Los usuarios no se ven afectados (fallback), pero el servicio no está atendiendo |
| `matching ranking remoto` en los logs del api, con `latenciaMs` | Corte activo y sano |

## Diagnóstico

```bash
SVC=booster-ai-matching-engine ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# Flags vigentes en el api
gcloud run services describe booster-ai-api --region=$REGION --project=$PROJECT --format=json \
  | python3 -c "import json,sys;e=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env'];print({x['name']:x.get('value') for x in e if x['name'].startswith('MATCHING')})"

# Lado api: sombra / remoto / fallback
gcloud logging read 'resource.labels.service_name="booster-ai-api" jsonPayload.message=~"^matching (sombra|ranking remoto|remoto fallo)"' \
  --project=$PROJECT --limit=30 --freshness=1h --format='value(timestamp,jsonPayload.message,jsonPayload.latenciaMs)'

# Lado servicio: rankings calculados y rechazos (401 token, 400 contrato, 422 pesos)
gcloud logging read "resource.labels.service_name=\"$SVC\" severity>=INFO" \
  --project=$PROJECT --limit=30 --freshness=1h --format='value(timestamp,severity,jsonPayload.message)'
```

- **401 del servicio** (`ID token inválido` / `caller no autorizado`): revisar que `ALLOWED_CALLER_SA` sea el SA con que corre el api, y que `OIDC_AUDIENCE` sea la URL exacta del servicio.
- **403 antes de llegar a la app**: Cloud Run IAM rechazó la llamada. Revisar `matching_engine_invoker_api` en Terraform.
- **422**: pesos v2 inválidos en `MATCHING_V2_WEIGHTS_JSON` del api. Es un error de config; el api también lo rechazaría localmente.

## Rollback

**Del corte (el que importa):** `terraform apply -var=matching_via_microservice=false`. El api vuelve a rankear en proceso en la revisión nueva, sin pérdida de estado, porque el servicio no tiene estado.

**Del servicio (imagen mala):**

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT --to-revisions=<REVISION_SANA>=100
```

## Drill de rollback en staging (criterio de salida T10-21)

Corre en `booster-ai-stg-494222` ([`staging.md`](staging.md)), con `matching_via_microservice = true` en staging.

**Falla provocada**: una revisión del servicio con `ALLOWED_CALLER_SA` ajeno. El servicio arranca, pero responde 401 a todo:

```bash
gcloud run services update $SVC --region=$REGION --project=booster-ai-stg-494222 \
  --update-env-vars=ALLOWED_CALLER_SA=drill@invalido.iam.gserviceaccount.com
```

| # | Criterio | Cómo se mide |
|---|---|---|
| M1 | La falla se detecta | Crear un viaje de prueba en staging. El api loguea `matching remoto fallo, fallback local` y salta la alerta de fallback |
| M2 | Sin impacto en el usuario | El viaje de prueba queda en `ofertas_enviadas` con sus offers, gracias al fallback local |
| M3 | Rollback del corte en < 5 min | Desde `terraform apply -var=matching_via_microservice=false` (staging) hasta que un viaje nuevo se rankea sin llamar al servicio: no aparece `matching ranking remoto` ni `remoto fallo` para ese `tripId` |
| M4 | Config igual a Terraform | Restaurar la env (`--update-env-vars=ALLOWED_CALLER_SA=<SA runtime>`) y `terraform plan` de staging sin cambios en `module.service_matching_engine` |

Registrar los timestamps y la salida del plan en el PR del corte o en un snapshot de `docs/handoff/`.

## Escalación

- **Operador único** (`dev@boosterchile.com`). Con fallback local, una caída del servicio no bloquea el matching: apagar el corte y diagnosticar sin urgencia de usuario.

## Refs

- Spec: `.specs/matching-engine-t10-21/spec.md`. Algoritmo: `packages/matching-algorithm/src/ranking.ts`. Contrato: `packages/shared-schemas/src/events/matching-ranking.ts`.
- Api: `apps/api/src/services/matching-ranking.ts` (rankeador y cliente) y `matching.ts` (orquestación).
- Infra: `infrastructure/compute.tf` (`service_matching_engine`) y `matching-engine.tf` (IAM, métricas, alertas).
