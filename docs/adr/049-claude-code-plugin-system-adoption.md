# ADR-049 — Adopción del sistema de plugins de Claude Code

**Estado**: Accepted
**Fecha**: 2026-05-20
**Decider**: Felipe Vicencio (Product Owner)
**Supersedes**: [ADR-002](./002-skill-framework-adoption.md)
**Related**: [ADR-001](./001-stack-selection.md), [ADR-046](./046-historical-adr-numbering-collisions.md), [CLAUDE.md](../../CLAUDE.md)

---

## Contexto

ADR-002 (2026-04-23) adoptó el framework `addyosmani/agent-skills` para gobernar workflows del agente Claude. La estructura era:

- `skills/<name>/SKILL.md` (workflows)
- `agents/<name>.md` (sub-agents)
- `.claude/commands/{spec,plan,build,test,review,ship}.md` (slash commands)
- `hooks/session-start.md` (session lifecycle)
- `references/{checklist}.md` (referencia suplementaria)

Esta estructura vivía en cada repo localmente. Claude Code (CLI) introdujo en 2026 el sistema de plugins instalables que permite empaquetar y distribuir skills + agents + commands + hooks como unidades versionadas. Una sesión de Claude Code puede instalar N plugins y consumirlos vía namespacing (e.g., `/agent-rigor:spec`, `booster-skills:incident-response`).

En 2026-05-19 se completó una auditoría de uso interna que detectó:

- 6 de 7 skills locales del proyecto Booster NO eran auto-triggerables por falta de frontmatter YAML correcto.
- Bug `devops-sre` agent fantasma en `.claude/commands/review.md` que invocaba un agente inexistente.
- Drift entre múltiples fuentes (`skills/`, `.claude/skills/`, `agents/`, `.claude/agents/`) sin source-of-truth claro.

Adicionalmente, Felipe Vicencio (PO) tenía interés explícito en que esta arquitectura fuera replicable a otros proyectos sin re-trabajo.

## Decisión

Adoptar un **sistema de 3 capas** sobre plugins de Claude Code:

| Capa | Componente | Alcance | Repo |
|---|---|---|---|
| 1 | `agent-rigor@0.2.0` | Disciplina senior-engineering generalista (ciclo + hooks + sub-agents + ledger) | `boosterchile/best-skill-claude` |
| 2 | `booster-skills@0.1.0` | Dominio + stack + auditoría específicos Booster (7 skills + 6 sub-agents) | `boosterchile/booster-skills` |
| 3 | Proyecto local `.claude/` minimal | `settings.json` declara plugins; `ledger/` preserva historial; `worktrees/` parallel; `staging/` workaround pattern | `boosterchile/booster-ai` |

Complementariamente, mantener `agents/` raíz con overrides Booster locales documentados (3 archivos: `code-reviewer.md`, `security-auditor.md`, `sre-oncall.md`) hasta que su contenido se migre a `booster-skills@0.2.0` (tracked en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`).

Path canónico de specs: `.specs/<feature-slug>/{idea,spec,plan,verify,review,ship}.md` (definido por `agent-rigor`). Migración de `docs/specs/<date>-<slug>.md` queda como PR-3 separado.

## Consecuencias

### Positivas

- **Source-of-truth único** por workflow: cada skill vive en exactamente un plugin namespaced. Eliminado drift entre múltiples copias.
- **Replicabilidad cross-proyecto**: cualquier proyecto futuro puede instalar `agent-rigor` (genérico) y crear su propio plugin de dominio siguiendo el blueprint `booster-skills` (ver §Replicabilidad).
- **Auto-triggering fiable**: skills con frontmatter YAML correcto son detectables por Claude Code y se activan automáticamente cuando el usuario menciona keywords relevantes.
- **Versionado explícito**: cada plugin tiene `version` semántico, tag git, GitHub release. Upgrades son intencionales.
- **Hooks enforcement**: agent-rigor inyecta hooks anti-drift + cooling-off + ciclo forzado a nivel global; el proyecto Booster no necesita re-implementarlos.

### Negativas

- **2 plugins a mantener**: cada uno con su CHANGELOG y release cycle. Costo de coordinación entre versiones.
- **Drift potencial entre plugin y override local**: los 3 archivos en `agents/` raíz pueden divergir del plugin remoto si se actualiza uno sin el otro. Mitigado por OQ tracking en `.specs/_followups/`.
- **Curva de aprendizaje**: desarrolladores nuevos deben entender namespacing (`/agent-rigor:*` vs `booster-skills:*`) + precedencia de overrides locales.
- **Dependencia de Claude Code CLI**: la arquitectura asume Claude Code disponible. Otros agentes (Copilot, Cursor) no consumen plugins de este formato — requeriría adaptación si se cambia de herramienta.

## Replicabilidad — Crear un plugin equivalente para otro proyecto

La arquitectura de 3 capas (`agent-rigor` global + `<proyecto>-skills` plugin + `<proyecto>` local minimal) es replicable. Procedimiento de 5 pasos:

1. **Identificar las skills/agents específicos del proyecto** que merecen vivir en plugin. Criterios: estables (no cambian semana a semana), reusables (≥3 invocaciones razonables), no triviales (>1 paso de proceso). Las one-off van a `docs/runbooks/`, no a plugin.

2. **Construir directorio** `<proyecto>-skills/` con la estructura canónica:

   ```
   <proyecto>-skills/
   ├── .claude-plugin/
   │   ├── plugin.json       (schema: claude-code-plugin-manifest.json)
   │   └── marketplace.json  (schema: claude-code-marketplace.json)
   ├── README.md
   ├── CHANGELOG.md
   ├── LICENSE
   ├── skills/<skill>/SKILL.md   (frontmatter: name + description únicamente)
   └── agents/<agent>.md         (frontmatter: name + description + tools + model)
   ```

3. **Validar manifests** con parser auténtico (no regex casero):

   - `claude plugin validate .` (CLI oficial Anthropic)
   - PyYAML para frontmatters de SKILL.md y agents/*.md
   - `json.loads` (Python) o `jq` para `.claude-plugin/*.json`

4. **Publicar en GitHub**:

   - Inicializar repo + commit inicial con mensaje `feat: initial release v0.1.0`
   - Push a `https://github.com/<org>/<proyecto>-skills`
   - Tag `v0.1.0` + `gh release create v0.1.0 --generate-notes`

5. **Instalar y verificar** en Claude Code:

   - `/plugin marketplace add <org>/<proyecto>-skills`
   - `/plugin install <plugin-name>@<plugin-name>` (project scope si es específico del proyecto)
   - `/plugin list` confirma plugin activo
   - `/reload-plugins` carga skills/agents en la sesión actual

**Ejemplo trabajado completo** (decisiones de diseño, bugs encontrados, validaciones aplicadas, audit trail de cada skill/agent migrado): [`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../plugins/REPORTE-migracion-booster-skills-v0.1.0.md).

## Validación

Checklist para considerar esta decisión implementada correctamente:

- [x] `booster-skills@0.1.0` publicado en `github.com/boosterchile/booster-skills` (PR-1 cerrado 2026-05-20 15:41)
- [x] Plugin instalado con project scope; `/plugin list` muestra `booster-skills@booster-skills` ✓ enabled
- [x] `/reload-plugins` reporta `2 plugins · 9 skills · 23 agents · 6 hooks` (incluye `agent-rigor` + `booster-skills`)
- [x] 7 skills + 6 agents accesibles vía namespace `booster-skills:*` (validado empíricamente sesión 2026-05-20)
- [x] Tarball canónico vs plugin instalado: 18/18 archivos bit-perfect identical (SHA256 match)
- [ ] PR-2 cleanup ejecutado: `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `skills/`, `hooks/` borrados (esta misma PR la materializa)
- [ ] CLAUDE.md proyecto declara explícitamente las 3 capas + overrides locales (PR-2)

## Referencias

- [ADR-001](./001-stack-selection.md): stack-selection (Node.js 22 + Cloud Run + Hono + Drizzle).
- [ADR-002](./002-skill-framework-adoption.md): adopción inicial del framework local (superseded por este ADR).
- [ADR-046](./046-historical-adr-numbering-collisions.md): numeración ADR sin colisiones (un número por archivo desde ADR-040).
- [`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../plugins/REPORTE-migracion-booster-skills-v0.1.0.md): ejemplo trabajado de creación de plugin (audit trail completo).
- Anthropic Claude Code plugins docs: https://docs.anthropic.com/claude-code/plugins
- `addyosmani/agent-skills` (MIT): framework original del que se derivó `agent-rigor` + estructura de skills/agents.
