# Review v2: integrate-booster-skills-plugin

- **Reviewer**: Felipe Vicencio + agent-rigor (code-reviewer round 2 + devils-advocate round 2)
- **Date**: 2026-05-21
- **Cooling-off respected**: Waiver granted ("ya releí todo en este chat + 4hrs rest aplicaron antes" — ledger entry 2026-05-21T06:46)
- **Round 1 review**: `.specs/integrate-booster-skills-plugin/review.md` (preserved at copy `review-v1-pre-T15-T21.md`)
- **Verdict**: **CHANGES_REQUESTED (mini-round 3)** — 3 bloqueantes verificados + 2 cosméticos + 1 follow-up stub

---

## Round 1 findings status (post T15-T21)

| # | Round 1 finding | Status | Evidence |
|---|---|---|---|
| 1 | `.gitignore:139` `.claude/staging/` redundante | ✅ RESOLVED | T18 eliminó líneas; SC-23b PASS |
| 2 | ADR-049 idioma header inglés | ✅ RESOLVED | T15: `head -5 docs/adr/049-*` ahora `**Estado**`/`**Fecha**` |
| 3 | Typo `versionadoç` (T13d) | ⏸ DEFERRED | Squash merge T24 lo absorbe |
| 4 | `*` extra en T13a + enum incompleta | ⏸ DEFERRED | Squash merge T24 |
| 5 | SC-17d cosmético | ✅ RESOLVED | T19 semantic check con 3× grep -A 10 |
| 6 | 19 archivos orphan refs | ✅ RESOLVED | T17 fix; SC-22 PASS empíricamente |

Round 1 totalmente cerrado (excepto T24 squash merge enforcement).

---

## Sub-agent round 2 verdicts

### code-reviewer (agent_id a3d7d176)

VERDICT: **APPROVED**. 0 bloqueantes, 1 question (SC-21 strictness), 2 suggestions (writing-tests row en ADR-050, tilde en verify.sh). Verificación empírica de cada round 1 finding confirmada.

### devils-advocate (agent_id a15b5aa2)

VERDICT: **REQUEST_CHANGES**. 3 bloqueantes + 3 sustantivos + 2 cosméticos. Encontró defectos que code-reviewer pasó por alto.

**Aplicando "devils-advocate prevalece" (contract §5 — su trabajo es objetar)**, el verdict global es CHANGES_REQUESTED — pero con findings menores y mecánicos.

---

## Findings round 2 (verificados empíricamente)

### Bloqueantes

#### B1. ADR-050 §Validación checklist abierta + CLAUDE.md no referencia ADR-050

**Evidencia**:
```
docs/adr/050-...md:102: - [ ] Linked desde CLAUDE.md §Integración con plugins de Claude Code (next iteration si aplica)
grep -nF "ADR-050" CLAUDE.md → (no match)
grep -nF "050-skills" CLAUDE.md → (no match)
```

ADR-050 prometió que CLAUDE.md lo referencie. PR-2 lo deja como deuda silenciosa.

**Fix propuesto**: una de dos opciones:
- (a) Agregar a CLAUDE.md §Integración con plugins → "Para resolver referencias a paths antiguos en ADRs históricos: ver [ADR-050](docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md)" + marcar `[x]` en ADR-050:102
- (b) Quitar el ítem `[ ]` del ADR-050 (declarar que el link no es obligatorio)

Recomendación: (a) — un link en CLAUDE.md es ~1 LOC, agrega valor para sesiones futuras.

#### B2. SC-22 regex enumerado (lista cerrada de 8 skill names)

**Evidencia**:
```
verify.sh:128 grep -lE "skills/(adding-cloud-run-service|carbon-calculation-glec|empty-leg-matching|incident-response|arquitecto-maestro|using-agent-skills|writing-adrs|writing-tests)/SKILL\\.md|\\.claude/commands|\\.claude/agents|hooks/session-start"
```

Si en el futuro se referencia `skills/booster-stack-conventions/SKILL.md` (skill nueva del plugin), `skills/.+/non-SKILL.md`, `.claude/skills/`, `hooks/<other>`, etc. — el grep retorna falso negativo. La red está cerrada cuando debería ser abierta.

**Fix propuesto**: cambiar regex a `skills/[a-z0-9-]+/SKILL\.md|\.claude/(commands|agents|skills)/|hooks/[a-z0-9-]+\.md` — patrón abierto que detecta cualquier referencia a esos paths sin enumeración.

LOC: ~3 LOC cambio.

#### B3. apps/api/README.md inconsistencia tonal vs los otros 6 apps READMEs

**Evidencia**:
```
apps/api/README.md:40 — "Sigue la skill `booster-skills:adding-cloud-run-service`."
apps/document-service/README.md:10 — "Seguir la skill `booster-skills:adding-cloud-run-service` (o adaptado para GKE si aplica) y los ADRs relacionados."
apps/matching-engine/README.md:10 — idem
```

Imperativo "Sigue" en apps/api vs infinitivo "Seguir" en los otros 6. Inconsistencia precede T17 (sed conservó el original). Devils-advocate round 1 lo apuntó como "fix mecánico sobre los 7" sin verificar homogeneidad.

**Fix propuesto**: sed sobre apps/api/README.md línea 40: `Sigue la skill` → `Seguir la skill`.

### Sustantivos

#### S1. 28 ADRs con headers `Status`/`Date` en inglés (out of scope PR-2)

**Evidencia**: `grep -lE "^\*\*Status\*\*|^\*\*Date\*\*" docs/adr/*.md | wc -l` → 28 archivos.

T15 castellanizó solo ADR-049 y ADR-002 porque eran los del scope PR-2. Los otros 28 ADRs históricos (001, 004-013, 020-033, etc.) siguen en inglés.

**Decisión**: fuera de scope PR-2. Stub follow-up `.specs/_followups/castellanizar-adr-headers.md` para resolver en futuro PR.

#### S2. Squash merge MANDATORIO declarativo, no enforceado

**Evidencia**: spec.md:152 declara el requirement pero no hay branch protection rule en GitHub ni hook local. PO podría ejecutar `gh pr merge --merge` por accidente.

**Decisión**: residual risk. Acción post-merge: configurar branch protection en GitHub `boosterchile/booster-ai`: "Require squash merge". Stub follow-up.

#### S3. ADR-050 introduce "latencia cognitiva" admitida

**Evidencia**: ADR-050 §Consecuencias.Negativas lo admite. Solución menos burocrática hubiera sido note appended a ADR-001/011 (precedente ADR-002).

**Decisión**: cerrada. PO eligió ADR-050 en plan v3. No re-abrir.

### Cosméticos

#### C1. "un skill" vs "una skill" mismatch en CLAUDE.md

**Evidencia**:
```
CLAUDE.md:86 — "una skill de booster-skills" (femenino)
CLAUDE.md:244 — "un skill definido" (masculino)
```

`skill` es anglicismo sin género formal. Booster usa "**la** skill" mayormente (consistente en CLAUDE.md:86 + 7 apps READMEs). Línea 244 es la inconsistencia.

**Fix propuesto**: sed CLAUDE.md:244 — `un skill definido` → `una skill definida`.

#### C2. Sub-agents en ADR-050 ¿ficticios?

**Estado**: ❌ devils-advocate INCORRECTO. Los 6 sub-agents (`dependency-auditor`, `explore-architecture`, `performance-analyzer`, `refactor-advisor`, `security-scanner`, `tech-debt-detector`) **SÍ existen** en `~/.claude/plugins/cache/booster-skills/booster-skills/0.1.0/agents/`. Verificado.

**Acción**: ninguna. Devils-advocate falló este punto (no verificó empíricamente).

---

## Patrón de waivers (cadena cumulativa)

Devils-advocate marca: 4 waivers en 5 phases — bandera amarilla.

Cumulativos:
1. T4 LOC > 100 (ADR-049 atómico, doc) — justificado
2. 13 modules > 10 (cleanup masivo) — justificado
3. Cooling-off round 1 (PO 4hrs rest + chat reread) — justificado
4. Cooling-off round 2 (mismo argumento) — justificado, aunque "más" rest no aplica (es continuación inmediata round 1)

Análisis honesto: el patrón es justificable individualmente, pero **representa un sesgo del agente hacia velocidad sobre cooling-off**. Para futuros PRs, considerar enforcement automático del cooling-off post-VERIFY/post-BUILD vs reliance en disciplina humana.

Acción para PR-2: no acción retroactiva — los waivers ya están registrados.

---

## Acciones pre-SHIP (mini-round 3)

Total: ~10 min agent work.

| Task | Acción | LOC |
|---|---|---|
| **T22.5a** | Fix B1: agregar link a ADR-050 en CLAUDE.md §Integración + marcar `[x]` en ADR-050:102 | ~3 |
| **T22.5b** | Fix B2: cambiar SC-22 regex a patrón abierto `skills/[a-z0-9-]+/SKILL\.md|...` | ~3 |
| **T22.5c** | Fix B3: harmonizar apps/api/README.md:40 con infinitivo "Seguir" | ~1 |
| **T22.5d** | Fix C1: sed CLAUDE.md:244 "un skill" → "una skill" + "definido" → "definida" | ~1 |
| **T22.5e** | Crear stub `.specs/_followups/castellanizar-adr-headers.md` (S1) | ~30 |
| **T22.5f** | Documentar S2 como residual risk en review.md + stub `.specs/_followups/github-branch-protection-squash.md` | ~30 |
| **T22.5g** | Re-ejecutar verify.sh + actualizar verify.md con post-fix state | ~20 |
| **T22.5h** | Commit incremental (PO ejecuta) | 0 |

---

## Residual risks accepted (no fix in PR-2)

| Risk | Mitigation | Review-by |
|---|---|---|
| Squash merge enforcement (S2) | Stub follow-up creado; GitHub branch protection rule a configurar post-merge | Post-merge |
| 28 ADRs en inglés (S1) | Stub follow-up; no urgente | Sprint Q3 |
| Cadena de waivers (4 en 5 phases) | Patrón documentado en ledger; futuros PRs evalúan enforcement | Continuous monitoring |
| Squash merge T24 absorbe typos commits T13a/T13d/T13d-versionadoç | Hard requirement en spec §6.2 + manual enforcement | T24 SHIP |

---

## Verdict final

**CHANGES_REQUESTED (mini-round 3)** — 3 bloqueantes mecánicos + 1 cosmético + 2 stubs follow-up.

Trabajo total: ~10 min agent + 1 commit PO.

Una vez T22.5a-T22.5h ejecutados, el verdict se actualiza a APPROVED y procedemos a T24 SHIP.

---

## Approval

**Status**: Pendiente — PO decide entre:

- (a) Ejecutar mini-round 3 (T22.5a-T22.5h) — recomendado, ~10 min
- (b) Aceptar B1+B2+B3+C1 como residual risk + ship con la deuda
- (c) BUILD round v4 más extenso (over-engineering, no necesario)

Si (a) → arranco T22.5 ahora.
Si (b) → preparamos /ship.

---

## Closure mini-round 3 (2026-05-21 post T22.5a-T22.5g)

Aplicado per Opción A. Estado final:

| Task | Acción | Resultado |
|---|---|---|
| T22.5a | ADR-050:102 marcado [x] + link a ADR-050 insertado en CLAUDE.md §Capas adicionales locales línea 105 | ✅ DONE |
| T22.5b | SC-22 regex enumerado → abierto: `skills/[a-z0-9_-]+/\|\.claude/(commands\|agents\|skills)/\|hooks/[a-z0-9_-]+\.md` | ✅ DONE |
| T22.5c | apps/api/README.md:40 `Sigue la skill` → `Seguir la skill` (homogéneo con otros 6) | ✅ DONE |
| T22.5d | CLAUDE.md:246 `un skill definido` → `una skill definida` (consistente con línea 86) | ✅ DONE |
| T22.5e | Stub `.specs/_followups/castellanizar-adr-headers.md` creado (S1 follow-up) | ✅ DONE |
| T22.5f | Stub `.specs/_followups/github-branch-protection-squash.md` creado (S2 follow-up) | ✅ DONE |
| T22.5g | Re-ejecutar verify.sh con regex abierto: **31 PASS / 0 FAIL / 4 EXTERNAL** (exit 0); orphan_count 0 empíricamente | ✅ DONE |

### Verdict actualizado

**APPROVED** — Round 2 bloqueantes B1+B2+B3+C1 resueltos inline. Sustantivos S1+S2 trackeados como follow-up stubs. S3 cerrado por decisión PO previa. C2 confirmado falso positivo de devils-advocate.

### Residual risks (al cierre)

- Squash merge enforcement (S2): tracked en `.specs/_followups/github-branch-protection-squash.md`. Acción post-merge: configurar branch protection rule en GitHub.
- Castellanización de los 28 ADRs históricos en inglés (S1): tracked en `.specs/_followups/castellanizar-adr-headers.md`. Sprint futuro.
- Typos commit T13a (`hooks/*`) y T13d (`versionadoç`): se resuelven en T24 squash merge MANDATORIO (per spec §6.2).
- Patrón cumulativo de waivers (4 en 6 phases): bandera amarilla para futuros PRs.

PR-2 ready para **T22.5h commit + T24 SHIP**.
