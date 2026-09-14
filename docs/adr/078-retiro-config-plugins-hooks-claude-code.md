# ADR-078 — El repo deja de activar plugins y hooks de Claude Code; esa configuración es del operador

**Estado**: Vigente
**Fecha**: 2026-09-05
**Decider**: Felipe Vicencio (Product Owner)
**Supersede parcialmente a**: [ADR-072](./072-disciplina-inline-plugins-como-conocimiento-opcional.md) (solo la decisión 3: «`superpowers` sigue habilitado en `.claude/settings.json`») y [ADR-049](./049-claude-code-plugin-system-adoption.md) (solo la fila 3 de su tabla de capas: «`settings.json` declara plugins»). El resto de ambos ADR sigue intacto.
**Related**: [ADR-060](./060-superpowers-replaces-agent-rigor.md), [ADR-064](./064-consolidate-local-subagents-into-booster-skills.md), [ADR-076](./076-gobernanza-operador-unico.md), PR #552 (versionó `.claude/settings.json`), PR #647 (hook `check-contrato-al-dia`), `CLAUDE.md` §Herramientas de apoyo, `AGENTS.md` §Cómo los agentes deben colaborar

---

## Contexto

ADR-072 dejó la disciplina inline en `CLAUDE.md` y relegó los plugins a conocimiento opcional, pero conservó un `.claude/settings.json` versionado (PR #552, 2026-07-01) que activa `superpowers` y `booster-skills` a alcance de proyecto y declara el marketplace `boosterchile/booster-skills`. PR #647 (2026-08-03) sumó un hook `SessionStart` que ejecuta `.claude/hooks/check-contrato-al-dia.sh` para avisar si `CLAUDE.md` o `AGENTS.md` quedaron rezagados respecto de `main`.

El 2026-09-05 el PO retiró de su entorno todos los plugins, skills y hooks de Claude Code, con este diagnóstico:

1. **`superpowers`** inyecta en cada arranque de sesión un bloque que obliga al agente a invocar una skill antes de cualquier acción, incluida una pregunta aclaratoria. Eso desplaza el contrato inline que ADR-072 fijó como única fuente normativa.
2. **`booster-skills`** trae hooks `SessionStart`, `PostToolUse` y `Stop` que alimentan un ledger sin consumidor. ADR-072 §4 ya lo declaró peso muerto y programó su retiro en ese repo; mientras tanto, cada clon de este repo lo sigue activando.
3. Un `settings.json` versionado con `enabledPlugins: true` decide por el operador en cada clon: la configuración de proyecto prevalece sobre la de usuario, así que deshabilitar los plugins en `~/.claude` no alcanza mientras el repo los vuelva a declarar.
4. El hook `check-contrato-al-dia.sh` es informativo (siempre termina con `exit 0`) y dependía además de un wrapper de shell del operador, también retirado. Su función la cubre una comprobación manual barata (ver Consecuencias).

Lo que ADR-072 demostró sigue vigente: ningún gate de CI ni de pre-commit depende de plugins, y tanto `CLAUDE.md` como `AGENTS.md` ya describen a `superpowers` y `booster-skills` como «apoyo opcional cuando estén disponibles».

## Decisión

1. **El repo no versiona configuración de Claude Code que active plugins, marketplaces ni hooks.** Se eliminan `.claude/settings.json` y `.claude/hooks/check-contrato-al-dia.sh`. `.claude/` queda sin archivos trackeados; `settings.local.json` sigue siendo local y gitignored.
2. **Instalar o no `superpowers` y `booster-skills` es decisión del operador**, en su `~/.claude` (alcance de usuario) o en su `settings.local.json`. El contrato no cambia: `CLAUDE.md` §Herramientas de apoyo y `AGENTS.md` ya los tratan como opcionales y no requieren edición.
3. **Cualquier hook de Claude Code futuro entra por ADR**, con su consumidor y su criterio de retiro declarados, la misma regla que ADR-072 §4 aplicó al ledger.
4. Quedan superadas ADR-072 decisión 3 y ADR-049 fila 3. `booster-skills` sigue siendo el paquete de conocimiento de dominio publicado en `boosterchile/booster-skills` (ADR-072 §4); solo deja de activarse desde este repo.

## Consecuencias

**Positivas.** Un clon fresco no activa nada en la máquina del operador; desaparece el último punto donde el repo decidía sobre la sesión del agente; un archivo y un script menos que mantener y auditar; la regla «la disciplina vive en el contrato + CI + gates» deja de tener una excepción versionada.

**Negativas / riesgos.** Quien quiera los plugins debe instalarlos a mano (`claude plugin install superpowers@claude-plugins-official`, `claude plugin marketplace add boosterchile/booster-skills`). Se pierde el aviso automático de contrato rezagado al abrir sesión; mitigado porque `CLAUDE.md` solo cambia con permiso del PO y entra por PR, y porque la comprobación manual es una línea:

```bash
git fetch origin main && git log --oneline HEAD..origin/main -- CLAUDE.md AGENTS.md
```

Sin efecto en CI, build, runtime, infraestructura ni datos.

## Verificación

```bash
git ls-files .claude/                                   # esperado: vacío
git grep -l check-contrato-al-dia -- . ':!docs/adr' ':!.specs'   # esperado: vacío
```
