# Runbook — Servicio `apps/matching-engine` (SKELETON)

- **Estado**: Vigente · **el servicio es un SKELETON** (no implementado)
- **Servicio Cloud Run**: `booster-ai-matching-engine` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_ONLY`, `public = false`, `min/max = 0/10`.

## Lo primero que tenés que saber

> **La lógica de matching NO corre en este servicio hoy.** `apps/matching-engine/src/main.ts` es un skeleton: arranca, loguea `@booster-ai/matching-engine starting (skeleton)` y no hace nada más (no consume Pub/Sub, no expone endpoints de negocio). El plan (ADR-004) es que sea un consumer de `cargo-requested-events` que publica `offer-sent-events`, pero **aún no se extrajo**.

**El matching productivo vive dentro de `apps/api`**: `apps/api/src/services/matching.ts` (+ `matching-v2-*.ts`, `offer-actions.ts`, `notify-offer.ts`) usando el package `@booster-ai/matching-algorithm`. **Si el matching falla en producción, el runbook que aplica es `service-api.md`**, no éste.

## Síntomas / dónde responder

| Síntoma | Dónde |
|---|---|
| "No salieron ofertas para una carga", carrier esperaba una oferta y no la recibió, scoring raro | `apps/api` → **`service-api.md`** + skill `booster-skills:empty-leg-matching` (algoritmo transparente/determinista). El log/decisión de matching está en los logs del `booster-ai-api`. |
| La revisión `booster-ai-matching-engine` está caída / no arranca | impacto **nulo** en el producto hoy (no procesa tráfico). Ver abajo. |

## Diagnóstico del skeleton (si alguien pregunta por la revisión)

```bash
SVC=booster-ai-matching-engine ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# ¿Está desplegado? (no debería tener tráfico de negocio)
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, status.conditions[0].message)'

# Logs: sólo debería verse la línea de "skeleton"
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-matching-engine"' \
  --project=$PROJECT --limit=20 --freshness=1h
```

Si está `Failed`, no es una emergencia: no hay ingesta real. Un `update-traffic` a una revisión que arranca lo deja sano:

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100
```

## Cuando se implemente

Al extraer el matching a este servicio (seguir skill `booster-skills:adding-cloud-run-service`), este runbook debe crecer con: subscriptions Pub/Sub que consume y su DLQ, configuración de consumer pull (si aplica, mismo cuidado `min-instances>=1` + CPU always-on que `service-telemetry-processor.md`), métricas de matching, y rollback. Hasta entonces, **el matching es `apps/api`**.

## Escalación

- **Operador único** (`dev@boosterchile.com`). Para problemas reales de matching → `service-api.md` + `booster-skills:empty-leg-matching`. La caída del skeleton en sí no escala (sin impacto productivo); registrarla en `docs/handoff/CURRENT.md` si llama la atención.

## Refs

- Matching real: `service-api.md`, skill `booster-skills:empty-leg-matching`, `apps/api/src/services/matching.ts`, `packages/matching-algorithm`.
- Plan de extracción: ADR-004, skill `booster-skills:adding-cloud-run-service`. README: `apps/matching-engine/README.md`.
