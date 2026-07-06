# ADR-072 — La disciplina vuelve inline al contrato; los plugins quedan como conocimiento opcional

**Estado**: Accepted
**Fecha**: 2026-07-06
**Decider**: Felipe Vicencio (Product Owner)
**Supersedes**: [ADR-049](./049-claude-code-plugin-system-adoption.md) y [ADR-060](./060-superpowers-replaces-agent-rigor.md) (parcialmente — solo la asignación de responsabilidades de disciplina a plugins; la adopción de `booster-skills` como paquete de dominio sigue vigente)
**Related**: [ADR-050](./050-skills-and-commands-path-remapping-post-plugin-adoption.md), [ADR-064](./064-consolidate-local-subagents-into-booster-skills.md), `CLAUDE.md`, `audit-outputs/2026-07-06-analisis-base-disciplina-icarenest.md`

---

## Contexto

ADR-049 estableció que la disciplina de desarrollo del agente vivía en plugins de Claude Code; ADR-060 reemplazó la Capa 1 (`agent-rigor`, retirado por enforcement "no operativo de facto") por `superpowers`, y rescató dos mecanismos a `booster-skills` (skills `definicion-de-terminado`, `tdd-dominio-critico` + ledger observacional con scorecard semanal).

Un análisis comparativo del 2026-07-06 contra el proyecto ICARENEST (desarrollo calificado como "muy preciso" por el PO, con contrato inline de 34 líneas y cero plugins) encontró, con evidencia en el repo:

1. **Costo documentado de gobernar la gobernanza**: 4 ADRs (049, 050, 060, 064) y al menos 4 PRs (#464, #466, #552, #553) dedicados al sistema de plugins en ~7 semanas. El equivalente ICARENEST fue un commit.
2. **Beneficio no medible porque el medidor nunca existió**: el scorecard prometido (`benchmark/score-week.sh`) no existe en ninguna parte del repo; el ledger acumula 40 sesiones / 2.501 eventos que nada consume. Los únicos eventos de gate operando (`drift_blocked`) son de la era agent-rigor, ya retirada.
3. **Fragilidad estructural**: las skills de plugin solo cargan en sesiones de Claude Code CLI con los plugins instalados. En Cowork, chat u otra superficie, la capa de disciplina desaparece por completo mientras el CLAUDE.md sigue delegándole responsabilidades.
4. **El enforcement que sí funciona en booster ya es inline**: CI + pre-commit guards (gitleaks, coverage gate, `check-adr-numbering` — que atrapó una colisión real —, spec-drift, preflight de secretos post-INC-2026-06-19) + gates humanos de GitHub (`required_reviewers` en `production`, main protegida). Ninguno depende de plugins.
5. **Los síntomas reales de imprecisión** (batch de 19 PRs abiertos, 52 stubs, 37 ramas locales muertas, gate de deploy zombie 13 días, handoff reconstruido a posteriori) no los causa la falta de skills de proceso sino la ausencia de una regla de WIP — el mecanismo central de ICARENEST ("un frente por vez, cerrar antes de abrir").

Es la segunda iteración del patrón que motivó ADR-060: mecanismo de disciplina cuyo enforcement no es verificable. La primera vez el mecanismo era un gate bash roto; esta vez es una delegación a tooling ausente fuera del CLI y sin medición de aporte.

## Decisión

1. **`CLAUDE.md` se reescribe como contrato operativo corto (~90 líneas), autosuficiente y releíble por sesión**, al estilo ICARENEST. Incorpora inline: frontera de decisiones explícita, un frente por vez (WIP máx. 3 PRs propios abiertos; no abrir frente nuevo con un sweep pendiente), criterio de salida declarado en `.specs/<slug>/spec.md` antes de construir, TDD con rojo exhibido en dominio crítico (el output del rojo va en la Evidencia del PR), detenerse-y-escalar ante conflicto con un cimiento, ~4 intentos máximo ante bloqueo con escalada clasificada, y commit+push al cierre de cada tarea. Conserva íntegras las reglas Booster de stack, naming bilingüe, arquitectura, commits/PRs y deploy.
2. **Ninguna responsabilidad de disciplina se asigna a plugins.** La tabla de "distribución de responsabilidades" de ADR-049/060 queda superseded: toda responsabilidad es del contrato + CI/pre-commit + gates humanos. El contenido esencial de `definicion-de-terminado` y `tdd-dominio-critico` queda inlineado en el contrato; las skills permanecen en el plugin como material extendido sin carácter normativo.
3. **`superpowers` pasa a refuerzo opcional** en sesiones CLI: sigue habilitado en `.claude/settings.json` (costo cero, posible beneficio), pero el contrato no depende de él ni documenta su instalación (eso vive en este ADR y en `docs/plugins/`).
4. **`booster-skills` se mantiene como paquete de conocimiento de dominio** (GLEC, matching, deploy Cloud Run, stack conventions, sub-agents de auditoría). **Follow-up en ese repo**: retirar los hooks de ledger (`SessionStart`/`PostToolUse`/`Stop`) en la próxima release — observabilidad sin consumidor es peso muerto; si a futuro se quiere medición, se diseña con el consumidor primero.
5. **`AGENTS.md`** ajusta su referencia a plugins de "consultar antes de una tarea compleja" a "apoyo opcional cuando estén disponibles".

## Consecuencias

**Positivas**: contrato portable a cualquier superficie de Claude; una sola fuente normativa de disciplina; fin del mantenimiento de la meta-capa (instalación, versionado, remapeos); la regla de WIP ataca la causa raíz de los síntomas observados; el CLAUDE.md vuelve a poder leerse completo al inicio de cada sesión.

**Negativas / riesgos**: se pierde el auto-triggering de skills de proceso en CLI como mecanismo primario (mitigado: superpowers sigue habilitado como refuerzo); las reglas inline dependen de que el agente las lea y el humano las haga cumplir en PR — que es exactamente el modelo que la evidencia de ICARENEST y de los propios guards de booster muestra funcionando.

**Deuda explícita asociada** (fuera de alcance de este ADR, frentes propios): triage del batch #509–#527 y limpieza de ramas/stubs; presupuesto de tamaño para `docs/handoff/CURRENT.md`; release de booster-skills sin hooks de ledger.
