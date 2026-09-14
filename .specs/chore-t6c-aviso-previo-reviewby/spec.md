# Spec: chore-t6c-aviso-previo-reviewby

- Author: Felipe Vicencio (with Claude Fable 5.1)
- Date: 2026-09-05
- Status: Approved
- Linked: follow-up declarado en PR #668 (renovación de `reviewBy`, mergeada `5af6cf6`); job `is-demo allowlist comment-lint (SC-1.3.6 T6c)` en `.github/workflows/security.yml`; `apps/api/scripts/check-is-demo-allowlist-comments.ts`; regla 2 de `apps/api/src/middleware/is-demo-allowlist.ts` («`reviewBy` ≤90 días; re-review obligatoria al expirar»).

## 1. Objective

Que el gate T6c avise con anticipación cuando una entrada del allowlist está por vencer, sin dejar de fallar cuando ya venció. El aviso sale en el log del job y como anotación `::warning` de GitHub Actions, visible en la pestaña de checks de cualquier PR y en la corrida programada sobre `main`. `security.yml` no cambia.

## 2. Why now

Las 6 entradas vencieron el 25 y 26 de agosto y nadie lo supo hasta que #667 salió rojo el 5 de septiembre, diez días después. La corrida programada sobre `main` del 31 de agosto ya había fallado sin consumidor. El próximo vencimiento es el 2026-12-04; sin aviso previo el patrón se repite.

## 3. Success criteria

- [ ] Tests nuevos en `apps/api/test/scripts/check-is-demo-allowlist-comments.test.ts` en ROJO antes de implementar (output en la Evidencia de la PR) y en verde después.
- [ ] `findExpiringEntries(entries, now, warnDays)` devuelve exactamente las entradas con `now < reviewBy ≤ now + warnDays`, con `daysLeft`; las vencidas siguen siendo errores, no avisos; `warnDays = 0` no avisa; el borde `reviewBy = now + warnDays` avisa y `now + warnDays + 1` no.
- [ ] CLI: umbral por defecto 14 días; `--warn-days=N` para override local; valor no entero o negativo → exit 2 con mensaje de uso.
- [ ] Corrida real contra el allowlist de `main` @ `10f8c77`: por defecto → `OK — 5 entries validated` sin avisos y exit 0; con `--warn-days=120` → 5 avisos con días restantes y exit 0.
- [ ] Con `GITHUB_ACTIONS=true` cada aviso emite `::warning file=apps/api/src/middleware/is-demo-allowlist.ts,line=<n>,title=...::<mensaje>`.
- [ ] Una entrada vencida sigue produciendo exit 1 (sin cambio de contrato del gate).
- [ ] `security.yml` sin cambios; `check-allowlist-pr-guard.ts` (T6d) sin cambios y sus tests en verde.
- [ ] typecheck, Biome y vitest verdes; CI de la PR verde.

## 4. User-visible behaviour

Ninguno (solo CI).

## 5. Out of scope

- Recordatorio agendado que abra o actualice un issue al acercarse el vencimiento: más visible, pero agrega un workflow nuevo; queda como opción si el aviso en PR resulta insuficiente.
- Cambiar la regla de ≤90 días o el modo del middleware.
- Tocar T6d.

## 6. Constraints

1. No relajar T6c: vencida = exit 1, igual que hoy.
2. Sin tocar `.github/workflows/*` (quality gate reservado al PO; este chore entra por su orden expresa del 2026-09-05).
3. Sin dependencias nuevas; funciones puras con `now` inyectable para tests deterministas.
4. Este chore no pertenece a ninguno de los tres frentes vivos.

## 7. Approach

Función pura `findExpiringEntries` junto a `validateEntries`; `main()` calcula avisos solo si no hay errores, los imprime a stderr y, bajo GitHub Actions, como anotaciones `::warning`; exit 0. Parser de `--warn-days=N` mínimo. Tests con `now` fijo cubriendo borde, vencida, `warnDays=0` y formato de anotación.

## 8. Alternatives considered

- **Poner T6c en rojo N días antes.** Descartada: convierte un aviso en bloqueo de PRs ajenas, exactamente el problema que se quiere evitar.
- **Workflow agendado con issue automático.** Postergada (§5): más maquinaria y toca `.github/workflows`; el aviso en el gate existente cubre el caso sin costo de mantenimiento.
- **Umbral como variable del workflow.** Descartada: obligaría a editar `security.yml`; el default en el script con override por CLI cubre local y CI.
