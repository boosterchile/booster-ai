---
description: Actualizar HANDOFF.md al cierre de un sprint mayor
---

# /handoff — Actualizar el estado vivo del repo

Cierra un sprint mayor sincronizando `HANDOFF.md` con la realidad del código. Sirve como "checkpoint" que cualquier agente futuro puede consumir para arrancar sin perderse.

## Cuándo usar

- Al terminar un sprint con ≥5 commits cohesivos cerrados.
- Cuando un bloqueante de `AUDIT.md` §5 se cierra.
- Cuando se añade un nuevo ADR o se supersedea uno existente.
- Antes de un cambio de owner/agente en el repo.
- Al inicio de cada lunes (cadencia mínima).

## Proceso

1. **Recolectar evidencia del sprint**:
   ```bash
   git log --oneline main..HEAD              # commits del sprint
   git diff main..HEAD --stat                # archivos tocados
   git diff main..HEAD docs/adr/             # ADRs nuevos
   ```

2. **Identificar deltas vs HANDOFF.md actual**:
   - ¿Qué apps cambiaron de skeleton → MVP → funcional?
   - ¿Qué packages cambiaron de placeholder → MVP → funcional?
   - ¿Qué bloqueantes cerraron?
   - ¿Qué ADRs nuevos quedaron documentados (o pendientes en §3)?

3. **Actualizar `HANDOFF.md`**:
   - **§1 Snapshot de hoy**: branch activo, último commit, sprint cerrado, contadores apps/packages/ADRs.
   - **§2 Sprints cerrados**: agregar fila nueva agrupando los commits del sprint.
   - **§3 Decisiones sin ADR**: añadir nuevas decisiones detectadas; mover a "ADR materializado" las que se documentaron.
   - **§4 Bloqueantes activos**: tachar los cerrados, añadir nuevos.
   - **§5 Próximos pasos**: re-priorizar.
   - **§8 Issues abiertos**: actualizar tabla.

4. **Sincronizar `AUDIT.md`** si la auditoría macro cambió:
   - Si pasó de "5/8 apps funcionales" a "6/8" → actualizar §1 y §3.
   - Si una capa cruzó un threshold (50%, 75%, 90%) → actualizar tabla §1.
   - Mover ítems cerrados de §5 al histórico §9.

5. **Commit dedicado**:
   ```
   docs(handoff): sprint <slug> cerrado — actualiza HANDOFF + AUDIT
   ```

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Ya lo digo en el PR description" | El PR se archiva. `HANDOFF.md` queda en el repo y es lo que ven los agentes nuevos. |
| "Actualizo solo `HANDOFF.md`, `AUDIT.md` está bien" | Si la auditoría macro cambió, ambas deben moverse juntas. |
| "Es trabajo manual repetitivo" | Es el feed de contexto del próximo agente. Saltarlo = sesión 1 perdida en re-descubrir estado. |

## Exit criteria

- [ ] `HANDOFF.md` §1 refleja branch + último commit + contadores actuales.
- [ ] `HANDOFF.md` §2 tiene fila del sprint cerrado.
- [ ] Bloqueantes cerrados marcados/movidos.
- [ ] `AUDIT.md` §1 tabla actualizada si los porcentajes cambiaron.
- [ ] Commit `docs(handoff): ...` pusheado.
