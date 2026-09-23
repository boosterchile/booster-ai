# AGENTS.md — Índice cross-tool para agentes de IA

El contrato normativo —frontera de decisiones, ciclo de trabajo, frentes, evidencia y archivos protegidos— vive en [`CLAUDE.md`](./CLAUDE.md) y aplica a cualquier agente (Claude, Cursor, Copilot, Windsurf, Codex CLI). Este archivo es el índice estable: stack, comandos y el puntero a ese contrato.

## Principios no negociables

1. **Zero tech debt desde day 0** — sin `any`, sin `console.*`, sin secretos, sin tests faltantes, sin infra manual.
2. **Evidence over assumption** — toda afirmación se respalda con output verificable.
3. **Type safety end-to-end** — desde Drizzle schema hasta UI.
4. **Observability por defecto** — Pino + OpenTelemetry en cada endpoint.
5. **Security por defecto** — Zod en boundaries, ADC en GCP, gitleaks en pre-commit.

## Estructura del repo

Ver [`README.md`](./README.md) para el mapa del monorepo (apps en `apps/`, packages en `packages/`, Terraform en `infrastructure/`, specs en `.specs/`, ADRs en `docs/adr/`).

## Stack fijo (ADR-001)

- **Runtime**: Node.js 24, pnpm + Turborepo
- **Backend**: Hono + Drizzle ORM + PostgreSQL + Redis
- **Frontend**: Vite + React 18 + TanStack Router + Tailwind + shadcn/ui
- **Shared**: Zod schemas en `packages/shared-schemas`
- **Logger**: Pino en `packages/logger`
- **Infra**: Terraform sobre GCP (Cloud Run + Cloud SQL + Memorystore + Secret Manager)
- **CI/CD**: GitHub Actions con WIF
- **Linter/formatter**: Biome (reemplaza ESLint + Prettier)
- **Tests**: Vitest (unit/integration) + Playwright (e2e) + axe-core (a11y)

Cambios al stack requieren nuevo ADR.

## Comandos canónicos

```bash
pnpm install               # instalar dependencias
pnpm dev                   # dev server (todas las apps en paralelo)
pnpm lint                  # biome check
pnpm format                # biome format
pnpm typecheck             # tsc --noEmit en todos los packages
pnpm test                  # vitest run
pnpm test:e2e              # playwright test
pnpm build                 # build de producción
pnpm ci                    # lint + typecheck + test + build (what CI does)
```

## Convenciones de commit

Conventional Commits estricto: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `revert`. Commitlint lo aplica pre-commit.

## Cómo los agentes deben colaborar

- Antes de modificar código: leer [`CLAUDE.md`](./CLAUDE.md).
- El repo no usa `agent-rigor` ni `booster-skills`, y no activa plugins ni hooks de Claude Code (ADR-078).
- El agente no mergea a `main`. La protección de la rama son los checks (ADR-076). El gate humano queda en el deploy a producción.
- Antes de introducir una dependencia nueva: crear ADR.
- Al terminar una tarea: generar evidencia (test output, screenshots, curl, traces).

## Archivos protegidos

No modificar sin permiso explícito: `CLAUDE.md`, `docs/adr/*.md` (inmutables; se supersedan con nuevo ADR), `.github/workflows/*` en quality gates, y en `infrastructure/` cualquier `.tf` que declare IAM, Billing, service accounts, KMS o reglas de firewall — la regla se aplica por tipo de recurso, no por nombre de archivo.

## Contacto

- **Product Owner**: Felipe Vicencio — `dev@boosterchile.com`
- **Repo**: `github.com/boosterchile/booster-ai`
- **GCP Project**: `booster-ai-494222`
