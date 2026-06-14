# ADR-060 — Reemplazo de agent-rigor por superpowers como capa de disciplina genérica

**Estado**: Proposed
**Fecha**: 2026-06-14
**Decider**: Felipe Vicencio (Product Owner)
**Supersedes**: [ADR-049](./049-claude-code-plugin-system-adoption.md) (parcialmente — solo la Capa 1)
**Related**: [ADR-001](./001-stack-selection.md), [ADR-002](./002-skill-framework-adoption.md), `CLAUDE.md`

---

## Contexto

ADR-049 adoptó una arquitectura de 3 capas sobre plugins de Claude Code:

| Capa | Componente | Repo |
|---|---|---|
| 1 | `agent-rigor@0.2.0` (disciplina genérica) | `boosterchile/best-skill-claude` |
| 2 | `booster-skills@0.1.0` (dominio Booster) | `boosterchile/booster-skills` |
| 3 | `.claude/` local minimal | `boosterchile/booster-ai` |

Una auditoría del 2026-06-14 de la Capa 1 (`agent-rigor`) detectó que su mecanismo de enforcement era **no operativo de facto** ("ficción"):

1. **Gate "leíste CLAUDE.md" es código muerto.** `pre-tool-use.sh` bloquea `Write/Edit` si el ledger no tiene una entrada `"file":"...CLAUDE.md"`, pero esa entrada solo la escribe `post-tool-use.sh` en su rama `Read:*`. `hooks/hooks.json` registra `PostToolUse` **solo** para `Write|Edit|MultiEdit`, nunca para `Read`. Resultado: la lectura del contrato jamás se registra; el gate solo se satisface inyectando manualmente una línea JSON — verifica "¿escribiste una línea?", no "¿leíste?".
2. **Escape valve anti-drift en deadlock.** El comando que registra `drift_justified` contiene el término detectado, lo que re-dispara el bloqueo; no existe forma de registrar la justificación vía tool sin tropezar con la regla que pretende levantar.
3. **Tres listas de vocabulario de drift divergentes** entre `CLAUDE.md`, `user-prompt-submit.sh` y `pre-tool-use.sh`; ninguna cubre la tabla del contrato. `FIXME:` (la forma común) no se detecta por el patrón `FIXME[^:]`.
4. **Cero tests** sobre ~520 líneas de bash de enforcement, en un plugin cuyo único propósito es la disciplina.

En paralelo se evaluó [`obra/superpowers@5.1.0`](https://github.com/obra/superpowers) (MIT, marketplace oficial de Anthropic, mantenedor activo, suite de tests real, cross-harness). superpowers cubre el mismo problema con un mecanismo distinto: moldeo conductual + auto-triggering + subagent-driven-development con review de dos etapas, en vez de un gate bash determinista.

Adicionalmente, el PO documentó el motivo original de la regla "no MVP, cero deuda": contrarrestar la tendencia del agente a hacer lo mínimo y parchear síntomas. Esa regla se implementó como tabú de vocabulario sobre el gate roto — es decir, no estaba operativa.

## Decisión

1. **Reemplazar la Capa 1 `agent-rigor` por `superpowers`** como pack de disciplina genérica. `superpowers` ataca el modo de falla real (racionalización + claims sin evidencia) con `verification-before-completion` y el iron-law de TDD, respaldado por review de subagentes frescos — sin depender de un gate bash propio sin tests.

2. **Conservar la Capa 2 `booster-skills`** como source-of-truth del dominio Chile/GCP/logística. Es complementaria a superpowers (que explícitamente delega lo específico de dominio a plugins aparte).

3. **Rescatar a `booster-skills@0.2.0`** los mecanismos de `agent-rigor` cuyo valor es real y no está cubierto por superpowers, como **contenido de skill** (no como motor bash):
   - **#3 intención "no MVP / no parches"** → nueva skill `definicion-de-terminado`: Definición de Terminado explícita y testeable + tabla anti-racionalización en español. Reemplaza el tabú de vocabulario.
   - **#4 TDD acoplado a dominio** → nueva skill `tdd-dominio-critico`: fija los caminos donde TDD es obligatorio (DTE/SII, factoring, pricing, GLEC, matching, migraciones, auth), delegando la mecánica a `superpowers:test-driven-development`.
   - **#1 cooling-off 30 min** → rescatado como **práctica documentada** dentro de `definicion-de-terminado`, no como hook. Su valor (segundo par de ojos) lo provee el review de subagente fresco de superpowers.
   - **#2 ledger + benchmark** → **rescatado como capa observacional con tests** (decisión del PO, 2026-06-14). Reconstruido sin gates: los hooks (`session-start`, `log-event`, `stop`) solo registran, nunca hacen `exit 2`, eliminando la clase de bugs del original (deadlock, fail-open). Se corrigen los dos defectos que lo volvieron ficción: `Read` y `Task` quedan correctamente cableados en `PostToolUse`. Mide lo realmente observable y alineado al flujo de superpowers: artefactos por tipo, ratio test:source, invocaciones de subagentes, skills/contratos leídos, commits. `benchmark/score-week.sh` produce un scorecard semanal sin umbral de aprobado/reprobado (tendencia > valor puntual). Suite `tests/ledger.bats` (8 tests) valida el comportamiento; verificada verde antes de adoptar.

4. **Retirar `agent-rigor`** del proyecto: desinstalar el plugin y la marketplace, y actualizar `CLAUDE.md` de `booster-ai` para declarar la nueva Capa 1.

## Consecuencias

### Positivas

- **Operativo, no ficción**: la disciplina pasa a un plugin probado, con tests y mantención externa; se elimina la dependencia de un gate que no cerraba.
- **Ataca la causa correcta**: "lo mínimo y parchea" se combate con evidencia-antes-de-claim y DoD verificable, no con grep de palabras evadible.
- **Menos deuda propia**: se dejan de mantener ~520 líneas de bash sin tests — coherente con el principio de no acumular deuda.
- **Cross-harness**: superpowers funciona también en Codex/Cursor/Gemini/Copilot, alineado con `AGENTS.md`.

### Negativas

- **Se pierde el gate determinista (bloqueante)**. Es intencional: el gate del original no cerraba. El ledger #2 conserva el *paper-trail auditable* pero de forma observacional, sin bloquear.
- **Se pierden hooks anti-drift a nivel runtime (bloqueo)**. Mitigado por las skills de rescate + review de subagentes; la observación de conducta queda en el ledger.
- **booster-skills ahora tiene hooks propios**. Coexisten con los de superpowers (Claude Code fusiona hooks de todos los plugins). Superficie de mantenimiento acotada y cubierta por `tests/ledger.bats`.
- **Dependencia de un tercero (obra/superpowers)**. Mitigado: MIT, marketplace oficial, se puede pinear versión.
- **`booster-skills` sube de 7 a 9 skills**; requiere bump a 0.2.0, CHANGELOG y release.

## Validación (criterios de "implementado correctamente")

- [ ] `agent-rigor` desinstalado; `/plugin list` no lo muestra.
- [ ] `superpowers` instalado y activo; `booster-skills@0.2.0` instalado y activo.
- [ ] Test de aceptación superpowers: sesión limpia + "hagamos una lista de tareas en React" → `brainstorming` auto-dispara antes de escribir código.
- [ ] `definicion-de-terminado` y `tdd-dominio-critico` validan con `claude plugin validate .` + PyYAML.
- [ ] Test de trigger de dominio: "modifica el cálculo de factoring" → `tdd-dominio-critico` se activa y exige test-first.
- [ ] Ledger #2 operativo: `tests/ledger.bats` 8/8 verde; tras una sesión real, `score-week.sh` imprime métricas > 0.
- [ ] `CLAUDE.md` de `booster-ai` declara la nueva Capa 1 (superpowers) y elimina referencias al contrato/hard-gate de agent-rigor.
- [ ] Las 40+ specs existentes en `.specs/` siguen accesibles (la convención de artefactos se conserva como documentación, ya no enforced por hook).

## Referencias

- [ADR-049](./049-claude-code-plugin-system-adoption.md): arquitectura de 3 capas (superseded en su Capa 1).
- Auditoría agent-rigor 2026-06-14 (hallazgos #1–#4).
- `obra/superpowers`: https://github.com/obra/superpowers (MIT, v5.1.0).
- `boosterchile/booster-skills`: Capa 2 de dominio.
