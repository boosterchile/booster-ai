# Signup canary deploy + rollback runbook

> SEC-001 Sprint 2b H1.2 T13 · 2026-05-26
> SC-1.2.3 (synthetic monitor + canary 30min antes de full deploy).
> ADR: [`052-signup-migration-admin-sdk-gate.md`](../adr/052-signup-migration-admin-sdk-gate.md) (Proposed; flip Accepted depende de canary success + 2h watch).
> Cloud Build: `cloudbuild.production.yaml` steps `deploy-canary → route-canary → canary-sleep → canary-verify → deploy-api`.
> Synthetic monitor: `infrastructure/signup-probe.tf`.

## 1. Cuándo aplica este runbook

Cada deploy a producción del servicio `booster-ai-api` que pasa por Cloud Build (`cloudbuild.production.yaml`). El job:

1. Construye la imagen Docker.
2. Pushea al Artifact Registry.
3. **NUEVO post-T13**: ejecuta los 5 steps de canary (deploy-canary → route-canary → canary-sleep 30min → canary-verify → deploy-api).
4. Smoke E2E + downstream watch-deploy.

Si la decisión es **NO** correr canary (e.g., hotfix urgente, deploy-trivial sin signup-flow changes), saltar T13 NO está soportado en cloudbuild.yaml — todos los deploys api pasan por la canary sequence. Para skip emergency, ver §5 "Override emergency".

## 2. Pipeline timeline esperado

| Step | Duración | Acción |
|---|---|---|
| `deploy-canary` | ~30-60s | `gcloud run services update --image=... --no-traffic` y luego `gcloud run services update-traffic --update-tags=canary-signup-<sha>=<revisión>`. La nueva revision queda registrada pero recibe 0% del traffic. El tag va aparte para que Cloud Run nombre la revisión y Terraform no vea drift (T10-06). |
| `route-canary` | ~5-10s | `gcloud run services update-traffic --to-tags=canary-signup-<sha>=1`. 1% del traffic empieza a ir al canary; 99% sigue en la revision anterior. |
| `canary-sleep` | **30 min** (tope del step 2100 s) | Observa el canary al 1 % y, en esa ventana, manda GET de solo lectura al URL del tag: `_CANARY_MIN_REQUESTS` (30) más cinco. Rutas: `/health` y `/health/signup-flow`. El tiempo que no use la sonda se espera, para completar los 30 min. `signup_probe` sigue cada 60s. La ventana no se acorta: el piso de 30 se observa en esos 30 min. |
| `canary-verify` | tope 480 s | Lee el resultado de la sonda y Cloud Monitoring (reintenta si la ingesta todavía no muestra el piso). Evalúa error_rate < 1 % y p95 < 500 ms **cuando la muestra llega a 30** (Monitoring, o `respuestas_app` si la sonda llegó y Monitoring se quedó corto). Exit distinto de 0 si no hay URL del tag, si el piso es 0, si la muestra no llega al piso, si la sonda vio 5xx o errores de conexión, si fallaron el camino directo y el Job, o si los SLO fallan. Sin muestra, además revierte el tag (3 intentos, backoff 2 s y 4 s, cada `gcloud` a 30 s). |
| `deploy-api` | ~10-30s | `gcloud run services update-traffic --to-latest`. El canary tag y la revision-pre-canary quedan sin traffic. |
| `smoke-tests` + `watch-deploy` | ~1-2 min | Steps existing (lines ~270+). |

**Tope del build**: 5400 s (90 min), en `cloudbuild.production.yaml`. El release de #793 (Cloud Build `c11b1702`) murió por TIMEOUT a los 3600 s dentro de `canary-sleep`: el tramo hasta `route-canary` se fue a unos 30 min y `canary-verify` no arrancó. El presupuesto vigente reserva 2100 s para ese tramo (observado ~1800 s), 2100 s para `canary-sleep` (ventana 1800 + 300), 480 s para `canary-verify` y 240 s para `deploy-api` + `gke-deploy` + smoke. Suma 4920 s, margen 480 s. La ventana de 30 min se mantiene: cabe bajo 5400 s. El ~660 s de `aca4641f` (2026-06-16) ya no describe el tramo previo.

**Trade-off documentado en spec §3 SC-1.2.3** y aceptado por PO 2026-05-25. El tope de 5400 s lo firma el PO: `cloudbuild.production.yaml` es archivo protegido.

## 3. Decision criteria — promover o rollback

### 3.1. Promover automático (happy path)

Cloud Build promueve **automáticamente** vía step `deploy-api` cuando:

- `canary-verify` exit 0.
- Alert policy `signup_probe_failure` NO disparó durante el `canary-sleep` window.
- La muestra llegó a `_CANARY_MIN_REQUESTS` (30) —por Monitoring, o por `respuestas_app` si la sonda llegó a la app y Monitoring dio menos— y error_rate < 1 % y p95 < 500 ms. El piso no se baja. El p95 queda dominado por `/health` (§3.1.1).
- Sin URL del tag, con `_CANARY_MIN_REQUESTS=0`, o con Monitoring y la sonda bajo el piso, **no** se promueve: exit distinto de 0 y se revierte el tag (§3.2).

No requiere human intervention. El human-on-call recibe el job-success notification 30+ min después del push.

### 3.1.1. Sonda de solo lectura (cómo se junta el piso)

`canary-sleep` resuelve el URL del tag `canary-signup-<sha>` (`status.traffic[].url`, o lo compone con el host del servicio) y manda **35 GET** (el piso 30 más cinco), alternando:

- `GET /health`
- `GET /health/signup-flow`

Las dos son liveness público: sin body, sin `Authorization`, sin base de datos y sin datos de usuarios. No se llama `/ready` (hace `SELECT 1`; un 503 o la latencia de la DB tumbarían el umbral). No hay POST, PUT, PATCH ni DELETE, y no se siguen redirects. El `User-Agent` es `booster-canary-probe`.

El ingress del api es `INTERNAL_LOAD_BALANCER`, así que un GET al `*.run.app` desde el worker de Cloud Build vuelve el HTML 404 del frontend de Google y **no** cuenta en `request_count`. Ese 404 es ingress. Un **5xx** de `*.run.app` no lo es: Cloud Run responde 503 en HTML cuando la revisión no atiende, y eso cuenta como llegada a la app. Si la primera respuesta no es de la aplicación (404 de ingress o error de transporte), la misma sonda corre en un Job efímero (`canary-probe-<sha>`, namespace `default`) del cluster `booster-ai-telemetry`. El pod está en la subnet `booster-ai-private` (Private Google Access) y fija el host del tag en `199.36.153.8` (`private.googleapis.com`). El DNS público de `*.run.app` sale por Cloud NAT y Cloud Run lo vuelve a ver como internet: el mismo 404.

**Camino directo (Ops, 2026-10-19).** El GET directo da 404 de ingress y no se corrige en el step. El worker de `booster-production-pool` tiene IP externa (`no_external_ip = false` en `infrastructure/cloudbuild.tf`, porque el pool necesita salir a internet para bajar imágenes base) y vive en el rango de peering `booster-cloudbuild-pool-range` (`VPC_PEERING` /24 de servicenetworking), no en la subnet `booster-ai-private`. Private Google Access es un flag de esa subnet: el producer del peering no lo hereda. Apuntar `/etc/hosts` del step a `199.36.153.8` no enruta el VIP privado; el GET dejaría de fallar rápido y pasaría a colgar. Poner `no_external_ip = true`, o mover el pool a una subnet con Private Google Access, es Terraform y no entra en este cambio. No hay un load balancer interno del tag al que el worker pueda pegarle: el NEG de `api.boosterchile.com` es el LB público del servicio entero, no de la revisión del tag. El Job es el camino que llega. El 404 directo es un solo GET y el step sale con código 2; no es lo que consumió la hora en `c11b1702`. El Job usa la imagen del api ya publicada, **fijada por digest** (`api@sha256:…`), con `command: node -e …` — no arranca el servidor ni corre migraciones — y no monta el token de la cuenta de servicio. Los logs se leen en cuanto el Job queda `Complete` o `Failed`, o en cuanto `kubectl get` responde NotFound. El borrado es posterior a esa lectura, también si el Job falló o el sondeo hizo timeout. `ttlSecondsAfterFinished` es 1800 s para que un wait largo no borre el objeto antes. Si el Job ya no existe al leer, o no hay resumen, `canary-verify` sale distinto de 0: no se promueve sin muestra.

La sonda escribe `/workspace/canary-probe.json` con las respuestas de la app, los 5xx y los timeouts o errores de conexión. `canary-verify` lee ese archivo **antes** de Monitoring:

- Llegó a la app y hay al menos un 5xx, o un timeout, o un error de conexión → exit distinto de 0. No promueve. Ese rollback de SLO lo hace el humano (§3.2).
- Había URL del tag y fallaron el camino directo y el Job → exit distinto de 0. No promueve.
- El Job desapareció antes de poder leer los logs → exit distinto de 0. No promueve. El mensaje nombra `ttlSecondsAfterFinished`.
- No había URL del tag (el archivo no existe, o `tenia_url` es falso), o no hay revisión con ese tag → exit distinto de 0. No promueve. Si el tag estaba ruteado, se revierte.
- `_CANARY_MIN_REQUESTS=0` se trata como sin muestra: exit distinto de 0 y se revierte el tag. No se evalúa el p95. El piso del pipeline sigue en 30.
- La sonda llegó, Monitoring quedó bajo 30 y `respuestas_app` llega al piso → ese conteo es el piso. El p95 es el de las latencias de la sonda, no el de Monitoring (con pocos requests de Monitoring ese p95 es el cold start). Si la sonda no trae p95, exit distinto de 0 y no se promueve. Un p95 ≥ 500 ms no promueve (rollback humano). Si `respuestas_app` tampoco llega al piso → exit distinto de 0 y se revierte el tag. Ya no hay WARN que promueva. La decisión de 2026-09-28 queda superada por el PO el 2026-10-19.

Los requests se espacian para caber en la ventana y dejar ~3 min de margen antes de `canary-verify`, que relee Monitoring hasta 3 veces, con 20 s entre lecturas, si la muestra todavía no aparece.

El p95 de esa ventana queda **dominado por `/health`** (y por `/health/signup-flow`): son la mayoría de los requests y responden sin base de datos. El umbral de 500 ms mira esa latencia cuando el piso está cubierto. No se baja el piso: `_CANARY_MIN_REQUESTS=0` falla como sin muestra, sin mirar el p95. El cold start del 2026-08-16 (n=6, 1408 ms, 0 errores) ya no promueve: sin `respuestas_app` que cubra el piso, es falla y se revierte el tag.

### 3.2. Rollback (canary-verify fail)

Cloud Build aborta el job cuando `canary-verify` sale distinto de 0. El step `deploy-api` no corre.

**Sin muestra** (no hay URL del tag, el piso está en 0, o ni Monitoring ni `respuestas_app` llegan al piso): el mismo step, antes de salir, manda el 100 % a la revisión que no lleva el tag y ejecuta `--remove-tags=canary-signup-<sha>`. Si el estable viene como `latestRevision` sin nombre, usa `latestReadyRevisionName` (y si esa es el canary, `latestCreatedRevisionName`). Describe y `update-traffic` se reintentan 3 veces, con espera de 2 s y 4 s, y cada `gcloud` va con `timeout -k 5 30`. Si tras eso no hay revisión estable o el `gcloud` falla, el log dice `ALERTA revertir el tag falló` y el step sale distinto de 0: el 1 % puede quedar y no se promueve. Ahí el humano usa el comando de abajo.

**SLO** (5xx o errores de conexión de la sonda, error_rate ≥ 1 %, p95 ≥ 500 ms, Job perdido o ambos caminos fallidos): no se promueve y **no** se revierte el tag solo. El canary queda al 1 %. Human-on-call ejecuta:

```bash
gcloud run services update-traffic booster-ai-api \
  --region=southamerica-west1 \
  --platform=managed \
  --to-revisions=PREVIOUS=100
```

(Cleanup del tag, opcional para no acumular tags huérfanos):

```bash
gcloud run services update-traffic booster-ai-api \
  --region=southamerica-west1 \
  --platform=managed \
  --remove-tags=canary-signup-<sha>
```

### 3.3. Rollback humano-driven (alert policy fire mid-canary)

Durante el `canary-sleep` 30min, si el alert policy `signup_probe_failure` dispara (2 consecutive uptime failures = 120s window):

1. **Page recibido** (email → eventualmente PagerDuty cuando se integre).
2. **Decisión inmediata** (target SLA: 5 min):
   - **Rollback fast-path** si el failure es claramente atribuible al canary (signup-flow specific, no afecta /health general):
     ```bash
     gcloud run services update-traffic booster-ai-api \
       --region=southamerica-west1 \
       --platform=managed \
       --to-revisions=PREVIOUS=100
     ```
   - **Investigar sin rollback** si el failure afecta múltiples paths (signup + non-signup): probable es downstream dep down (DB/Redis), no específico al canary. El canary recibe 1% — rollback no soluciona el incident raíz.
3. **Abortar Cloud Build job** post-rollback (UI Cloud Build o `gcloud builds cancel <BUILD_ID>`) para evitar que el step `deploy-api` ejecute después del rollback y vuelva a promover el canary.
4. **Post-incident review** dentro de 24 h.

## 4. Pre-deploy checklist

Antes de pushear un commit que toque `apps/api/src/routes/signup-request.ts`, `apps/api/src/services/signup-request.ts`, `apps/api/src/services/notifications/signup-request-email.ts`, o `apps/api/src/routes/admin-signup-requests.ts`:

- [ ] Tests unit + integration api pasaron en CI (Test+Coverage + Integration tests gates).
- [ ] El commit es **incremental, not a major refactor** — el canary 30min asume regression detectable en signup-probe; refactors masivos pueden romper paths no cubiertos por el probe.
- [ ] **Off-hours preferido** para Friday-deploys (CLAUDE.md "NO deploy viernes después de 16:00 Chile sin waiver explícito"). El canary 30min add 30min a la deploy window — calcular accordingly.
- [ ] Si tocas `cloudbuild.production.yaml` canary steps, validar local con `gcloud builds submit --no-source --config=...` antes del merge.

## 5. Override emergency (skip canary)

Cuando el incident response require deploy inmediato (signup flow caído, no podemos esperar 30min):

1. **Decisión PO** + structured log en `.claude/ledger/`.
2. En commit dedicado sobre `main`, inhabilitar los steps `route-canary` + `canary-sleep` + `canary-verify` en `cloudbuild.production.yaml` (cambiar `id: deploy-api` a `waitFor: [deploy-canary]` directo).
3. Tras el deploy emergency, **revertir el commit** en commit subsiguiente (CLAUDE.md "Cero deuda day 0" — no dejar comentadas las defensas).
4. Documentar en post-incident review + RCA.

NO ejecutar `gcloud run deploy --image=... --to-latest=100` manual saltando Cloud Build — viola IaC contract (image source of truth = Cloud Build).

## 6. Verificación de health post-promote

Post-`deploy-api` step automático, el step existing `smoke-tests` y `watch-deploy` corren. Adicionalmente, human-on-call debería verificar (2h watch per spec):

```bash
# 1. Confirm 100% traffic en latest revision:
gcloud run services describe booster-ai-api \
  --region=southamerica-west1 \
  --format='value(spec.traffic)'

# 2. Synthetic monitor success rate > 99% en 2h:
# (UI Cloud Monitoring → Uptime Checks → "Signup flow /health/signup-flow"
#  → 2h window). Si < 99%, investigar.

# 3. Manual smoke E2E (web app signup form):
# Open https://app.boosterchile.com/login en incognito → "Crear cuenta" →
# Expected: 202 + email confirmation, o auth/operation-not-allowed si T11
# IdP flip ya aplicó.
```

## 7. Integración con ADR-052 Status flip Proposed → Accepted

Per ADR-052 §"Acceptance criterion para transition Proposed → Accepted" step 8:

> T13 emite **separate post-merge commit** `docs(adr-052): Accepted post-canary success cloudbuild run <ID>` que actualiza línea 3 de docs/adr/052-signup-migration-admin-sdk-gate.md de `Proposed` a `Accepted` (per plan §3 T13 round 2 P1-5 fix).

Workflow del flip:

1. T13 PR mergeado a `main`.
2. `terraform apply` + Cloud Build run real ejecutado (apply de monitoring + cloudbuild.yaml live).
3. Próximo deploy api real corre la canary sequence end-to-end.
4. `canary-verify` exit 0 + 2 h watch sin alertas signup_probe_failure + smoke E2E OK.
5. **Separate commit** sobre `main`:
   ```bash
   git checkout main && git pull
   sed -i '' 's/Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2).*/Accepted (post-canary run <CLOUDBUILD_BUILD_ID> + 2h watch '$(date -u +%Y-%m-%d)')/' docs/adr/052-signup-migration-admin-sdk-gate.md
   git commit -am "docs(adr-052): Accepted post-canary success cloudbuild run <BUILD_ID>"
   git push origin main
   ```
6. Sprint 2b H1.2 CERRADO.

## 8. Referencias

- Spec: `.specs/sec-001-cierre/spec.md` §3 H1.2 SC-1.2.3.
- Plan: `.specs/sec-001-cierre/plan-sprint-2b.md` T13.
- ADR: `docs/adr/052-signup-migration-admin-sdk-gate.md`.
- IaC modular: `infrastructure/modules/cloud-run-service/{main,variables}.tf` (`traffic_managed_externally`).
- IaC consumer: `infrastructure/compute.tf` (`module.service_api`).
- Monitoring: `infrastructure/signup-probe.tf`.
- Pipeline: `cloudbuild.production.yaml` steps `deploy-canary..deploy-api`.
- Cross-link cascade: `docs/qa/rate-limit-cascade.md` §signup-request layer.
- Identity Platform: `docs/qa/identity-platform-config.md` (T11 dependency).
