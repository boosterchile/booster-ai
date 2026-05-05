# ADR-015 — Estrategia CI/CD: GitLab.com shared runners + criterio de migración a self-hosted

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: La configuración de GitHub Actions en `.github/workflows/*.yml` quedó inerte tras la migración del repo a GitLab.
**Related**: [ADR-001 Stack tecnológico](./001-stack-selection.md) (sección "Tooling y testing")

## Contexto

El repositorio Booster AI se migró desde GitHub a GitLab (`boosterchile-group/booster-ai`) en mayo de 2026. Los workflows en `.github/workflows/*.yml` (`ci.yml`, `security.yml`, `release.yml`, `e2e-staging.yml`) quedaron en el árbol del repo pero **no se ejecutan en GitLab** porque GitLab no procesa GitHub Actions.

Consecuencia inmediata observada en la sesión de fixes del 2026-05-04 / 2026-05-05: los 11 MRs cerrados (`!1`–`!11`) mergearon a `main` **sin verificación automática**. La política de proyecto `only_allow_merge_if_pipeline_succeeds` estaba en `false` porque no existía pipeline. La verificación se hizo manualmente en cada MR (typecheck + tests + lint local antes de cada merge), pero ese proceso no escala y choca con el principio "evidence over assumption" de CLAUDE.md.

Hay que elegir una **estrategia de runners de CI** definitiva para Booster AI. Las opciones evaluadas:

1. **GitLab.com shared runners (SaaS)** — los runners hosted que ofrece gitlab.com.
2. **Self-hosted runner en hardware del equipo** — `gitlab-runner` corriendo en el Mac de un dev o una VM dedicada.
3. **Self-hosted runner en infra dedicada** — `gitlab-runner` en GKE Autopilot (que ya existe en stack para `apps/telemetry-tcp-gateway`) o en una GCE VM administrada por Terraform.

El primer pipeline creado (`MR !12`, pipeline `2502512604`) falló inmediatamente con la razón:
```
The pipeline failed due to the user not being verified.
```

GitLab.com introdujo en 2023 un check anti-abuso que exige validación de cuenta (tarjeta de crédito **sin cargo**, o número de teléfono según país) antes de permitir el uso de shared runners. Es un setup once-and-done a nivel del usuario propietario del proyecto.

## Decisión

### Runners primarios: **GitLab.com shared runners (opción 1)**.

Concretamente: `saas-linux-small-amd64` (default), imagen `node:22-bookworm-slim` definida en `.gitlab-ci.yml`. Validación de cuenta del Product Owner completada como prerrequisito.

### Pipeline mínimo viable definido en `.gitlab-ci.yml`

Cuatro stages bloqueantes que replican el `ci.yml` original de GitHub Actions:

- `lint`: `pnpm lint` — Biome (lint + format en una pasada).
- `typecheck`: `pnpm typecheck` — `tsc --noEmit` por workspace.
- `test`: `pnpm test` — Vitest en cada workspace.
- `build`: `pnpm build` — `turbo run build` (depende de los 3 anteriores).

Triggers: `merge_request_event` y push a `main`. Tags reservados para futura release pipeline.

Cache: `.pnpm-store/` + `node_modules/` keyed por `pnpm-lock.yaml`.

### `only_allow_merge_if_pipeline_succeeds = true`

Activado a nivel proyecto inmediatamente después de mergear el `.gitlab-ci.yml`. Sin este flag, el archivo CI existe pero el gate sigue voluntario. Con el flag, GitLab rechaza merges con pipeline rojo.

### Criterio explícito de migración a self-hosted

GitLab.com free tier provee 400 minutos compartidos de pipeline por mes en el namespace. Esa cuota será suficiente para volúmenes razonables (~5-15 MRs/día con pipelines de 4-8 minutos).

**Migrar a self-hosted runner en GKE Autopilot (opción 3)** cuando se cumpla **cualquiera** de las siguientes:

1. Tres meses consecutivos con uso > 80% de la cuota mensual.
2. Tiempo de cola promedio (queued duration) > 5 min en pipelines de MR.
3. Necesitamos correr E2E con Playwright contra staging y los runners shared no alcanzan en tiempo (típicamente > 12 min por pipeline).
4. Necesitamos GPU/ARM o cualquier hardware específico no provisto por shared runners.
5. La organización pasa a TRL 10 y la auditoría requiere infra de CI dedicada bajo control corporativo.

Cuando se gatille la migración: nuevo ADR que supersede este, con módulo Terraform para el runner en GKE (~50-80 líneas de HCL, ya tenemos el cluster).

### Rollback explícito

Si por algún motivo (cambio de policy GitLab, pricing, regulación, etc.) los shared runners dejan de ser viables en plazo corto, el plan de fallback es:

1. Levantar un runner self-hosted en el Mac de un dev (~30 min: `brew install gitlab-runner`, `gitlab-runner register`).
2. Mientras tanto, el equipo verifica MRs localmente como se hizo en la sesión de fixes mayo 2026.
3. Migrar a infra dedicada en plazo de 1-2 sprints.

## Por qué GitLab.com shared runners y no self-hosted desde day 0

| Criterio | GitLab shared (elegido) | Self-hosted Mac local | Self-hosted GKE |
|---|---|---|---|
| Setup inicial | 5 min (validación cuenta) | 30 min (install + register) | 2-3 h (Terraform module + register) |
| Mantenimiento | nulo (GitLab lo gestiona) | alto (uptime de la Mac, updates, security patches) | medio (HCL + actualizaciones del runner) |
| Reliability | alta (SLA SaaS GitLab) | baja (single point of failure: la Mac) | alta (Autopilot maneja nodos) |
| Costo | $0 hasta 400 min/mes | $0 directos pero costo oculto en mantenimiento | ~$20-50/mes runner pequeño |
| Reversibilidad | trivial: cualquier momento sumamos un runner self-hosted como alternativa | trivial | trivial |
| Acoplamiento secrets/IAM | mínimo (CI vars de proyecto) | medio (key del runner en Mac, no rotada) | bajo (Workload Identity en GKE) |
| Aplica a TRL 10 audit | sí (SaaS auditado por GitLab) | no (laptop personal) | sí |

GitLab.com shared es la opción **menor deuda operacional para el volumen actual**, con criterio explícito y proporcional a la realidad para evolucionar a self-hosted cuando los datos de uso lo justifiquen — no cuando lo proyectemos especulativamente. Aplica el principio CLAUDE.md "Don't design for hypothetical future requirements".

Self-hosted en Mac local no es opción porque introduce un single point of failure del equipo (deuda operacional inmediata).

Self-hosted en GKE día 1 es over-engineering — agrega Terraform + IAM + monitoreo del runner antes de necesitarlo.

## Lo que este ADR **no** decide (alcance de futuros ADRs)

- **Pipeline de release / despliegue a Cloud Run**: tiene su propia cadena Cloud Build + tags. Se documentará en ADR cuando se implemente.
- **Pipeline E2E contra staging**: requiere `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` como CI vars (la fixture `apps/web/e2e/fixtures.ts` ya existe desde `!8`). Se agregará al `.gitlab-ci.yml` cuando staging esté listo y haya un user de test estable.
- **Security scanning** (gitleaks, npm audit, SAST): GitLab tiene SAST nativo distinto a CodeQL. Se evaluará en ADR específico de seguridad.
- **Coverage gate ≥80% bloqueante**: `vitest.config.ts` ya tiene los thresholds configurados pero falta wirear `pnpm test:coverage` como script root y un step de validación. MR aparte.

## Métricas de revisión

A los 90 días de mergeado este ADR, revisar en el panel de "Settings → CI/CD → Runners" del proyecto en GitLab:

- Minutos consumidos / mes (target < 320 min, esto es 80% de cuota free).
- Tiempo promedio de cola (target < 60s).
- Pipelines fallados por causa-no-de-código (timeouts, runner errors): target < 1%.

Si los tres se cumplen, mantener decisión. Si alguno falla, evaluar migración según los criterios listados arriba.

## Eliminación de los workflows GitHub Actions

Los archivos `.github/workflows/*.yml` quedan en el repo después de este ADR como **referencia histórica para migrar el resto de pipelines** (security, e2e, release). Una vez portados todos a `.gitlab-ci.yml`, se borrarán en MR final con justificación. Mientras tanto, el directorio `.github/` puede agregarse a `.gitlab/CODEOWNERS` o anotarse para evitar confusión a nuevos colaboradores.
