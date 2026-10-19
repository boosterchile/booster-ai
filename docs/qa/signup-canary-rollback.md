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
| `canary-sleep` | **30 min** | Observa el canary al 1 % y, en esa ventana, manda GET de solo lectura al URL del tag hasta `_CANARY_MIN_REQUESTS` (30). Rutas: `/health` y `/health/signup-flow`. El tiempo que no use la sonda se espera, para completar los 30 min. `signup_probe` sigue cada 60s. |
| `canary-verify` | ~10-90s | Lee Cloud Monitoring (reintenta si la ingesta todavía no muestra el piso) y evalúa error_rate < 1 % y p95 < 500 ms **cuando la muestra llega a 30**. Exit 1 si fallan. |
| `deploy-api` | ~10-30s | `gcloud run services update-traffic --to-latest`. El canary tag y la revision-pre-canary quedan sin traffic. |
| `smoke-tests` + `watch-deploy` | ~1-2 min | Steps existing (lines ~270+). |

**Total wall-clock**: ~32-35 min por deploy api. Sin canary era ~3-5 min. **Trade-off documentado en spec §3 SC-1.2.3** y aceptado por PO 2026-05-25.

## 3. Decision criteria — promover o rollback

### 3.1. Promover automático (happy path)

Cloud Build promueve **automáticamente** vía step `deploy-api` cuando:

- `canary-verify` exit 0.
- Alert policy `signup_probe_failure` NO disparó durante el `canary-sleep` window.
- La muestra llegó a `_CANARY_MIN_REQUESTS` (30) y error_rate < 1 % y p95 < 500 ms. El piso no se baja.
- Si la sonda no junta los 30, también es exit 0: WARN y promover, sin evaluar p95 (§3.1.1).

No requiere human intervention. El human-on-call recibe el job-success notification 30+ min después del push.

### 3.1.1. Sonda de solo lectura (cómo se junta el piso)

`canary-sleep` resuelve el URL del tag `canary-signup-<sha>` (`status.traffic[].url`, o lo compone con el host del servicio) y manda **exactamente 30 GET**, alternando:

- `GET /health`
- `GET /health/signup-flow`

Las dos son liveness público: sin body, sin `Authorization`, sin base de datos y sin datos de usuarios. No se llama `/ready` (hace `SELECT 1`; un 503 o la latencia de la DB tumbarían el umbral). No hay POST, PUT, PATCH ni DELETE, y no se siguen redirects. El `User-Agent` es `booster-canary-probe`.

El ingress del api es `INTERNAL_LOAD_BALANCER`, así que un GET al `*.run.app` desde el worker de Cloud Build puede volver el HTML 404 del frontend de Google y **no** contar en `request_count`. Si la primera respuesta no es JSON de la app, la misma sonda corre en un Job efímero (`canary-probe-<sha>`, namespace `default`) del cluster `booster-ai-telemetry`: el pod está en la VPC del proyecto, con Private Google Access, y Cloud Run lo trata como tráfico interno. El Job usa la imagen del api ya publicada pero con `command: node -e …` — no arranca el servidor ni corre migraciones — y se borra al terminar. No monta el token de la cuenta de servicio.

Los requests se espacian para caber en la ventana y dejar ~3 min de margen antes de `canary-verify`, que relee Monitoring hasta 3 veces, con 20 s entre lecturas, si la muestra todavía no aparece.

Si la sonda no llega a la revisión (sin URL de tag, job que no completa, ingress cerrado y sin credenciales de cluster), `canary-verify` conserva el desenlace de 2026-09-28: muestra bajo 30 → WARN y promover, **sin** evaluar p95. No se baja el piso: con 0, un n chico evalúa el p95 y el cold start del 2026-08-16 (n=6, 1408 ms, 0 errores) abortó un deploy sano.

### 3.2. Rollback automático (canary-verify fail)

Cloud Build aborta el job cuando:

- `canary-verify` exit 1 (la muestra alcanza el piso y error_rate o p95_latency exceden thresholds).
- El step `deploy-api` NO ejecuta — la revision anterior sigue con 99% del traffic.
- El canary tag `canary-signup-<sha>` queda con 1% — **drift implícito**: el traffic split no vuelve a 100%/0% automáticamente. Human-on-call DEBE ejecutar manualmente:

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
