# SESSION_CLAUDE.md — Reglas operativas de esta sesión de auditoría

**Naturaleza**: artefacto efímero de sesión. Define cómo se comporta el agente durante esta auditoría específica. **No** sustituye al `CLAUDE.md` del proyecto (contrato vinculante del repo en raíz).

**Vigente desde**: 2026-05-19T02:18Z
**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Objetivo de la sesión**: producir baseline arquitectónico read-only de `booster-ai`.

---

## Modo de operación: read-only sobre código

El agente NO modifica código fuente del repo. Las únicas rutas con permiso de escritura durante esta sesión son:

- `audit-outputs/` — productos de la auditoría (los 12 artefactos exigidos).
- `.claude/agents/` — definiciones de subagents creados para esta auditoría.
- `.claude/settings.json` — hooks de enforcement para esta sesión.
- `.claude/ledger/<session>.jsonl` — log de eventos agent-rigor.
- `/tmp/` — staging temporal de archivos intermedios (no persiste en el repo).

Cualquier intento de `Write`/`Edit` fuera de esas rutas debe ser **bloqueado** por el hook `PreToolUse` definido en `.claude/settings.json`.

## Bash allowlist (todo lo demás bloqueado por el hook de esta sesión)

**Lectura/inspección**:
- `cat`, `head`, `tail`, `less`, `wc`, `tree`, `find`, `grep`, `rg`
- `git log`, `git status`, `git diff`, `git blame`, `git show`

**Análisis de dependencias**:
- `pnpm ls`, `pnpm outdated`, `pnpm audit --json`
- `npm ls`, `npm outdated`, `npm audit --json` (compatibilidad)

**Utilitarios**:
- `date`, `pwd`, `echo`, `mkdir` (solo bajo `audit-outputs/`)

## Prohibido absoluto durante la sesión

- `pnpm install`, `npm install`, `yarn add`, `pnpm add` (no modificar lockfiles).
- `git commit`, `git push`, `git reset`, `git checkout -b`, `git merge`.
- `rm`, `mv`, `cp` cuyo target esté fuera de `audit-outputs/` o `/tmp/`.
- Cualquier llamada a APIs de producción (Cloud SQL prod, BigQuery prod, etc.).
- Reproducir valores de secrets en texto plano en cualquier output (route + line OK; valor NO).

## Manejo de drift vocabulary

El proyecto `booster-ai` opera bajo `agent-rigor` con un hook `PreToolUse` que bloquea acciones cuyo contenido contenga vocabulario de drift (`for now`, `MVP`, `temporary`, `hack`, etc.) sin un evento `drift_justified` previo en el ledger.

Durante esta auditoría, los subagents necesitan referenciar esas palabras como **patrones de detección** (no como declaración de intención). Justificación registrada en ledger entry `2026-05-19T02:19:00Z`. Si el bypass de 10 minutos expira durante una acción, re-loguear `drift_justified` con la misma justificación.

## Manejo de secrets detectados

Si un subagent detecta un secret hardcoded:

1. Reportar como hallazgo **P0** en `03_SECURITY_FINDINGS.md`.
2. Incluir `ruta:línea` y la **categoría** del secret (e.g., "JWT signing key", "GCP service account JSON", "OpenAI API key").
3. **NUNCA** copiar el valor del secret en ningún output (`audit-outputs/*`, `.execution.log`, ledger, ningún archivo).
4. Si es necesario validar el secret, hacerlo via referencia indirecta (longitud, prefijo de pocos bytes ofuscado, hash truncado).

## Manejo de contexto

Si el uso de contexto de la sesión principal supera 60%, ejecutar `/compact` con hint del progreso actual antes de continuar. Los subagents tienen contexto aislado y no contaminan el de la main session.

## Coexistencia con agent-rigor

El framework `agent-rigor` permanece activo durante esta sesión:
- Sus hooks de `SessionStart`, `PreToolUse` (drift detection, CLAUDE.md read enforcement), `Stop` siguen ejecutándose.
- Los hooks de esta sesión (`.claude/settings.json` propios) se suman a los del plugin agent-rigor, no los reemplazan.
- Este audit se declaró como `skip_cycle` (meta-task) en el ledger, justificando que no produzca `.specs/<feature>/spec.md` ni `.specs/<feature>/plan.md` canónicos.

## Cierre de sesión

Al cerrar:
- Verificar presencia y tamaño no-vacío de los 12 artefactos.
- Generar mensaje final con `wc -c` por artefacto.
- Loguear `phase_exit` en el ledger.
- `SESSION_CLAUDE.md` queda como evidencia histórica de las reglas vigentes durante la auditoría.
