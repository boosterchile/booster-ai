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
| `deploy-canary` | ~30-60s | `gcloud run services update --image=... --tag=canary-signup-<sha> --no-traffic`. La nueva revision queda registrada pero recibe 0% del traffic. |
| `route-canary` | ~5-10s | `gcloud run services update-traffic --to-tags=canary-signup-<sha>=1`. 1% del traffic empieza a ir al canary; 99% sigue en la revision anterior. |
| `canary-sleep` | **30 min exactos** | `sleep 1800`. Synthetic monitor `signup_probe` corre cada 60s (= 30 probes) durante esta ventana. |
| `canary-verify` | ~10-30s | Query Cloud Monitoring API para validar error_rate < 1% AND p95_latency < 500ms sobre el canary tag. Exit 1 si fail. |
| `deploy-api` | ~10-30s | `gcloud run services update-traffic --to-latest`. El canary tag y la revision-pre-canary quedan sin traffic. |
| `smoke-tests` + `watch-deploy` | ~1-2 min | Steps existing (lines ~270+). |

**Total wall-clock**: ~32-35 min por deploy api. Sin canary era ~3-5 min. **Trade-off documentado en spec §3 SC-1.2.3** y aceptado por PO 2026-05-25.

## 3. Decision criteria — promover o rollback

### 3.1. Promover automático (happy path)

Cloud Build promueve **automáticamente** vía step `deploy-api` cuando:

- `canary-verify` exit 0.
- Alert policy `signup_probe_failure` NO disparó durante el `canary-sleep` window.

No requiere human intervention. El human-on-call recibe el job-success notification 30+ min después del push.

### 3.2. Rollback automático (canary-verify fail)

Cloud Build aborta el job cuando:

- `canary-verify` exit 1 (error_rate o p95_latency exceden thresholds).
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
