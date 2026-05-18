# ADR-046 — Colisiones históricas de numeración ADR (028, 034, 035)

**Fecha**: 2026-05-17
**Estado**: Accepted
**Refs**:
- `scripts/repo-checks/check-adr-numbering.mjs` (T3 de S0 — guard de numeración)
- `.husky/pre-commit` (invoca el guard con `--allow-legacy 028,034,035`)
- `docs/handoff/CURRENT.md` §Housekeeping ADRs (documentación previa)
- `.specs/s0-housekeeping/spec.md` SC-S0.4
- `.specs/production-readiness/spec.md` SC-6
- Devils-advocate objection O-8 (review.md de S0) — exige TTL explícito

## Contexto

El repo arrastra **3 colisiones históricas** de numeración ADR (pre-ADR-040), introducidas durante el desarrollo intensivo de Waves 1-6 (2026-05-09..2026-05-13). Hasta ADR-039 no había una regla escrita de "un número por archivo"; varios PRs paralelos consumieron el siguiente número libre sin coordinación entre branches.

Las tres colisiones, identificadas por el guard `scripts/repo-checks/check-adr-numbering.mjs`:

| ADR # | Archivo | Commit | PR |
|---|---|---|---|
| **028** | `028-dual-source-data-model-teltonika-vs-maps.md` | `e3e726e` | [#89](https://github.com/boosterchile/booster-ai/pull/89) |
| **028** | `028-rbac-auth-firebase-multi-tenant-with-consent-grants.md` | `488c931` | (chore directo, no PR) |
| **034** | `034-gcp-cost-efficiency-2026-05.md` | `982c8e0` | [#191](https://github.com/boosterchile/booster-ai/pull/191) |
| **034** | `034-stakeholder-organizations.md` | `5388143` | [#198](https://github.com/boosterchile/booster-ai/pull/198) |
| **035** | `035-auth-universal-rut-clave-numerica.md` | `635d9cb` | [#181](https://github.com/boosterchile/booster-ai/pull/181) |
| **035** | `035-trl10-mantener-ha-recortar-ruido.md` | `982c8e0` | [#191](https://github.com/boosterchile/booster-ai/pull/191) |

> Notar: el PR #191 introdujo **2 colisiones de una vez** (gcp-cost-efficiency colisionó con stakeholder-organizations en 034, y trl10 colisionó con auth-universal en 035 ese mismo merge).

Desde **ADR-040 (incluido)**, aplica disciplina "**un número por archivo**". El guard `check-adr-numbering` (mergeado en PR #281 como parte de T3 del sprint S0) detecta cualquier nueva colisión en pre-commit, bloqueando el commit hasta que el ADR nuevo se renombre al siguiente número libre.

## Decisión

### 1. Las 3 colisiones legacy **no se renumeran nunca**

Las 6 archivos listados arriba mantienen sus nombres actuales **a perpetuidad**. No hay sprint futuro planificado para renumerarlos.

**Razones**:

- **Costo de renumerar = alto, beneficio = estético**: renumerar requiere `git mv` (preserva history TS) + actualizar referencias internas en otros ADRs/specs/handoffs + comunicar a quien tenga bookmarks a los PRs/commits originales (referencias externas no actualizables).
- **Las referencias externas no son rebaseables**: GitHub PRs (#89, #181, #191, #198), commit SHAs (`e3e726e`, `488c931`, `982c8e0`, `5388143`, `635d9cb`), y cualquier link compartido por Slack/email/runbook quedaría apuntando al nombre viejo. La integridad histórica del repo se vería degradada sin valor a cambio.
- **Cero impacto funcional**: el guard `check-adr-numbering` con `--allow-legacy 028,034,035` permite seguir mergeando ADRs nuevos sin fricción. No hay degradación operacional.
- **Costo de la excepción = 1 línea**: en `.husky/pre-commit` la cadena `--allow-legacy 028,034,035` es la deuda total. Más simple que cualquier alternativa.

### 2. Excepción permanente codificada explícitamente

La lista de números legacy permitidos vive en **dos** lugares (intencionalmente, para que cualquier dev futuro la encuentre):

1. `.husky/pre-commit` — argumento `--allow-legacy 028,034,035` del invocador del guard.
2. Este ADR — fuente narrativa explicando por qué.

**Cualquier modificación a la lista** (agregar o quitar números) requiere:
- Nuevo ADR que supersede este (`supersedes: 046`).
- Justificación específica caso por caso.
- Actualizar `.husky/pre-commit`.

### 3. Disciplina "un número por archivo" desde ADR-040

Aplica retroactivamente a todos los archivos `docs/adr/04N-*.md` y siguientes. El guard ya lo enforza desde el pre-commit hook. Cualquier intento de mergear `docs/adr/047-foo.md` cuando ya existe `docs/adr/047-bar.md` falla con exit 1 sin pasar el hook.

## Consecuencias

### Positivas

- **Estado del guard cerrado**: el pre-commit ya tiene la decisión final cableada (no es estado transitorio esperando otra decisión).
- **History preservada**: las 6 archivos legacy mantienen su trazabilidad git completa, sus PRs originales siguen siendo navegables sin redirección.
- **Convención clara forward**: cualquier ADR ≥ 040 cumple "un número por archivo" sin excepciones. Nuevos developers pueden confiar en que `docs/adr/NNN-` es único.
- **Cero ruido operacional**: el `--allow-legacy` no aparece en logs cuando todo está en orden (`OK — no collisions ... (legacy allowed: 028,034,035)`).

### Negativas

- **Lista hardcoded en pre-commit**: si el archivo `.husky/pre-commit` se reescribe sin cuidado (ej. por refactor automatizado), la lista puede perderse. Mitigación: este ADR documenta el `why`; cualquier reescritura del hook debe consultar.
- **Pequeña inconsistencia estética visual**: `ls docs/adr/` muestra dos archivos comenzando con `028-`, `034-`, `035-`. Trade-off aceptado.

### No mitigadas (out of scope ADR-046)

- **Si alguien crea un ADR-NNN distinto a las 6 legacy con número 028/034/035**: el guard NO lo detectaría porque está en la allowlist. Edge case improbable (el primer ADR nuevo iría a 047+), pero documentar acá como conocido. Si se materializa, sub-ADR de fix.
- **Renumeración futura por requerimiento externo** (ej. publicar ADRs en un sitio web que rechace duplicados de prefijo): si surge, este ADR se supersede con un plan de renumeración explícito.

## Alternativas consideradas

### A. TTL finito (renumerar en sprint X) — RECHAZADA

Devils-advocate O-8 sugirió "renumerar en sprint X" como alternativa a "perpetuo". Rechazada porque:
- Ningún sprint del plan production-readiness se beneficia de la renumeración.
- El costo se incurre cuando se ejecuta el sprint X, pero no hay un "X" justificable.
- "Sprint X = nunca" es funcionalmente equivalente a "perpetuo" pero menos honesto.

### B. Renumerar ahora — RECHAZADA

Igual razón que A pero ejecutado inmediatamente. Adiciona costo de coordinación (referencias externas) sin urgencia. La objection O-8 advirtió contra el <quote>for now</quote> implícito del flag — la respuesta correcta es decisión definitiva ("perpetuo"), no acción inmediata.

### C. Sin ADR explícito (mantener solo el flag) — RECHAZADA

Status quo pre-T4. Rechazada porque el devils-advocate O-8 levantó precisamente este punto como objeción P1 (review.md de S0): el flag sin TTL ni ticket es drift vocabulary suave. Este ADR cierra el ciclo de decisión.

## Validación

- [ ] `scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` retorna exit 0 contra `docs/adr/` actual.
- [ ] `scripts/repo-checks/check-adr-numbering.mjs` sin flag retorna exit 1 listando las 3 colisiones esperadas (ya validado en PR #281).
- [ ] `.husky/pre-commit` invoca el guard con la lista `028,034,035` exactamente.
- [ ] Pre-commit bloquea si se intenta mergear un ADR-047 cuando ya existe otro `047-*.md` (verificable agregando uno de prueba en branch desechable).
