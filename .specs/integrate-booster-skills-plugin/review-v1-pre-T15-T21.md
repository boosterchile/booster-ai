# Review: integrate-booster-skills-plugin

- **Reviewer**: Felipe Vicencio + agent-rigor (code-reviewer + devils-advocate sub-agents)
- **Date**: 2026-05-21
- **Cooling-off respected**: Waiver granted ("ya releí todo en este chat + 4hrs rest" — ledger `waiver_granted` 2026-05-21T04:36)
- **Verdict**: **CHANGES_REQUESTED** — send back to BUILD for orphan refs + idioma header + .gitignore redundancia

---

## Five-axis review (code-reviewer sub-agent + verified empirically)

### Correctness

| Finding | Severidad | Evidencia |
|---|---|---|
| `.gitignore:131` `.claude/` ya ignora todo el directorio. Línea 139 `.claude/staging/` añadida en T8 es **redundante**. SC-19 pasa por grep literal pero no aporta nada operacional. | BLOQUEANTE leve | `grep -n "^\.claude" .gitignore` retorna 131 (.claude/) y 139 (.claude/staging/) |
| ADR-049 §Validación tiene 2 checklist items `[ ]` sin marcar sobre el propio PR-2 que esta materializa. | SUSTANTIVO | `docs/adr/049-...md` líneas 107-113. Se deben marcar `[x]` post-merge, o quedan como historical snapshot |
| Los 20 SCs internos pasan (26 PASS / 0 FAIL / 4 EXTERNAL) pero NO cubren un riesgo material: **orphan references en el resto del repo** | **BLOQUEANTE CRÍTICO** | Ver §Devils-advocate findings |

### Clarity

| Finding | Severidad | Evidencia |
|---|---|---|
| `CLAUDE.md:91-103` "Capas adicionales locales" asume que el lector entiende el mecanismo de resolución override del plugin Claude Code. | SUGGESTION | Sin link a doc oficial ni a test empírico |
| Falta nota explícita en CLAUDE.md de la transición v2→v3 ("Reemplaza §Principios rectores; ver ADR-049 §Lo que sobrevive") | SUGGESTION | Trazabilidad del delta no es inmediata sin abrir el ADR |

### Complexity

| Finding | Severidad | Evidencia |
|---|---|---|
| CLAUDE.md 326 LOC para contrato TRL-10 — razonable | OK | +90 LOC vs 236 original |
| ADR-049 122 LOC < 150 prevista — waiver T4 sin usar plenamente | OK | Waiver registrado pero no excede |
| Duplicación entre CLAUDE.md `:70-82` (tabla Distribución) y ADR-049 `:34-39` (tabla 3-capas) | SUGGESTION | Cubren el mismo terreno con enfoques distintos. Monitorear drift |

### Consistency

| Finding | Severidad | Evidencia |
|---|---|---|
| ADR-049 usa **`**Status**` / `**Date**` en inglés** mientras ADR-045-048 (recientes) usan **`**Estado**` / `**Fecha**` en español** | **BLOQUEANTE** | ADR-045/046/047/048 todos `**Estado**: Accepted` / `**Fecha**: YYYY-MM-DD`. ADR-049 actual: `**Status**: Accepted` / `**Date**: 2026-05-20`. Inconsistencia detectable. SC-10 fue redactada con el bug y solo verifica el literal — no detecta el problema. |
| Commit `fda0c3d` (T13d) message: `chore(git): excluir .claude/staging/ de versionadoç` con `ç` extra | BLOQUEANTE | Visible en `git log`. Verify.md OB-1 lo marcó cosmético; en review subimos a bloqueante: si NO se squash-mergea, queda permanente. |
| Commit `dcc1f52` (T13a) message: `chore(claude): borrar .claude/commands/, skills/, hooks/` — falta enumeración de `.claude/agents/` y `.claude/skills/` que el plan T13a prescribía | BLOQUEANTE | Subspecifica el cambio real. Same fix via squash merge mandatorio. |
| ADR-049 §Replicabilidad usa imperativo español ("Identificar / Construir / Validar / Publicar / Instalar") consistente con CLAUDE.md | OK | Bien |

### Coverage

| Finding | Severidad | Evidencia |
|---|---|---|
| SC-17d depende de column header de tabla. Sostiene literal pero no semántica. | BLOQUEANTE leve | Verify.md devils-advocate punto 1 lo reconoció. Refinar a grep semántico o aceptar limitación. |
| 4 EXTERNAL aceptables. **SC-13 (CI verde) no validado empíricamente** — el PR borra archivos pero no se confirmó que `pnpm lint/typecheck/test` corra limpio con la nueva estructura. | SUSTANTIVO | Verify Group G. Sin CI run previo, confianza basada en "no tocamos código TS" pero pre-commit hooks (gitleaks, biome lint-staged, check-adr-numbering) podrían reaccionar diferente en CI. |
| No hay verificación de que pre-commit commitlint detectaría typos como `versionadoç`. Si los pasó, los hooks tienen gap. | SUGGESTION | Stub para `.specs/_followups/`: validar commitlint pattern para chars no-ASCII al final del summary. |
| `.specs/integrate-booster-skills-plugin/evidence/` (4 archivos T12) ¿están en git? | QUESTION | Verify Group H asumió su existencia post-T13e. Empíricamente: SÍ, los 4 quedaron en commit `7df06b3` (10 files changed). |

---

## Devils-advocate findings (sub-agent + verified empirically)

**Hallazgo crítico**: spec/verify cubrió un scope demasiado estrecho. R-9 (`hooks/` borrado deja refs rotas en CLAUDE.md) solo cheqeó CLAUDE.md y `.github/workflows/`. **19 archivos del repo contienen referencias huérfanas a paths borrados**:

### Categoría A — TOP-LEVEL DOCS (2 archivos) — BLOQUEANTE

| Archivo | Línea | Contenido | Fix |
|---|---|---|---|
| `README.md` | 115 | `skills/                      # Workflows para agentes de IA` | Actualizar tree para reflejar v3 estructura sin skills/ |
| `README.md` | 127 | ``[`skills/`](./skills/) — workflows estructurados...`` | Reemplazar con ref a `booster-skills:*` namespacing + link a ADR-049 |
| `AGENTS.md` | 53 | ``- Antes de una tarea compleja: consultar [`skills/`](./skills/)...`` | Reemplazar con ref a plugin booster-skills |

### Categoría B — APP READMEs (7 archivos) — BLOQUEANTE

7 README.md de apps con misma referencia: `skills/adding-cloud-run-service/SKILL.md` → debería ser `booster-skills:adding-cloud-run-service`.

| Archivo | Línea |
|---|---|
| `apps/api/README.md` | 40 |
| `apps/document-service/README.md` | 10 |
| `apps/matching-engine/README.md` | 10 |
| `apps/notification-service/README.md` | 10 |
| `apps/telemetry-processor/README.md` | 10 |
| `apps/telemetry-tcp-gateway/README.md` | 10 |
| `apps/whatsapp-bot/README.md` | 10 |

Fix mecánico repetitivo: sed sobre los 7.

### Categoría C — APP SOURCE COMMENTS (probablemente 3) — BLOQUEANTE LEVE

| Archivo | Línea | Contenido | Fix |
|---|---|---|---|
| `apps/matching-engine/src/main.ts` | 13 | `// Ver docs/adr/ y skills/ para el plan de implementación.` | Reemplazar `skills/` con `booster-skills:` |
| `apps/notification-service/src/main.ts` | 13 | idem | idem |
| `apps/document-service/src/main.ts` | (verificar) | (probable) | idem |

### Categoría D — CI/CD DOC (1 archivo) — BLOQUEANTE

| Archivo | Líneas | Contenido | Fix |
|---|---|---|---|
| `docs/ci-cd.md` | 135 | `3. Añadir tests siguiendo \`skills/writing-tests/SKILL.md\` (TODO — skill pendiente)` | Skill `writing-tests` no existe ni en plugin ni se va a crear. Reemplazar con ref a `agent-rigor:31-test-driven-development` |
| `docs/ci-cd.md` | 142 | `3. Si es real: seguir \`skills/incident-response/SKILL.md\`` | Reemplazar con `booster-skills:incident-response` |

### Categoría E — HISTORICAL ADRs (2 archivos) — SUSTANTIVO con decisión PO

**ADR-046 §1 (numbering collisions): "los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo."**

ADR-002 ya fue editado en T5 con un "Supersedence Note" — precedente válido para edición no-destructiva.

| Archivo | Líneas | Contenido | Opciones |
|---|---|---|---|
| `docs/adr/001-stack-selection.md` | 176 | `**Preparado para Claude como agente principal**: CLAUDE.md + skills/ + .claude/commands/ formalizan la colaboración humano-agente.` | (a) **Note appended** ("2026-05-21: `skills/` y `.claude/commands/` se reemplazaron por plugins per ADR-049"), (b) **ADR-050 path-remapping** que documenta el cambio, (c) **Aceptar como historical** sin tocar |
| `docs/adr/011-admin-console.md` | 6, 129, 229 | 3 refs a `skills/incident-response/SKILL.md` | mismas opciones |

**Decisión PO requerida.** Mi recomendación: (a) Note appended siguiendo el precedente ADR-002, una línea explicativa al final.

### Categoría F — HISTORICAL SPECS/PLANS (3 archivos) — ACEPTABLE COMO ESTÁ

| Archivo | Naturaleza |
|---|---|
| `docs/plans/2026-05-17-test-integration-infra-apps-api.md` | Plan histórico de un sprint anterior |
| `docs/specs/2026-05-17-test-integration-infra-apps-api.md` | Spec histórica |
| `docs/specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md` | Output devils-advocate histórico |

Estos son snapshots. NO editar. Las refs son legítimamente históricas. PR-3 (futuro, migración `docs/specs/` → `.specs/`) puede o no afectarlos.

### Categoría G — DOMAIN SCHEMA (1 archivo) — BLOQUEANTE LEVE

| Archivo | Línea | Contenido | Fix |
|---|---|---|---|
| `packages/shared-schemas/src/domain/cargo-request.ts` | 33 | `*   - skills/empty-leg-matching/SKILL.md (input central del algoritmo de matching)` | JSDoc comment. Reemplazar con `booster-skills:empty-leg-matching` |

---

## Sub-agent verbatim outputs (synth)

### code-reviewer

VERDICT: CHANGES_REQUESTED. 5 BLOQUEANTES, 3 questions, 8 suggestions. Listado en §Five-axis review.

### devils-advocate

VEREDICTO: REQUEST_CHANGES. 5 objeciones bloqueantes + 4 residuales + 1 cosmética. Citas archivo:línea verificadas empíricamente. Resumido en §Devils-advocate findings.

Adicional: "el scope canónico fue dibujado demasiado estrecho — limitó la búsqueda de referencias huérfanas a `.github/workflows/` cuando el repo entero contiene 6+ referencias a paths borrados. No es 'looks good'; es 'los 20 SCs no eran suficientes y no encontraron link rot evidente'."

### Otros sub-agents

No invoqué `security-auditor` (PR-2 no toca auth/secrets/network) ni `ux-designer` (no UI) ni `test-engineer` (no nuevos tests reales) — consistent con skill 50 §5.

---

## Decisiones para resolver — propuesta de plan v3

### Acción inmediata (BUILD continuation)

| Task nueva | Acción | LOC delta | Owner |
|---|---|---|---|
| **T15** — Castellanizar header ADR-049 | `**Status**: Accepted` → `**Estado**: Accepted`; `**Date**` → `**Fecha**` | 2 LOC delta | AGENT |
| **T16** — Actualizar SC-10 / verify.sh con header en español | Patch verify.sh líneas SC-10/SC-11; reflect en spec.md §3 | 5 LOC | AGENT |
| **T17** — Fix orphan refs Categorías A+B+C+D+G (13 archivos) | Reemplazos sed sobre 13 archivos | ~30 LOC delta total | AGENT |
| **T18** — Decisión PO sobre Categoría E + ejecución | (a) Note appended a ADR-001 + ADR-011, (b) crear ADR-050, (c) aceptar como historical | 5-50 LOC depending on opción | AGENT (post decisión PO) |
| **T19** — Quitar línea redundante `.gitignore:139` o aceptar | `sed -i '' '/^\.claude\/staging\/$/d' .gitignore` (eliminar línea); o spec.md add residual risk | 1 LOC | AGENT |
| **T20** — Refinar SC-17d a grep semántico (multi-string) o aceptar como cosmetic | Update verify.sh + spec.md | 3 LOC | AGENT |
| **T21** — Commit cleanup + squash merge mandatorio en /ship | Documentar squash como hard requirement en spec/ship.md; ESTO RESUELVE typos versionadoç + hooks/* | 0 LOC code, doc only | AGENT |

### Residuos aceptables (no bloquean tras T15-T21)

- ADR-049 §Validación checklist `[ ]` no marcados sobre PR-2: marcar `[x]` post-merge en commit follow-up (incluir en T14 update CURRENT.md).
- Categoría F (historical specs/plans): no editar.
- CLAUDE.md duplicación con ADR-049 (tabla responsabilidades vs componentes): monitorear drift.
- SC-13 CI verde: validar empíricamente al push (SHIP phase).
- Pre-commit commitlint gap (chars no-ASCII al final del summary): stub follow-up en `.specs/_followups/`.

---

## Residual risks accepted

| Risk | Mitigation | Review-by |
|---|---|---|
| Categoría F (3 historical docs) referencias huérfanas no se editan | Documentado como historical en review.md; PR-3 (migración specs path) puede tocarlos | PR-3 |
| Pre-commit commitlint no detecta typos no-ASCII al final del summary | Stub follow-up en .specs/_followups/ con prompt para sesión futura | 2026-Q3 |
| ADR-049 §Validación checklist queda con [ ] al merge | Marcar [x] como parte de T14 post-merge CURRENT.md update | T14 |
| Duplicación tabla CLAUDE.md vs ADR-049 puede driftear | Cambios en plugin scope obligan a editar ambos archivos | Continuous |

---

## Verdict final

**CHANGES_REQUESTED — back to BUILD with new tasks T15-T21**

PR-2 NO es mergeable en su estado actual. Los hallazgos (especialmente Categorías A-D + G de orphan refs) son materiales — un reviewer humano vería los link rot y bloquearía. No es opinión.

Pero los fixes son mecánicos (~30-45 min de trabajo agent + 1 decisión PO sobre Categoría E + squash merge en /ship).

**Recomendación**: spec.md no necesita iteración (los 20 SCs definen correctamente lo que se quería; el problema fue scope incompleto, ya verificado en este review). plan.md SÍ necesita actualizarse con T15-T21.

---

## Approval

**Status**: Pendiente nueva iteración BUILD (T15-T21).

**Para aprobar el review actual**, el PO debe:
1. Decidir Categoría E (opción a/b/c).
2. Aprobar squash merge mandatorio en /ship (T21).
3. Aprobar plan v3 con tasks T15-T21 antes de continuar.
