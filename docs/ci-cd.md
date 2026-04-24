# CI/CD Pipeline — Booster AI

Referencia técnica de los pipelines de integración y deploy. Ver [ADR-001](./adr/001-stack-selection.md) para decisiones de stack.

## Arquitectura

```
PR abierto / push a main
        ↓
┌───────────────────────────────────────┐
│  .github/workflows/ci.yml             │  ← bloqueante en PR
│    - Lint (Biome)                     │
│    - Format check                     │
│    - Typecheck (tsc)                  │
│    - Test + Coverage ≥80%             │
│    - Build                            │
└───────────────┬───────────────────────┘
                │
┌───────────────┴───────────────────────┐
│  .github/workflows/security.yml       │  ← bloqueante + schedule semanal
│    - gitleaks (scan histórico)        │
│    - npm audit (HIGH+)                │
│    - CodeQL (JS/TS)                   │
│    - Trivy (Dockerfiles + config)     │
│    - SBOM (CycloneDX)                 │
└───────────────┬───────────────────────┘
                │
                ▼ merge a main
┌───────────────────────────────────────┐
│  .github/workflows/release.yml        │
│    - Changesets version packages      │
│    - Deploy staging (auto)            │
│    - Deploy production                │
│      (GitHub Environment approval)    │
└───────────────┬───────────────────────┘
                │
                ▼ gcloud builds submit
┌───────────────────────────────────────┐
│  cloudbuild.staging.yaml              │
│  cloudbuild.production.yaml           │
│    - Build Docker imgs                │
│    - Push Artifact Registry           │
│    - Deploy Cloud Run                 │
│    - Canary 10% → 100% (prod)         │
│    - Smoke tests post-deploy          │
└───────────────────────────────────────┘
```

## Gates bloqueantes

| Gate | Umbral | Si falla |
|------|--------|----------|
| Biome lint | 0 errores, 0 warnings | Fix local + PR |
| Biome format | Match | `pnpm format` |
| tsc --noEmit | 0 errores | Corregir tipos |
| Vitest | Todos pasan | Corregir tests |
| Coverage lines | ≥80% | Añadir tests o justificar en PR |
| Coverage branches | ≥75% | Añadir tests de casos edge |
| Coverage functions | ≥80% | Añadir tests |
| gitleaks | 0 secretos | Remover secret + rotate |
| npm audit | 0 HIGH/CRITICAL | Upgrade deps o documentar issue |
| CodeQL | 0 alertas críticas | Investigar + fix |
| Trivy filesystem | 0 HIGH/CRITICAL | Upgrade base images |
| Build | Success | Corregir errores de build |

## Autenticación GCP (sin SA keys descargadas)

Lección aprendida de [SEC-2026-04-01 Booster 2.0](../../Booster-2.0/.agent/knowledge/SECURITY_INCIDENT_2026-04.md): **nunca descargar service account keys JSON**.

GitHub Actions → GCP usa **Workload Identity Federation**:

```yaml
permissions:
  id-token: write   # OIDC token

- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: projects/NNN/locations/global/workloadIdentityPools/github-actions/providers/github
    service_account: github-deployer@booster-ai.iam.gserviceaccount.com
```

La SA `github-deployer@` tiene solo los roles mínimos para deploy:
- `roles/run.admin` (Cloud Run)
- `roles/iam.serviceAccountUser` (impersonate runtime SA)
- `roles/cloudbuild.builds.editor`
- `roles/artifactregistry.writer`

NO tiene `Owner`, `Editor`, ni acceso a Secret Manager secrets. Deploy solo, no admin.

## Variables de repositorio requeridas

Configurar en `Settings → Secrets and variables → Actions`:

### Variables (públicas al workflow)

- `WIF_PROVIDER` — `projects/NNN/locations/global/workloadIdentityPools/github-actions/providers/github`
- `WIF_SERVICE_ACCOUNT_DEPLOY` — `github-deployer@booster-ai.iam.gserviceaccount.com`
- `STAGING_URL` — `https://staging.boosterchile.com`
- `PRODUCTION_URL` — `https://app.boosterchile.com`

### Secrets (sensibles)

Ninguno. La arquitectura evita secretos en GitHub gracias a WIF.

## Environments

Configurados en `Settings → Environments`:

- `staging` — sin approval requirements, auto-deploy tras CI verde.
- `production` — requires approval de al menos 1 reviewer + wait timer 10 min. Solo se despliega desde `main`.

## Playwright E2E

Por default no bloquea merge (ver `e2e-staging.yml`). Corre:
- En cada PR que toca `apps/web` o `apps/api`
- Nightly contra producción (regresión)
- On-demand via `workflow_dispatch`

Browsers: Chromium + WebKit + Mobile variants. Firefox puede añadirse cuando haya demanda real de usuarios — no hay regresión técnica al no tenerlo, Playwright lo soporta con `pnpm exec playwright install firefox` + añadir project al config.

## Dependabot

Configurado en `.github/dependabot.yml`:
- Update semanal (Lunes 06:00 Santiago)
- Grouping por ecosistema (react, hono, drizzle, etc.) para reducir ruido
- Major upgrades van a PR separado (review obligatorio)
- Security updates son inmediatos vía GitHub Security

## Runbooks de troubleshooting

### CI falla por coverage

1. Revisar artifact `coverage-report` descargado
2. Identificar archivos sin cobertura: `coverage/lcov-report/index.html`
3. Añadir tests siguiendo `skills/writing-tests/SKILL.md` (TODO — skill pendiente)
4. Si justificado excluir del umbral: añadir a `coverage.exclude` en `vitest.config.ts` con comentario

### Gitleaks detectó falso positivo

1. Investigar caso
2. Si realmente es falso positivo: añadir a `.gitleaks.toml` con `[allowlist]`
3. Si es real: seguir `skills/incident-response/SKILL.md`

### Deploy production falla

1. Canary ya aplicado pero falló validación → `gcloud run services update-traffic` revierte a versión anterior
2. Crear incidente SEV-2 via issue template
3. Seguir runbook específico del servicio en `docs/runbooks/`

## Referencias

- [ADR-001 Stack](./adr/001-stack-selection.md)
- [ADR-010 Modelo de identidad GCP](../../Booster-2.0/.agent/knowledge/ADR-010-identity-model.md) (lección Booster 2.0 sobre IAM IaC)
- Workload Identity Federation: https://cloud.google.com/iam/docs/workload-identity-federation
- Changesets: https://github.com/changesets/changesets
- Biome: https://biomejs.dev
