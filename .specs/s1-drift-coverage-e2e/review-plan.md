# Review plan: s1-drift-coverage-e2e (devils-advocate pass del plan)

- Plan: [`plan.md`](./plan.md) (Status Draft v1)
- Spec base: [`spec.md`](./spec.md) (Approved v2)
- Review previo (spec): [`review.md`](./review.md) (13 obj aplicadas)
- Sub-agente: `agent-rigor:devils-advocate`
- Fecha: 2026-05-18
- Ledger: `.claude/ledger/2026-05-17_8eef12fe-1dfc-4389-936f-139caac69d93.jsonl`

---

## P0 (bloqueantes — debe resolverse antes de approve)

### O-1: T1.2 es N tasks compuestas con waiver implícito, no atómico

- **Cita**: `plan.md` §T1.2 "~150-200 LOC según inventario" + §Verification waiver list.
- **Problema**: T1.2 declara 150-200 LOC pero NO en lista de waivers (T1.6, T1.9, T1.10). Si inventario T1.1 arroja N=8, T1.2 es 8 columnas/enums como **una task** = PR gigante imposible de revisar. Skill 20 §Step 7 "T_n is two tasks pretending to be one".
- **Propuesta**: T1.2 reformula como plantilla recurrente **T1.2a, T1.2b, …, T1.2n** — una por divergencia Clase A. Cada sub-task ≤100 LOC PR propio. Cierre T1.2 cuando todas las sub-tasks Implemented. Estimación: `N × ~60 LOC`.

### O-2: T1.7 es cuatro tasks pretending to be one

- **Cita**: `plan.md` §T1.7 — 5 archivos código + 1 doc + LOC ~220 sin waiver declarado.
- **Problema**: Toca config + 3 services + test + followup doc (cuyo contenido se conoce solo post-auditoría = circular). "Rollback flag OFF retoma legacy <5 min" depende de que el wiring del flag de la **misma** task que se quiere rollbackear esté correcto. Self-referential rollback.
- **Propuesta**: split en T1.7a (flag config + 1 service + test) → T1.7b (segundo service + test) → T1.7c (tercer service + test) → T1.7d (followup doc post-auditoría). Cada paso mergeable independiente con flag OFF.

### O-3: T1.10 explícitamente 4 cosas + spike no es task

- **Cita**: `plan.md` §T1.10 "400-500 LOC waiver" + "Pre-task: spike auth (30 min)".
- **Problema**: 4 specs Playwright + spike sin acceptance + no hay decisión documentada de quién aprueba blowup si spike concluye "+200 LOC extend fixture".
- **Propuesta**: T1.10.spike (output: doc con decisión auth + LOC estimado revisado, firma PO si >50 LOC extend) → T1.10a (login-universal, valida fixture) → T1.10b (shipper-publica-carga) → T1.10c (carrier-acepta-oferta) → T1.10d (public-tracking-via-link). CI job T1.11 puede arrancar tras T1.10a.

### O-4: Gate SC-S1.0 sin enforcement operacional — honor system

- **Cita**: `plan.md` §Gates SC-S1.0.
- **Problema**: Nada estructural evita que el agente, tras producir inventory.md con N=14, ejecute T1.2 sin esperar firma PO. No hay pre-commit hook ni CI gate. CLAUDE.md §"Process over knowledge" prohíbe honor system. Felipe (solo-dev) es agente y PO → conflicto de interés.
- **Propuesta**:
  - (a) `drift-inventory.mjs` retorna **exit code ≠ 0** si N > 10 o Clase C ≥ 1.
  - (b) Pre-commit hook que rechaza commits con scope `feat(domain)` si `inventory.md` tiene `gate: PENDING_PO`.
  - (c) Checkpoint día 5 idem: hook que advierte si gate no documentado.

### O-5: Velocity S0→S1 asumida sin evidencia y plan sube ~50%

- **Cita**: `plan.md` §1 "8-12 días honestos" + spec §9 burnout H/M + S0 cerró ~1200 LOC en 5h.
- **Problema**: Plan declara ~1800 LOC. Asume Felipe sostiene 150 LOC/día durante 8-12 días con cooling-off + pausa >3h + post-burnout H/M. Posible matemáticamente pero **cero buffer** para re-work tras devils-advocate de cada PR. Sin evidencia que respalde el ritmo sostenido.
- **Propuesta**:
  - (a) Reestimar **10-14 días con buffer 20%**.
  - (b) Declarar ritmo objetivo explícito ("máx 1 task atómica por día + 1 review pass").
  - (c) Pre-emptivo: si día 5 muestra <40% LOC plan, split S1a/S1b se ejecuta automáticamente (sin discusión).

---

## P1

### O-6: T1.6 depende de "T1.2 cerrado" — ambiguo si T1.2 es N PRs

- **Cita**: `plan.md` §T1.6 Depends on.
- **Problema**: Si O-1 aplica y T1.2 es T1.2a..T1.2n, ¿T1.6 espera al último PR Clase A o al que toca `tripStatusEnum` específicamente? Plan tal cual serializa innecesariamente.
- **Propuesta**: T1.6 Depends on "T1.2 sub-task que toca `tripStatusEnum`". Explicitar a nivel valor enum, no bloque.

### O-7: T1.5 dependency tree mentido si Clase B/C no aplican

- **Cita**: `plan.md` §T1.5 "T1.2 + (T1.3 si aplica) + (T1.4 si aplica)".
- **Problema**: LOC ~120 dimensionado asumiendo 3 patterns. Si solo Pattern A, test es 40 LOC; 3 patterns son 120+. Estimación no se ajusta.
- **Propuesta**: T1.5 LOC = `40 × patterns_aplicables`, anotado en inventory.md tras T1.1.

### O-8: T1.4b "revert con T1.4" no es rollback honesto si tabla ya en uso

- **Cita**: `plan.md` §T1.4b Rollback.
- **Problema**: Si tabla nueva tiene datos (poblados por integration tests o CronJob), down-migration falla o pierde datos. Rollback teórico no operacional.
- **Propuesta**: Documentar dos paths: (a) drop policy + queda tabla sin RLS (no rollback de seguridad); (b) si datos no críticos, down-migration. Acceptance prueba ambas.

### O-9: T1.checkpoint y T1.14 son acceptance procedimental, no de valor

- **Cita**: `plan.md` §T1.checkpoint + §T1.14.
- **Problema**: Felipe puede marcar T1.checkpoint DONE con "todo va bien" aunque Bloques A+B no estén Implemented. Self-fulfilling.
- **Propuesta**: T1.checkpoint acceptance: (a) tabla LOC mergeado vs planificado por bloque; (b) ratio ≥40% Bloques A+B mandatorio para no-split; (c) firma PO con justificación **cuantitativa**. T1.14 idem: tabla PRs + ADRs + SC-S1.* check con evidencia citada.

### O-10: OQ-S1.2 y OQ-S1.3 abiertas sin trigger de resolución

- **Cita**: `plan.md` §Open questions.
- **Problema**: "Decisión durante T1.X" sin acceptance explícito = drift `later`.
- **Propuesta**: T1.6 acceptance añade "OQ-S1.2 resuelta en README package". T1.12 idem para OQ-S1.3.

---

## P2

### O-11: Plan en borde del flag "spec disfrazada de plan" (15+ tasks)

- **Cita**: Skill 20 §Verification "Plan has 15+ tasks → spec demasiado grande, split".
- **Problema**: Plan tiene 14 tasks + checkpoint + followup = 15-16 items. **Si O-1/O-2/O-3 aplican**, sube a 25+ items. Confirma que la spec misma es demasiado grande y debería haber sido S1a (drift + state machine, ~8 items) y S1b (coverage + Playwright, ~7 items) **pre-sprint**, no contingencia día 5.
- **Propuesta**: Split pre-sprint en lugar de contingencia. Producir **2 plans**: `plan-s1a.md` (T1.1-T1.7) + `plan-s1b.md` (T1.8-T1.13). Checkpoint día 5 deja de ser gate de split y pasa a ser "S1a cerrado, ¿arrancar S1b?".

---

## Top 3 que cambian el plan

1. **O-1 + O-2 + O-3 combinadas**: T1.2, T1.7 y T1.10 son tasks compuestas que violan skill 20 §atomicidad. Plan necesita split de las tres en sub-tasks atómicas con waivers explícitos.
2. **O-4**: Gate SC-S1.0 sin enforcement (hook/CI/exit code) = honor system. CLAUDE.md §"Process over knowledge" lo prohíbe.
3. **O-5 + O-11 (decisión estructural)**: velocity asumida sin evidencia + plan en borde de 15+ tasks → **split pre-sprint S1a/S1b** vs contingencia día 5. Decisión PO con impacto grande: aceptar "1 sprint con split contingente" (status quo del plan v1) o "2 sprints planeados desde inicio".

---

## Status de aplicación (2026-05-18)

PO decidió aplicar **todas las 11 objeciones (P0 + P1 + P2)** incluyendo **split pre-sprint O-11**.

| Obj | Severidad | Status | Cambio aplicado |
|---|---|---|---|
| **O-1** | P0 | ✅ Applied | T1.2 split en T1.2a..T1.2n (una sub-task por divergencia Clase A; ≤80 LOC c/u) en `plan-s1a.md` |
| **O-2** | P0 | ✅ Applied | T1.7 split en T1.7a..T1.7d (flag+1service, +2do svc, +3er svc, followup doc) en `plan-s1a.md` |
| **O-3** | P0 | ✅ Applied | T1.10 split en T1.10.spike + T1.10a..T1.10d (login valida fixture primero); cada spec ≤100 LOC en `plan-s1b.md` |
| **O-4** | P0 | ✅ Applied | Gate SC-S1.0 con enforcement: script exit code 1 si N>10 o Clase C≥1 + pre-commit hook bloquea scope `feat(domain)` si `gate: PENDING_PO` |
| **O-5** | P0 | ✅ Applied | Estimación honesta 9-13 días total (5-7 S1a + 4-6 S1b) con buffer 20% + ritmo declarado "max 1 task/día + 1 review pass" + velocity tracking en `velocity-tracking.md` |
| **O-6** | P1 | ✅ Applied | T1.6 Depends on "T1.2 sub-task que toca `tripStatusEnum`" (granular a nivel valor enum) |
| **O-7** | P1 | ✅ Applied | T1.5 LOC adaptive: `40 × patterns_aplicables` según inventario |
| **O-8** | P1 | ✅ Applied | T1.4b rollback con dos paths documentados (drop policy / down-migration) + acceptance prueba ambas |
| **O-9** | P1 | ✅ Applied | T1.checkpoint + T1.S1a.cierre + T1.14 con acceptance cuantitativa (tabla LOC mergeado vs planificado + ratio ≥40% mandatorio + firma PO con justificación numérica) |
| **O-10** | P1 | ✅ Applied | OQ-S1.2 trigger en acceptance T1.6 ("OQ-S1.2 resuelta en README"); OQ-S1.3 trigger en acceptance T1.12 |
| **O-11** | P2 | ✅ Applied | **Split pre-sprint S1a/S1b**: 2 plans separados (`plan-s1a.md` + `plan-s1b.md`) + `plan.md` como índice maestro. Checkpoint día 5 ya no es gate de split (es gate de cierre S1a → arranque S1b) |

11/11 objeciones aplicadas. Plan v2: 3 documentos (`plan.md` índice + `plan-s1a.md` 195 LOC + `plan-s1b.md` 220 LOC).

## Decision log

- **2026-05-18** — Devils-advocate pass sobre plan. 5 P0 + 5 P1 + 1 P2 = 11 objeciones.
- **2026-05-18** — PO aprobó aplicar **todas** + **split pre-sprint O-11**.
- **2026-05-18** — Plan v2 producido: 3 archivos (índice maestro + plan-s1a + plan-s1b) con tasks atomizadas, gates enforced, estimación honesta.
