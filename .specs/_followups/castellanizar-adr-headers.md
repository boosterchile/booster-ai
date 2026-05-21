# Followup: castellanizar-adr-headers

**Status**: Draft (stub, no ejecutar todavía)
**Created**: 2026-05-21
**Triggered by**: Devils-advocate REVIEW round 2 — S1 finding ("28 ADRs en inglés siguen con `**Status**`/`**Date**` cuando ADR-045..049 + 002 usan `**Estado**`/`**Fecha**`")
**Estimated effort**: 30-45 min (script sed + verificación por ADR + commit)

---

## Objetivo

Castellanizar los headers `**Status**` → `**Estado**` y `**Date**` → `**Fecha**` en los 28 ADRs históricos que siguen en inglés, para consistencia con la convención post-ADR-049 (todos en español).

## Trigger (cuándo ejecutar)

- Como parte de un sprint de cleanup documental siguiente.
- Cuando se note inconsistencia idiomática durante una sesión `/review` futura.
- Cuando se decida unificar todos los ADRs (e.g., antes de submission a auditoría ISO 27001 / SOC 2).

## Inputs requeridos

- Lista de los 28 ADRs afectados (obtenida vía `grep -lE "^\*\*Status\*\*|^\*\*Date\*\*" docs/adr/*.md`).
- ADR-046 §1: "los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo."
- **Excepción válida para esta tarea**: castellanizar el header NO altera el contenido decisional ni la semántica del ADR. Es un fix de format/convention. Similar al patrón Supersedence Note en ADR-002 (T5) que sí lo editó.

## Procedimiento (esbozado)

1. Crear branch `chore/castellanizar-adr-headers`.
2. Script `sed -i ''` sobre los 28 ADRs en batch:
   ```bash
   for adr in docs/adr/001 docs/adr/004 ... docs/adr/048; do
     sed -i '' 's/^\*\*Status\*\*:/\*\*Estado\*\*:/' $adr*.md
     sed -i '' 's/^\*\*Date\*\*:/\*\*Fecha\*\*:/' $adr*.md
   done
   ```
3. Verificar empíricamente que ningún ADR queda con header mixto (e.g., `Estado` + `Date`).
4. Verificar `pnpm typecheck` / lint no rompen (improbable, son docs).
5. Commit `docs(adr): castellanizar headers Status/Date a Estado/Fecha en 28 ADRs historicos`.
6. PR + squash merge.

## Acceptance criteria

- `grep -lE "^\*\*Status\*\*|^\*\*Date\*\*" docs/adr/*.md` retorna count 0.
- Todos los ADRs usan `**Estado**`/`**Fecha**` consistentemente.
- CI verde (lint, typecheck, test pasan).

## Riesgo / consideraciones

- ADR-046 §1 puede objetarlo. Mitigación: documentar en el PR body que el cambio es FORMAT/CONVENTION (no decisional), respeta el principio §1 al no alterar la decisión histórica.
- Algunos ADRs pueden tener variantes en el header (e.g., `Date: 2026-04-23` sin asteriscos). Script debe ser robusto.

## Prompt para sesión futura (copy/paste)

```
Retomar followup en .specs/_followups/castellanizar-adr-headers.md.

Contexto: PR-2 castellanizó solo ADR-049 + ADR-002 (los del scope). 28 ADRs históricos quedaron en inglés ("Status"/"Date"). Este followup completa la unificación idiomática.

Leer:
1. .specs/_followups/castellanizar-adr-headers.md (este archivo)
2. docs/adr/046-historical-adr-numbering-collisions.md (§1 prohibe edición; justificar excepción format/convention)
3. docs/adr/049-claude-code-plugin-system-adoption.md (precedente Estado/Fecha)

Crear spec si querés tracking formal (.specs/castellanizar-adr-headers/spec.md). O ejecutar directo si es work mecánico aceptado por PO.
```

## Notas

- Bajo prioridad (cosmético, no afecta funcionalidad).
- Si pasa >180 días sin ejecutar, el PO debe re-evaluar si la inconsistencia idiomática se acepta de facto.
