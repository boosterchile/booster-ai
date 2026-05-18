# Plan maestro: s1-drift-coverage-e2e (split S1a + S1b)

- Spec: [`spec.md`](./spec.md) (Approved v2 2026-05-18)
- Review spec: [`review.md`](./review.md) (13 obj aplicadas)
- Review plan: [`review-plan.md`](./review-plan.md) (11 obj aplicadas en split + atomization)
- Created: 2026-05-18
- Status: **Approved** (PO 2026-05-18, v2 post devils-advocate plan)

---

## Decisión: split pre-sprint S1a / S1b (cubre O-11 review-plan)

El plan v1 caía justo en el borde del flag "Plan has 15+ tasks → spec demasiado grande, split" de skill 20 §Verification. Aplicar las objeciones O-1/O-2/O-3 (split T1.2, T1.7, T1.10 en sub-tasks atómicas) habría producido 25+ items en un solo plan. Decisión PO: **split pre-sprint en S1a y S1b**, no como contingencia día 5.

| Sub-sprint | Scope | Plan | Cubre SC-S1.* |
|---|---|---|---|
| **S1a** | Drift schema/domain + trip-state-machine | [`plan-s1a.md`](./plan-s1a.md) | SC-S1.0, .1, .2, .3, .4, .4b, .5, .6, .6b |
| **S1b** | Branches coverage api + 4 Playwright + sharding | [`plan-s1b.md`](./plan-s1b.md) | SC-S1.7a, .7b, .9, .10, .11, .12 |
| **Cierre conjunto** | Checkpoint + CURRENT.md update | en `plan-s1b.md` §Cierre | SC-S1.checkpoint, .14 |

**S1b arranca solo si S1a cierra OK** (todos los SC del bloque A+B en `Implemented`). Si S1a se desliza más allá del bound estimado, S1b se difiere a un sprint separado con su propio /spec.

---

## Estimación honesta (cubre O-5)

| Sub-sprint | LOC estimado | Días lane Felipe | Buffer 20% incluido |
|---|---|---|---|
| **S1a** | ~700–900 | 5–7 días | sí |
| **S1b** | ~700–900 | 4–6 días | sí |
| **Total** | ~1400–1800 | **9–13 días** | sí |

Ritmo objetivo declarado: **máx 1 task atómica por día + 1 review pass**. Trackeado en `.specs/s1-drift-coverage-e2e/velocity-tracking.md` (creado al arrancar S1a, updated por cada PR mergeado).

---

## Gates con enforcement operacional (cubre O-4)

| Gate | Cuándo | Enforcement |
|---|---|---|
| **SC-S1.0 stop-the-line** | Post-T1.1 (drift inventario) | `scripts/repo-checks/drift-inventory.mjs` retorna **exit code 1** si `N > 10` o `Clase C ≥ 1`; CI bloquea cualquier commit con scope `feat(domain)` hasta que `.specs/.../inventory.md` tenga `gate: APPROVED_BY_PO`. |
| **SC-S1.7a (lista nombrada)** | Pre-T1.9 (coverage tests) | T1.9 no puede arrancar (PR rechazado por convención) si `.specs/.../coverage-targets.md` tiene <10 paths. |
| **Cierre S1a → arranque S1b** | Post-S1a último PR | Decisión PO documentada en `.specs/.../s1a-cierre.md` con tabla LOC mergeado vs planificado + ratio cuantitativo ≥40% por bloque A+B. Sin este doc, S1b no arranca. |
| **Velocity check S1a** | Día 3-4 de S1a | Si LOC mergeado <40% planificado para S1a, **paraliza T1.6** y replan con scope reducido (eliminar refactor T1.7 a S2). |

---

## Pickup orden honesto

1. **Día 0** (planning + lectura, cubre O-10): NO ejecución. Releer spec v2 + plan-s1a.md + ADR-043 con ojos frescos. Pausa autoimpuesta si sesión >3h.
2. **S1a arranca día 1** con T1.1 (script `drift-inventory.mjs`).
3. **Post-T1.1 gate SC-S1.0** evaluado. Si falla, replan obligatorio.
4. **S1a corre día 1-7** según gates.
5. **Cierre S1a** (decisión PO): si OK → arranca S1b. Si no → S1b se difiere.
6. **S1b corre día 8-13** según cierre S1a.

---

## Verification (skill 20 §Verification)

- [x] Plan split en 2 sub-plans (cubre O-11) — `plan-s1a.md` + `plan-s1b.md`.
- [x] Todas las tasks compuestas atomizadas (cubre O-1, O-2, O-3): T1.2 → T1.2a..T1.2n; T1.7 → T1.7a..T1.7d; T1.10 → T1.10.spike + T1.10a..T1.10d.
- [x] Gates con enforcement operacional (cubre O-4): exit code script + pre-commit hook + doc PO firmado.
- [x] Estimación honesta + ritmo declarado + velocity tracking (cubre O-5).
- [x] Dependencies granulares a nivel valor enum (cubre O-6).
- [x] T1.5 LOC adaptive según patterns aplicables (cubre O-7).
- [x] T1.4b rollback con dos paths documentados (cubre O-8).
- [x] Acceptance cuantitativa en T1.checkpoint y T1.14 (cubre O-9).
- [x] OQ-S1.2 y OQ-S1.3 con acceptance triggers explícitos (cubre O-10).
- [x] Devils-advocate output captured en `review-plan.md`.

## Decision log

- **2026-05-18** — Plan v1 producido con 14 tasks + checkpoint.
- **2026-05-18** — Devils-advocate pass plan: 5 P0 + 5 P1 + 1 P2 (review-plan.md).
- **2026-05-18** — PO aprobó aplicar **todas (P0+P1+P2)** incluyendo split pre-sprint O-11.
- **2026-05-18** — **Plan v2 producido**: 2 sub-plans (S1a + S1b) + plan maestro (este doc) con gates + estimación honesta + velocity tracking.
- **2026-05-18** — **APPROVED por PO** (plan maestro + plan-s1a + plan-s1b). S1a puede arrancar BUILD cuando PO lo señale (cooling-off recomendado por skill 20).
