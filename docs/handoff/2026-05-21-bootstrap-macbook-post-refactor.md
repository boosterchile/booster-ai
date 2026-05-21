# Bootstrap MacBook post-refactor sistema de desarrollo (2026-05-21)

**Audiencia**: Felipe Vicencio (PO) — handoff cross-machine para continuar el trabajo en MacBook tras el cierre del refactor sistema de desarrollo (PR-2 #312 + PR-2.5 #313).

**Pre-requisito**: el repo `boosterchile/booster-ai` está en `main` con squash commits `9127b44` + `4aef43d`. Plugins `agent-rigor@0.2.0` + `booster-skills@0.1.0` están publicados en GitHub.

**Tiempo estimado**: 20-30 min de setup limpio.

---

## ¿Qué viaja y qué no al MacBook?

| Categoría | Viaja vía git? | Acción en MacBook |
|---|---|---|
| Código + docs + ADRs + `.specs/` + `agents/` raíz + `CLAUDE.md` | ✅ Sí (en main) | Solo `git clone` |
| `.claude/settings.json` (declara plugins enabledPlugins) | ❌ No (gitignored) | Recrear via `/plugin install` con project scope |
| `.claude/ledger/` (historial de sesiones agent-rigor) | ❌ No | Empieza fresco — cada sesión genera su propio `.jsonl` |
| `.claude/worktrees/` (git worktrees parallel del Mac mini) | ❌ No | No necesario en MacBook si trabajás directo en main |
| `.claude/staging/` (workaround pattern) | ❌ No | Se crea cuando lo necesites |
| Plugins instalados (`~/.claude/plugins/cache/*`) | ❌ No (user scope global) | Reinstalar en MacBook |
| OAuth token gh (en macOS keychain) | ❌ No (per-machine) | `gh auth login --web` fresh en MacBook |
| SSH keys (`~/.ssh/`) | ❌ No | Generar nueva O copiar manual si querés mismo identity |
| Variables de entorno + secretos (.env*) | ❌ No (gitignored) | Setup según `.env.example` |

---

## Setup paso a paso

### 1. Pre-requisitos del sistema MacBook

```bash
# Verificar versions
node --version              # debe ser ≥ 22 (per .nvmrc del repo)
pnpm --version              # debe ser ≥ 9
git --version               # cualquier ≥ 2.40 está bien
gh --version                # GitHub CLI
```

Si falta algo:

```bash
# Homebrew (si no está)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node 22 vía nvm (recomendado) o brew
brew install nvm
nvm install 22
nvm use 22

# pnpm
brew install pnpm

# gh CLI
brew install gh

# (opcional) Google Cloud SDK si vas a tocar prod DB
brew install --cask google-cloud-sdk
```

### 2. Clonar repo Booster AI

```bash
cd ~/code  # o donde prefieras
git clone https://github.com/boosterchile/booster-ai.git
cd booster-ai

# Verificar que estás en main con el commit más reciente
git log --oneline -3
# Esperado:
#   4aef43d docs(handoff): cierre refactor sistema de desarrollo PR-2 en CURRENT.md
#   9127b44 chore(claude): integrate booster-skills plugin and cleanup local components
#   c1122b6 chore: delete diagnostic test workflow file (PAT verification cleanup)
```

### 3. Instalar Claude Code CLI

```bash
# Desde Anthropic (referencia: https://docs.anthropic.com/claude-code/installation)
brew install --cask claude  # macOS via Homebrew
# o descarga directa desde https://claude.com/download

# Verificar instalación
claude --version

# Autenticar (subscription o API key)
claude auth login
# Sigue el flujo del browser
```

### 4. Autenticar `gh` CLI (resuelve el path-to-push del agente)

```bash
# Login OAuth (mismo flow que en el Mac mini)
gh auth login --hostname github.com --git-protocol https --web

# Te muestra un código de 8 caracteres
# Abrís https://github.com/login/device → pegás código → Authorize
# gh detecta y guarda el OAuth token automáticamente

# Verificar
gh auth status
# Esperado: token gho_* con scopes 'gist', 'read:org', 'repo', 'workflow'
```

Esto evita el problema del PAT fine-grained mal-scopeado que pelamos en sesión 2026-05-21 (ver `docs/handoff/CURRENT.md` §Refactor sistema de desarrollo Booster).

### 5. Instalar plugins de Claude Code

```bash
# Desde el directorio booster-ai (project root)
cd ~/code/booster-ai

# Levanta Claude Code en este proyecto
claude
```

Dentro de la sesión Claude Code:

```
/plugin marketplace add boosterchile/best-skill-claude
/plugin marketplace add boosterchile/booster-skills

/plugin install agent-rigor@agent-rigor
/plugin install booster-skills@booster-skills

/reload-plugins

# Verificar
/plugin list
```

Output esperado:

```
Installed plugins:

  ❯ agent-rigor@agent-rigor
    Version: 0.2.0
    Scope: user
    Status: ✔ enabled

  ❯ booster-skills@booster-skills
    Version: 0.1.0
    Scope: project   ← project scope porque corre en booster-ai
    Status: ✔ enabled
```

El `project` scope crea `.claude/settings.json` automáticamente con `enabledPlugins.booster-skills@booster-skills: true`. Ese archivo es gitignored — no afecta el repo.

### 6. Instalar dependencias del repo (Node)

```bash
cd ~/code/booster-ai
pnpm install

# Verificar build (no se cambia código, debe pasar limpio)
pnpm typecheck
pnpm lint
```

### 7. (Opcional) Setup gcloud para acceso a producción

Si vas a consultar DB de prod o staging:

```bash
gcloud auth login                                    # SSO browser flow
gcloud auth application-default login                # ADC para servicios
gcloud config set project booster-ai-prod            # o staging

# Verificar
gcloud auth list
gcloud config list
```

Ver detalles en memoria del proyecto: `reference_prod_db_headless_query.md` (IAP tunnel + psql para queries headless).

### 8. Verificación final — lectura de estado

```bash
# Estado del proyecto (live)
cat docs/handoff/CURRENT.md | head -100

# Contrato del agente
cat CLAUDE.md | head -50

# Plugins activos
claude
> /plugin list
> /agent-rigor:spec test-feature  # arranca el ciclo con un feature de prueba
```

---

## Quick reference — paths importantes

| Path | Qué hay |
|---|---|
| `CLAUDE.md` | Contrato del agente — leer SIEMPRE en sesión nueva |
| `docs/handoff/CURRENT.md` | Estado vivo — sprints abiertos, decisiones recientes |
| `docs/adr/049-claude-code-plugin-system-adoption.md` | Decisión 3-capas + §Replicabilidad |
| `docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md` | Mapping path antiguo → namespacing nuevo |
| `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` | Audit trail del plugin (ejemplo replicable) |
| `.specs/integrate-booster-skills-plugin/` | Audit trail completo PR-2 |
| `.specs/_followups/` | 3 stubs pendientes (v0.2.0 compliance Chile, ADR castellanización, branch protection squash) |
| `agents/` | 3 overrides locales Booster (code-reviewer, security-auditor, sre-oncall) |

---

## Recordatorios operacionales

### 1. **Rotar el PAT viejo** (post-PR-2 hygiene)

El PAT `github_pat_11B33SC5...` quedó visible en logs de la sesión 2026-05-21 (necesario para diagnóstico del 403). El nuevo OAuth token de gh lo reemplazó, pero el PAT viejo sigue activo en GitHub.

```
https://github.com/settings/personal-access-tokens
→ Buscar el PAT con prefijo github_pat_11B33SC5...
→ Click → Revoke (o Regenerate si querés mantenerlo activo con nuevo secret)
```

5 min, importante.

### 2. **Follow-up: configurar branch protection squash en GitHub**

El repo permite los 3 métodos de merge (merge commit / squash / rebase). El spec PR-2 §6.2 declara squash MANDATORIO pero no está enforceado a nivel plataforma.

Stub con instrucciones: `.specs/_followups/github-branch-protection-squash.md`. Tiempo: 5-10 min en GitHub UI.

### 3. **Follow-up: castellanizar 28 ADRs en inglés**

Stub: `.specs/_followups/castellanizar-adr-headers.md`. Trabajo mecánico (sed sobre headers `Status`/`Date` → `Estado`/`Fecha`). Sprint cleanup documental, bajo prioridad.

### 4. **Follow-up: migrar agents/ raíz al plugin v0.2.0**

Stub: `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`. Migrar contenido Chile compliance al plugin booster-skills v0.2.0 para eliminar los 3 overrides locales en `agents/`.

### 5. **Cleanup local del Mac mini** (cuando no vuelvas a usarlo)

El worktree `flamboyant-jones-42a39b` fue borrado al cierre de la sesión 2026-05-21. Otros worktrees siguen activos (agitated-faraday, cranky-nightingale, eager-sinoussi, etc.) y son para trabajo paralelo.

Branches locales del refactor (en origin repo, no en worktrees):
- `chore/integrate-booster-skills-plugin` (ya mergeado en main, branch remote borrado)
- `docs/current-md-pr-2-shipped` (idem)

Si querés limpiarlos:
```bash
git branch -D chore/integrate-booster-skills-plugin docs/current-md-pr-2-shipped
```

---

## Comandos primer día en MacBook (TL;DR)

```bash
# Setup (una vez)
brew install nvm pnpm gh                                        # si faltan
nvm install 22 && nvm use 22
cd ~/code && git clone https://github.com/boosterchile/booster-ai.git
cd booster-ai
gh auth login --hostname github.com --git-protocol https --web   # OAuth flow
brew install --cask claude                                       # Claude Code CLI
claude auth login                                                # auth Claude
pnpm install

# Verify
git log --oneline -3                                             # debe mostrar 4aef43d como HEAD
cat CLAUDE.md | head -30                                         # contrato del agente
cat docs/handoff/CURRENT.md | head -20                           # estado vivo

# Levantar Claude Code en el proyecto
claude

# Dentro de Claude Code:
#   /plugin marketplace add boosterchile/best-skill-claude
#   /plugin marketplace add boosterchile/booster-skills
#   /plugin install agent-rigor@agent-rigor
#   /plugin install booster-skills@booster-skills
#   /reload-plugins
#   /plugin list                                                 # confirma ambos enabled

# Si lookea bien, podés arrancar un nuevo ciclo:
#   /agent-rigor:spec <feature-slug>
```

---

## Issues conocidos / gotchas

| Gotcha | Mitigación |
|---|---|
| `gh auth login` con PAT fine-grained puede fallar push con 403 (sucedió esta sesión) | Usar `--web` flag → OAuth token con scopes amplios |
| `osxkeychain` puede cachear credentials viejos | Si hay 403 raro: `git credential-osxkeychain erase <<EOF\nprotocol=https\nhost=github.com\nEOF` |
| Worktrees del Mac mini fueron creados con branches efímeros | En MacBook no hay worktrees, trabajás directo en `main` o features nuevas |
| `.claude/` está gitignored — settings local de Claude Code NO viajan | Recrear con `/plugin install` con project scope |
| Squash merge no está enforceado en GitHub | Cuidado al hacer merge — siempre `gh pr merge --squash` |

---

## Después del setup — ¿qué hacer mañana?

Per CURRENT.md, los próximos prioritarios:

1. **Branch protection squash** (5-10 min, follow-up del refactor) — `.specs/_followups/github-branch-protection-squash.md`
2. **Sprint S1b** — production-readiness, activo
3. **Mini-Sprint 0** — R-001 OTel + R-005/R-006/R-009/R-014 + opcionales
4. **Fase 1.5 Terraform multi-env** — ADR-052, 6 fases
5. **Sub-spec tripstate-alignment** — pre-requisito para S2 Bloque B XState

Cuando arranque un feature nuevo, el ciclo recomendado:

```
/agent-rigor:spec <feature-slug>    # DEFINE
/agent-rigor:plan <feature-slug>    # PLAN
/agent-rigor:build                   # BUILD
/agent-rigor:test                    # VERIFY
/agent-rigor:review                  # REVIEW (cooling-off 30 min mandatorio post-build)
/agent-rigor:ship                    # SHIP (con squash mandatorio per CLAUDE.md §6)
```

El agente arquitecto-maestro (`booster-skills:arquitecto-maestro`) sigue disponible para diseñar Execution Plans complejos antes de `/spec`.

---

**Generado**: 2026-05-21 post mission_close del refactor sistema de desarrollo Booster.
**Sesión origen**: 4672f6ac-9aab-4d6b-ae07-2eeabdbad529 (ledger primario en Mac mini se perdió con worktree delete; el contenido relevante quedó en `.specs/integrate-booster-skills-plugin/` que sí persiste en main).
