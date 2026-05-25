# Sprint 1 evidence — sec-001-cierre

Evidencia operacional Sprint 1 (2026-05-24 → 2026-05-25). 14 tasks completados, 12 PRs mergeados a `main`.

## Índice de archivos

| Archivo | Task | Contenido |
|---|---|---|
| [`t0-drift-reconcile.md`](t0-drift-reconcile.md) | T0a | Flag flip `demo_mode_activated true→false` + post-apply curl verification |
| [`t0-strict-gate-failure.md`](t0-strict-gate-failure.md) | T0a | 29 destroys descubiertos, decisión split T0a/T0b |
| [`t0-terraform-plan-strict-gate-FAILED.txt`](t0-terraform-plan-strict-gate-FAILED.txt) | T0a | Output crudo del `terraform plan` que falló el strict gate |
| [`t0-terraform-plan-T0b-success.txt`](t0-terraform-plan-T0b-success.txt) | T0b | Output del plan post HCL import (0 destroys) |
| [`t1-redis-state.md`](t1-redis-state.md) | T1 | `terraform state show google_redis_instance.main` — `tier=STANDARD_HA` ya cumplía R-DA-REDIS-SPOF (no-op) |
| [`t7-5-secret-init.md`](t7-5-secret-init.md) | T7.5 | terraform apply T7+T7.5, secret v2 creada, Cloud Run revision `00299-znv` rotada |

## SC traceability cerrada Sprint 1

| SC spec | Tasks | Estado |
|---|---|---|
| SC-1.0.1 | T0a | ✅ `variables.tf default=false` mergeado |
| SC-1.0.2 | T0a (+ smoke T12) | ✅ `curl POST /demo/login → 404` |
| SC-1.4.1 | T8 | ✅ `seed-demo.ts` lee `process.env.DEMO_SEED_PASSWORD` |
| SC-1.4.2 | T7 (+ apply T7.5) | ✅ secret + IAM + env var mount verificados |
| SC-1.4.3 | T8 | ✅ tests cubren throw paths fail-closed |
| SC-1.4.4 | T8 (+ verificación T12) | ✅ `git grep` = 0 en scope (docs/apps/infra/packages) |
| SC-H2.1 | T9 | ✅ 5/15min/RUT + 429 + Retry-After:900 |
| SC-H2.1b | T10 | ✅ Redis throw → 503 + Retry-After:30 |
| SC-H2.1c | T9 | ✅ `rutSchema.safeParse` normalize |
| SC-H2.2 | T9 + T1 | ✅ counter en Redis HA |
| SC-H2.4 | T10 | ✅ IP global 30/15min + `X-RateLimit-Scope: ip` |
| SC-H4.1 | T4+T5+T6 | ✅ regex value-based + phone normalize + thresholds verificados |
| SC-H4.4 | T6 | ✅ ADR-051 (`REVIEW_BY 2026-11-24`) |
| SC-INT-1 | T11 | ✅ maintenance page demo subdomain con flag OFF |
| SC-1.2.5 | T10 | ✅ `docs/qa/rate-limit-cascade.md` |
| SC-IAC.1 (parcial) | T12 | 🟡 Sprint 1 partial milestone; full mitigation requiere Sprints 2-3 |

## Round-closure traceability

| Round | Item | Status |
|---|---|---|
| 1 | P0-1 T1 Memorystore HA verify | ✅ T1 (no-op confirmado) |
| 1 | P0-2 T3 archivo `migrator.ts` correcto | ✅ T3 |
| 1 | P0-3 T0 drift reconcile añadido | ✅ T0a/T0b |
| 1 | P0-4 T3 STRICT_MIGRATION_ORDERING gating | ✅ T3 |
| 1 | P0-5 T7.5 init CI gate | ✅ T7.5 (gate verde post-apply) |
| 2 | P0-A T0 strict gate exact-1-diff | ✅ T0a/T0b sequence + 29 destroys cerrados |
| 2 | P0-B T3 staging=true ventana | 🟡 staging gap documentado en `docs/qa/migration-ordering.md`; mitigación canary en Sprint 2 |
| 2 | P0-C T7.5.1 WIF viewer grant | ✅ T7.5 + apply (gate operativo) |
| 4 | P1-R4-2 Memorystore HA | ✅ T1 |
| 4 | P1-R4-3 normalizePhone helper | ✅ T2 |
| 4 | P1-R4-4 Drizzle migration ordering | ✅ T3 |

## Incidentes paralelos descubiertos durante Sprint 1

| Incidente | Origen | PR fix | Estado |
|---|---|---|---|
| SMS fallback gateway `WEBHOOK_PUBLIC_URL=''` (17d outage) | T0b investigation | [#317](https://github.com/boosterchile/booster-ai/pull/317) `aa1cf4b` | ✅ Resuelto (curl 403, 0 logs CRITICAL post-fix) |

## Drift residual aceptado

- **`google_monitoring_dashboard.telemetry_overview`**: 1 modify pendiente, cosmetic JSON formatter. Sin impacto runtime; se propagará en próximo `terraform apply` (Sprint 2).
- **`.specs/sec-001-cierre/{plan,spec}.md`**: meta-references al literal `BoosterDemo2026!` que describen la deuda que SE LIMPIÓ. Fuera del scope SC-1.4.4 (que es "código + docs + handoffs + infra").
- **`.specs/sec-001-cierre/sprint-1-evidence/t0-terraform-plan-strict-gate-FAILED.txt`**: frozen evidence del plan que disparó el split T0a/T0b. Rewriting falsificaría evidencia.

## Bloqueos abiertos para Sprint 2

1. **#STAGING-ENV**: backlog ticket para crear segundo GCP project con infra paralela. Bloquea flip prod `STRICT_MIGRATION_ORDERING=true` cuando entren migrations nuevas.
2. **OQ-PLAN-7** (Sprint 1 deferred): Cloud Logging tiene el literal `BoosterDemo2026!` en logs históricos. Sprint 3 H1.5 forensia debe decidir si filtrar/redactar logs retroactivamente o aceptar como residual histórico.

## Métricas Sprint 1

- **PRs mergeados**: 12 (15 PRs total incluyendo evidence + docs + incidente paralelo).
- **Commits a main**: 14 squash commits.
- **LOC totales delta**: ~2,250 (código + tests + docs + IaC + evidence).
- **Tests añadidos**: ~28 nuevos tests unit + 4 archivos test extendidos. Suite api passa 1123/1125 (2 skipped pre-existentes).
- **Cobertura**: T4/T5/T6 logger redaction >97% stmts; T8 seed-demo 5 nuevos tests + setup global default; T9/T10 middleware 10 tests con mock Redis.
- **Tiempo calendar**: ~14h working compactos (~07:00 → ~21:30 PDT, 2026-05-24 → 2026-05-25 UTC).
- **Devils-advocate rounds**: 4 sobre el spec + 2 sobre el plan = 6 rounds total pre-build. 0 P0 abiertos al cierre.

## Cómo replicar la verificación

```bash
# Estado prod
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "content-type: application/json" \
  -d '{"persona":"shipper"}' "https://api.boosterchile.com/demo/login"
# espera: HTTP 404

curl -sS -o /dev/null -w "HTTP %{http_code}\n" "https://demo.boosterchile.com/demo"
# espera: HTTP 200 (maintenance page client-side render)

# git grep SC-1.4.4
git grep -F 'BoosterDemo2026' -- docs/ apps/ infrastructure/ packages/
# espera: 0 matches

# gcloud (requiere PO auth o ADC token):
gcloud secrets versions list demo-seed-password --project=booster-ai-494222
# espera: 2 versions (v1 placeholder + v2 real)

gcloud run revisions list --service=booster-ai-api --region=southamerica-west1 \
  --project=booster-ai-494222 --limit=3
# espera: latest revision con state CONDITION_SUCCEEDED + DEMO_SEED_PASSWORD env mount
```
