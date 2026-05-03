# Claude Code Workflow — Operación en terminal para Booster AI

> Guía operativa **paso a paso** para trabajar este repo con Claude Code (CLI). Asume que vienes desde Claude.ai y ahora operas en terminal sobre el código vivo.

**Última revisión**: 2026-05-03

---

## Tabla de contenido

1. [Bootstrap del entorno](#1-bootstrap-del-entorno)
2. [Anatomía del repo para el agente](#2-anatom%C3%ADa-del-repo-para-el-agente)
3. [Slash commands disponibles](#3-slash-commands-disponibles)
4. [Skills y agents](#4-skills-y-agents)
5. [Playwright MCP — funciones activas](#5-playwright-mcp--funciones-activas)
6. [Workflow típico de feature (de spec a ship)](#6-workflow-t%C3%ADpico-de-feature-de-spec-a-ship)
7. [Workflow de hotfix](#7-workflow-de-hotfix)
8. [Workflow de ADR](#8-workflow-de-adr)
9. [Comandos pnpm canónicos](#9-comandos-pnpm-can%C3%B3nicos)
10. [Git, branches y PRs](#10-git-branches-y-prs)
11. [Validación E2E con Playwright](#11-validaci%C3%B3n-e2e-con-playwright)
12. [Despliegue (staging/prod)](#12-despliegue-stagingprod)
13. [Troubleshooting frecuente](#13-troubleshooting-frecuente)
14. [Anti-patrones que NO debes ejecutar](#14-anti-patrones-que-no-debes-ejecutar)

---

## 1. Bootstrap del entorno

### 1.1 Pre-requisitos del host

```bash
# Versión de Node (pin via .nvmrc)
node --version   # debe ser >=22.0.0
nvm use          # si tienes nvm

# pnpm
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm --version   # >=9.0.0

# Docker (Postgres + Redis locales)
docker --version
docker compose version

# gcloud (opcional, solo para integraciones GCP local)
gcloud --version
```

### 1.2 Primera vez en el repo

```bash
git clone git@github.com:boosterchile/booster-ai.git
cd booster-ai

# Instalar dependencias del monorepo
pnpm install

# Servicios locales (Postgres + Redis)
docker compose -f docker-compose.dev.yml up -d

# Variables de entorno
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Editar cada .env según las instrucciones del .env.example

# Migraciones BD
pnpm --filter @booster-ai/api db:migrate

# Smoke test: dev server arriba
pnpm dev
# api → http://localhost:3000
# web → http://localhost:5173
```

### 1.3 Arrancar Claude Code en este repo

```bash
cd /ruta/a/booster-ai
claude
```

Al iniciar, el hook `hooks/session-start.md` se invoca y obliga al agente a:
1. Leer `CLAUDE.md`.
2. Listar ADRs (`ls -lt docs/adr/`).
3. Revisar `skills/`, `git status`, `git branch --show-current`.
4. Confirmar contexto antes de cualquier escritura.

> Si saltas la sesión sin estos pasos, perdiste el contrato del proyecto.

---

## 2. Anatomía del repo para el agente

```
booster-ai/
├── CLAUDE.md                 # contrato de trabajo (principios inviolables)
├── AGENTS.md                 # subset cross-tool (Copilot/Cursor)
├── AUDIT.md                  # estado real del código (single source of truth)
├── HANDOFF.md                # estado vivo, sprints cerrados, próximos pasos
├── README.md                 # quick start
├── DESIGN.md                 # sistema de marca, personas, diseño visual
├── PLAN-PHASE-0.md           # roadmap fundacional (fases 0-6)
│
├── .claude/
│   ├── commands/             # slash commands (/spec /plan /build /test /review /ship /e2e /handoff)
│   └── settings.json         # permisos del agente
├── .mcp.json                 # MCP servers (Playwright)
│
├── skills/                   # workflows estructurados (carbon, matching, ADR, etc.)
├── agents/                   # personas reutilizables (code-reviewer, security-auditor, sre-oncall)
├── hooks/                    # session-start hook
├── references/               # checklists testing/security/perf/a11y
├── runbooks/                 # procedimientos one-off
├── playbooks/                # decisiones de producto
│
├── docs/
│   ├── adr/                  # 14 ADRs (001-014) — decisiones cerradas
│   ├── ci-cd.md              # pipeline doc
│   ├── runbooks/             # ops runbooks
│   ├── specs/                # specs por feature (creados via /spec)
│   └── CLAUDE-CODE-WORKFLOW.md  # este archivo
│
├── apps/                     # 8 servicios (5 funcionales + 3 skeleton)
├── packages/                 # 17 packages (8 funcionales + 2 MVP + 7 placeholder)
├── infrastructure/           # Terraform 100% IaC
├── scripts/                  # scripts de dev/deploy
└── .github/workflows/        # CI/CD GitHub
```

**Archivos protegidos** (no tocar sin permiso explícito):
- `CLAUDE.md`, `AGENTS.md`, `docs/adr/*.md`, `infrastructure/main.tf` en IAM/billing, `.github/workflows/*.yml` en quality gates, Secret Manager secrets.

---

## 3. Slash commands disponibles

Los slash commands viven en `.claude/commands/*.md`. Ejecutas `/<nombre>` desde Claude Code y el agente sigue el flujo definido.

| Comando | Cuándo usar | Output esperado |
|---------|-------------|-----------------|
| `/spec` | Antes de cualquier feature, fix no trivial, o cambio de contrato | `docs/specs/<YYYY-MM-DD>-<slug>.md` con problema, solución, criterios de aceptación, no-goals, riesgos, plan testing, rollout |
| `/plan` | Después de spec aprobado, antes de codificar | Plan técnico con arquitectura, archivos a tocar, secuencia de commits |
| `/build` | Después de plan aprobado | Implementación en commits Conventional Commits, cada uno compilando y pasando tests |
| `/test` | Después de build | `pnpm ci` + coverage 80%+ + E2E relevantes + evidencia por exit criterion |
| `/review` | Antes de pedir review humano | Auto-review con agent `code-reviewer`, fix issues encontrados |
| `/ship` | Después de test + review | Pre-deploy checklist, merge a main, verificación post-deploy |
| `/e2e` | Cuando necesitas validar UI con Playwright MCP | Navegación, snapshots, assertions, evidencia en `apps/web/playwright-report/` |
| `/handoff` | Al cerrar un sprint mayor | Actualiza `HANDOFF.md` con estado nuevo, sprints cerrados, próximos pasos |

> Cada comando tiene su `.md` con proceso detallado, anti-rationalizations y exit criteria. Léelo antes de invocar si es la primera vez.

---

## 4. Skills y agents

### 4.1 Skills (`skills/<nombre>/SKILL.md`)

Workflows reutilizables para operaciones específicas:

| Skill | Cuándo invocar |
|-------|----------------|
| `using-agent-skills` | Meta-skill: cómo usar las demás skills |
| `writing-adrs` | Cuando necesitas escribir un ADR nuevo (ADR-015+) |
| `adding-cloud-run-service` | Al añadir un nuevo servicio Cloud Run a infra Terraform |
| `carbon-calculation-glec` | Para integrar/extender cálculo GLEC v3.0 |
| `empty-leg-matching` | Para iterar el algoritmo de matching de retornos vacíos |
| `incident-response` | Durante un incidente activo en producción |
| `playwright-e2e` | Para escribir/ejecutar tests Playwright con MCP |

### 4.2 Agents (`agents/<nombre>.md`)

Personas reutilizables que el agente principal puede invocar:

| Agent | Uso |
|-------|-----|
| `code-reviewer` | Auto-review pre-PR; segundo par de ojos antes del review humano |
| `security-auditor` | Para `/security-review` o auditoría de cambios sensibles |
| `sre-oncall` | Durante incidentes; runbook diagnóstico |

---

## 5. Playwright MCP — funciones activas

Booster AI tiene **Playwright MCP server** configurado en `.mcp.json`. Esto le da a Claude Code acceso directo a un navegador automatizado para:

### 5.1 Funciones disponibles

| Categoría | Funciones |
|-----------|-----------|
| **Navegación** | abrir URL, atrás/adelante, recargar, esperar carga, multi-tab |
| **Interacción** | click, type, fill, select option, drag&drop, hover, keyboard, file upload |
| **Snapshots** | accessibility tree (sin necesidad de capturas pesadas), DOM snapshot, screenshot full-page o por elemento |
| **Aserciones** | wait_for_selector, expect_visible, expect_text, eval JS arbitrario |
| **Diagnóstico** | console messages, network requests/responses, page errors, performance metrics |
| **Browsers** | Chromium (default), Firefox, WebKit, mobile Chrome (Pixel 5), mobile Safari (iPhone 13) |
| **Trazas** | record video on failure, trace.zip retain-on-failure (configurado en `playwright.config.ts`) |

### 5.2 Cuándo usar Playwright MCP vs Vitest

| Situación | Tool |
|-----------|------|
| Validar lógica pura (calculator, parser) | Vitest unit |
| Validar handler de API con DB | Vitest integration |
| Validar flujo de UI completo (login → publicar carga → ver oferta) | **Playwright MCP** |
| Validar regresión visual en `apps/web` | **Playwright MCP** + screenshots |
| Smoke test post-deploy de staging | **Playwright MCP** apuntando a la URL de staging |
| Test de accesibilidad WCAG 2.1 AA | **Playwright MCP** + `@axe-core/playwright` |

### 5.3 Patrón típico

```bash
# Tener dev server arriba
pnpm --filter @booster-ai/web dev

# En otra terminal/sesión Claude Code
# Invocar /e2e o pedirle al agente que use Playwright MCP
# Agente abre navegador headless, navega, snapshotea, asserta
```

Para tests guardados que se corren en CI, viven en `apps/web/e2e/*.spec.ts` y se ejecutan con:

```bash
pnpm --filter @booster-ai/web test:e2e
pnpm --filter @booster-ai/web test:e2e -- --grep "<feature>"
pnpm --filter @booster-ai/web test:e2e --project=mobile-chrome
pnpm --filter @booster-ai/web test:e2e --debug      # debugger UI
pnpm --filter @booster-ai/web test:e2e --ui         # UI mode
pnpm --filter @booster-ai/web test:e2e --headed     # ver el browser
```

> **Permisos**: el MCP de Playwright tiene scope project-level vía `.mcp.json`. Para correr tests CI, usa los scripts `pnpm` (no MCP).

---

## 6. Workflow típico de feature (de spec a ship)

### 6.1 Diagrama

```
[Idea] → /spec → [docs/specs/...md] → revisión humana
                                          ↓
                                       /plan → revisión humana
                                                 ↓
                                              /build → commits Conventional
                                                         ↓
                                                       /test → evidencia
                                                                ↓
                                                             /review → fix issues
                                                                         ↓
                                                                       /ship → merge + deploy
                                                                                 ↓
                                                                              /handoff → HANDOFF.md actualizado
```

### 6.2 Ejemplo concreto: añadir endpoint POST `/cargas/:id/cancelar`

```bash
# 1. Spec
claude
> /spec POST /cargas/:id/cancelar permite al shipper cancelar una carga publicada antes de que sea aceptada
# Genera docs/specs/2026-05-03-cargas-cancelar.md
# Pedir aprobación del Product Owner antes de seguir

# 2. Plan
> /plan
# Genera plan: schema Zod, ruta API, service, transición state machine, tests

# 3. Build (en branch nuevo)
> /build
# Crea branch feat/cargas-cancelar
# Commits: feat(schemas), feat(api), test(api)

# 4. Test
> /test
# Corre pnpm ci, coverage, E2E si toca UI

# 5. Review
> /review
# Invoca code-reviewer agent

# 6. Ship
> /ship
# Crea draft PR, posiciona para review humano, deploy tras merge
```

---

## 7. Workflow de hotfix

Para un bug en producción que requiere fix urgente:

```bash
# 1. Crear branch desde main
git checkout main && git pull
git checkout -b fix/<slug>

# 2. Reproducir bug + escribir test que falle
pnpm test --filter <pkg> -- --grep "<bug>"

# 3. Fix mínimo
# 4. Verificar test pasa
pnpm ci

# 5. PR con etiqueta `hotfix`
# 6. /ship con canary forzado
```

> Saltar `/spec` solo si el bug tiene reproducción y causa raíz claras en <5 líneas (criterio del slash command `/spec`).

---

## 8. Workflow de ADR

Cuando una decisión tiene impacto futuro (nuevo stack, patrón, contrato público):

```bash
# 1. Invocar skill writing-adrs
> Necesito escribir ADR para <decisión>

# 2. Skill genera docs/adr/0XX-<slug>.md con secciones:
#    - Context, Decision, Status, Consequences, Alternatives, Related ADRs

# 3. PR con título docs(adr): ADR-0XX <slug>
# 4. Aprobación humana antes de merge
```

> ADRs son **inmutables**. Para cambiar una decisión existente, se crea un ADR nuevo que la `Supersede`.

**ADRs candidatos detectados** (ver `HANDOFF.md` §3): KMS RSA-4096 signing, Web Push VAPID, SSE chat, Pub/Sub chat-messages, Workbox PWA.

---

## 9. Comandos pnpm canónicos

```bash
# Dev
pnpm dev                              # todas las apps en paralelo
pnpm --filter @booster-ai/api dev     # solo una app

# Calidad
pnpm lint                             # Biome check
pnpm lint:fix                         # Biome auto-fix
pnpm format                           # Biome format
pnpm typecheck                        # tsc --noEmit en todos los packages
pnpm test                             # Vitest unit + integration
pnpm test:coverage                    # con coverage
pnpm test:e2e                         # Playwright
pnpm build                            # build de producción
pnpm ci                               # lint + typecheck + test + build (gate completo)

# Security
pnpm security:scan                    # gitleaks full repo
pnpm security:scan-staged             # gitleaks staged

# Filtros útiles
pnpm --filter @booster-ai/api ...     # operar solo en api
pnpm --filter '@booster-ai/*' ...     # operar en todos los packages booster
pnpm --filter './packages/*' ...      # operar en todos los packages
pnpm --filter '...{packages/shared-schemas}' ...   # incluir dependientes

# DB
pnpm --filter @booster-ai/api db:migrate
pnpm --filter @booster-ai/api db:generate
pnpm --filter @booster-ai/api db:studio
```

---

## 10. Git, branches y PRs

### 10.1 Branches

| Tipo | Patrón | Ejemplo |
|------|--------|---------|
| Feature | `feat/<slug>` | `feat/cargas-cancelar` |
| Fix | `fix/<slug>` | `fix/oferta-doble-aceptacion` |
| Chore | `chore/<slug>` | `chore/bump-vitest` |
| Docs | `docs/<slug>` | `docs/adr-015-kms-signing` |
| Refactor | `refactor/<slug>` | `refactor/matching-to-package` |

`main` está protegida — todo cambio entra por PR.

### 10.2 Commits Conventional

```
feat(api): add POST /cargas/:id/cancelar
fix(matching): handle empty candidate list without crashing
chore(deps): bump vitest to 2.1
docs(adr): ADR-015 KMS RSA-4096 signing
refactor(api): move matching algorithm to packages/
test(carbon): cover edge cases in modelado mode
```

Commitlint pre-commit lo aplica.

### 10.3 PRs

Título Conventional Commits. Body con secciones obligatorias:

```markdown
## Resumen
1-3 bullets

## Cambios
- archivo1.ts:42 — qué cambió
- archivo2.tsx:120-145 — qué cambió

## Evidencia
- Tests: <output de `pnpm test`>
- Coverage: <output de `pnpm test:coverage`>
- Lint: 0 errores
- Typecheck: 0 errores
- Manual / E2E: <screenshot, curl, trace>

## ADR compliance
- [x] No introduce `any`
- [x] No introduce `console.*`
- [x] Tests presentes
- [x] Logger + OTel donde aplica
```

PRs siempre se crean **draft primero**. Marcar ready cuando CI verde + evidencia completa.

---

## 11. Validación E2E con Playwright

### 11.1 Estructura

```
apps/web/
├── playwright.config.ts          # 4 projects: chromium, mobile-chrome, webkit, mobile-safari
├── e2e/
│   ├── auth.spec.ts              # (a crear) login + RoleGuard
│   ├── shipper-publicar-carga.spec.ts
│   ├── carrier-aceptar-oferta.spec.ts
│   ├── driver-live-tracking.spec.ts
│   ├── certificados-flow.spec.ts
│   └── chat-realtime.spec.ts
└── playwright-report/            # reporte HTML (gitignored)
```

### 11.2 Ejemplo de spec

```ts
import { test, expect } from '@playwright/test';

test.describe('Shipper publicar carga', () => {
  test('flujo completo desde login hasta carga publicada', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('shipper@test.cl');
    await page.getByLabel('Password').fill('test123');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await page.waitForURL('/app/cargas');
    await page.getByRole('button', { name: 'Publicar carga' }).click();

    await page.getByLabel('Origen').fill('Santiago');
    await page.getByLabel('Destino').fill('Valparaíso');
    await page.getByLabel('Peso (kg)').fill('1500');
    await page.getByRole('button', { name: 'Publicar' }).click();

    await expect(page.getByText('Carga publicada')).toBeVisible();
  });
});
```

### 11.3 Correr

```bash
# Local con dev server auto-iniciado (webServer en config)
pnpm --filter @booster-ai/web test:e2e

# Solo un proyecto (browser)
pnpm --filter @booster-ai/web test:e2e --project=chromium

# Solo un test
pnpm --filter @booster-ai/web test:e2e -- --grep "publicar carga"

# UI mode (recomendado para escribir nuevos tests)
pnpm --filter @booster-ai/web test:e2e --ui

# Contra staging
BASE_URL=https://staging.boosterchile.com pnpm --filter @booster-ai/web test:e2e
```

### 11.4 A11y con axe-core

```ts
import AxeBuilder from '@axe-core/playwright';

test('home cumple WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

### 11.5 MCP vs scripts

- **MCP** (durante una sesión Claude Code): exploración interactiva, generar nuevos tests, validar fix puntual.
- **Scripts pnpm** (CI + local repetible): tests guardados que se corren en cada PR.

Ambos coexisten. El MCP genera código que termina commiteado como spec en `apps/web/e2e/`.

---

## 12. Despliegue (staging/prod)

### 12.1 Estado actual

| Environment | Estado | Pipeline |
|-------------|--------|----------|
| **prod** | ✅ Operativo | `cloudbuild.production.yaml` (paralelo, 6 imágenes) |
| **staging** | ❌ Pendiente | `cloudbuild.staging.yaml` deshabilitado (GCP project a crear) |

### 12.2 Producción (hoy)

Trigger: push a `main` con cambios en `apps/*` o `packages/*`.

```bash
# Manual (con permisos GCP)
gcloud builds submit --config=cloudbuild.production.yaml .

# O por GitHub Actions release.yml (Changesets + WIF)
```

Imágenes deployadas:
- Cloud Run: `api`, `whatsapp-bot`, `web`, `marketing` (placeholder), `matching-engine` (placeholder), `telemetry-processor`, `document-service` (placeholder).
- GKE Autopilot: `telemetry-tcp-gateway` (con `kubectl set image`).

### 12.3 Phase-2 (telemetría TCP)

```bash
./deploy-phase-2.sh
# Orquesta: pnpm install, typecheck/test, git push, GKE setup one-time,
#          gcloud builds submit, imprime EXTERNAL-IP del LB TCP
```

### 12.4 Cloud Run Jobs (one-shot)

```bash
gcloud builds submit --config=cloudbuild.merge-job.yaml .
gcloud run jobs execute merge-duplicate-users --region=southamerica-west1
```

### 12.5 Verificación post-deploy

```bash
# Health checks
curl https://api.boosterchile.com/health
curl https://app.boosterchile.com/health

# Logs en vivo
gcloud run services logs tail api --region=southamerica-west1
kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail=100 -f
```

---

## 13. Troubleshooting frecuente

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `pnpm install` rechaza | Node version | `nvm use` (o `corepack enable`) |
| `pnpm ci` falla en typecheck | Cambio en `shared-schemas` no propagado | `pnpm --filter @booster-ai/shared-schemas build` |
| Drizzle migrate falla con "lock held" | Otra instancia corriendo migrate | Esperar 30s, advisory lock se libera |
| Playwright falla con "browser not found" | Browsers no instalados | `pnpm --filter @booster-ai/web exec playwright install --with-deps` |
| Coverage <80% inesperado | Test nuevo no cubre el código nuevo | Ver reporte HTML: `pnpm test:coverage` y abrir `coverage/index.html` |
| Biome marca `any` en código de tests | Excepción no documentada | Añadir comentario `// biome-ignore lint/suspicious/noExplicitAny: <reason>` |
| Push rechazado por gitleaks | Posible secreto en commit | Revisar diff: `gitleaks protect --staged --verbose --redact` |
| Pre-commit hook tarda >30s | lint-staged corriendo Biome en archivos grandes | Aceptar, NO usar `--no-verify` |
| MCP Playwright no responde | Browsers no instalados o npm cache corrupto | `pnpm --filter @booster-ai/web exec playwright install`; reiniciar Claude Code |

---

## 14. Anti-patrones que NO debes ejecutar

| ❌ NO | ✅ SÍ |
|------|------|
| `git commit --no-verify` | Investigar por qué falla el hook y arreglar |
| `git push --force` a `main` | `git push --force-with-lease` solo a feature branches |
| `git reset --hard origin/main` con cambios pendientes | `git stash` primero, evaluar si recuperar |
| `--amend` un commit ya pusheado | Crear commit nuevo (el remoto tiene el viejo) |
| Bypass de coverage gate (`COVERAGE_MIN=0`) | Subir tests al 80%+ o documentar exención en spec |
| Editar `docs/adr/00X-*.md` | Crear nuevo ADR que `Supersede` |
| Usar `any` "porque el tipo es complicado" | Crear Zod schema que represente el tipo |
| Logging con `console.log` | Usar `@booster-ai/logger` |
| Crear secret nuevo desde código | Crear vía Terraform o consola GCP, referenciar en code |
| Tocar `infrastructure/main.tf` IAM directamente | PR revisado con justificación |
| Implementar lógica en `apps/<x>/services/` que es algoritmo puro | Crearla en `packages/<algoritmo>` |
| Asumir estado del repo desde memoria de entrenamiento | Leer `git status`, `git log`, archivos relevantes |

---

## Apéndice A — Referencia rápida de archivos clave

| Archivo | Para qué |
|---------|----------|
| `CLAUDE.md` | Principios inviolables, decisiones de cuándo preguntar/ejecutar |
| `AGENTS.md` | Subset cross-tool (Copilot/Cursor) |
| `AUDIT.md` | Estado real del repo (single source of truth) |
| `HANDOFF.md` | Estado vivo, sprints cerrados, próximos pasos |
| `DESIGN.md` | Sistema de marca, personas, estética |
| `PLAN-PHASE-0.md` | Roadmap fundacional fase 0-6 |
| `docs/adr/00X-*.md` | Decisiones arquitectónicas (inmutables) |
| `docs/specs/YYYY-MM-DD-<slug>.md` | Specs por feature |
| `skills/<nombre>/SKILL.md` | Workflows reutilizables |
| `agents/<nombre>.md` | Personas reutilizables |
| `runbooks/<nombre>.md` | Procedimientos one-off con snapshot |
| `playbooks/<nombre>.md` | Decisiones de producto |
| `references/<x>.md` | Checklists testing/security/perf/a11y |

---

## Apéndice B — Comandos de un agente nuevo en sesión 1

```bash
# Sesión 1 de un agente nuevo en el repo
claude

# Dentro de Claude Code, lee en orden:
> Lee CLAUDE.md
> Lee AUDIT.md
> Lee HANDOFF.md
> Lista docs/adr/ y lee los relevantes para mi tarea
> git status && git branch --show-current
> ls skills/

# Luego confirma:
> "He leído el contrato. Branch actual: <X>. Tarea: <Y>. Skill aplicable: <Z>. ¿Procedo?"
```
