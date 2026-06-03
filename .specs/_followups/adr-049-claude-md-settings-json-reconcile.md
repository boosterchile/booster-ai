# Follow-up — Reconciliar ADR-049 / CLAUDE.md (`.claude/settings.json` inexistente)

**Origen**: inventario ADR-vs-prod 2026-06-03 (`.specs/adr-vs-prod-inventory/inventory.md`, finding 🔴 ADR-049).
**Tipo**: deuda documental / contrato. **Riesgo**: medio (contrato; no externo). **Estado**: pendiente.

## Problema

Tanto **ADR-049** (Capa 3) como **CLAUDE.md** (§Estructura del repo v3) afirman que el repo **declara los plugins a project scope** vía `.claude/settings.json`:
> `.claude/settings.json # declara plugins (project scope)`

**Realidad verificada (2026-06-03):**
- `.claude/settings.json` **NO existe**.
- `git ls-files .claude/` → **vacío**: nada en `.claude/` está versionado (solo `settings.local.json` gitignored, que tiene `permissions.allow`, SIN key de plugins; y ledgers `.jsonl` de sesión, gitignored).
- Ninguna referencia versionada a `agent-rigor`/`booster-skills` en el repo.

Los plugins **sí están activos** en sesión (el hook `SessionStart` cargó agent-rigor — visible este turno), pero la activación viene de **config global/usuario (`~/.claude`)**, NO del repo. Es decir: un clon fresco del repo NO trae los plugins declarados, contradiciendo lo que el contrato (CLAUDE.md) y el ADR afirman.

> Nota: el propio ADR-049 §Validación dejó ese ítem como checkbox `[ ]` sin marcar (PR-2 no materializado) — pero CLAUDE.md sí lo presenta como hecho consumado.

## Opciones (decisión del PO — NO ejecutado)

1. **Materializar lo afirmado**: crear `.claude/settings.json` versionado que declare `agent-rigor` + `booster-skills` a project scope (lo que el ADR/CLAUDE.md prometen). Pro: reproducibilidad real (clon fresco trae plugins). Requiere confirmar el formato de declaración de plugins en settings.json.
2. **Corregir el contrato**: actualizar CLAUDE.md (y supersede/nota en ADR-049) para reflejar que los plugins se configuran a nivel usuario/global, no en el repo. Pro: honesto y menor esfuerzo.

CLAUDE.md está en la lista "NUNCA toco sin permiso explícito" → cualquiera de las dos requiere aprobación del PO. Es doc/config, no toca código de producto ni infra.

## Relación

Parte del mismo patrón "narrativa-vs-realidad" que el follow-up de ADR-020 ([[adr-020-supersede-gitlab-to-github-actions]]). Ambos son discrepancias doc/contrato detectadas en el cierre del inventario.
