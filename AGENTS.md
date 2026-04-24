# AGENTS.md — Contrato cross-tool para agentes de IA

Este repo está diseñado para ser trabajado primariamente con **Claude** (ver [`CLAUDE.md`](./CLAUDE.md)), pero también es compatible con otros agentes (GitHub Copilot, Cursor, Windsurf, Codex CLI). Este archivo es el subconjunto estable y agnóstico de convenciones que cualquier agente debe respetar.

## Principios no negociables

1. **Zero tech debt desde day 0** — sin `any`, sin `console.*`, sin secretos, sin tests faltantes, sin infra manual.
2. **Evidence over assumption** — toda afirmación se respalda con output verificable.
3. **Type safety end-to-end** — desde Drizzle schema hasta UI.
4. **Observability por defecto** — Pino + OpenTelemetry en cada endpoint.
5. **Security por defecto** — Zod en boundaries, ADC en GCP, gitleaks en pre-commit.

## Estructura del repo

Ver [`CLAUDE.md`](./CLAUDE.md) sección "Estructura del repo" para el mapa completo.

## Stack fijo (ADR-001)

- **Runtime**: Node.js 22 LTS, pnpm + Turborepo
- **Backend**: Hono + Drizzle ORM + PostgreSQL + Redis
- **Frontend**: Vite + React 18 + TanStack Router + Tailwind + shadcn/ui
- **Shared**: Zod schemas en `packages/shared-schemas`
- **Logger**: Pino en `packages/logger`
- **AI**: Gemini con abstracción en `packages/ai-provider`
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
- Antes de una tarea compleja: consultar [`skills/`](./skills/) — puede haber un workflow definido.
- Antes de introducir una dependencia nueva: crear ADR.
- Al terminar una tarea: generar evidencia (test output, screenshots, curl, traces).

## Archivos protegidos

No modificar sin permiso explícito: `CLAUDE.md`, `docs/adr/*.md` (inmutables; se supersedan con nuevo ADR), `infrastructure/main.tf` en secciones críticas, `.github/workflows/*` en quality gates.

## Contacto

- **Product Owner**: Felipe Vicencio — `dev@boosterchile.com`
- **Repo**: `github.com/boosterchile/booster-ai`
- **GCP Project**: `booster-ai`
