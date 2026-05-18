# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-05-18 (Sprint **S1a Bloque A complete; Bloque B deferred to S2 con sub-spec tripstate-alignment como pre-requisito** — firma PO Opción A + 3 condiciones, ver [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11)
**Documento vivo**: este archivo refleja el estado en `main` al momento de la última actualización. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) (S0 cerrado, S1a Bloque A cerrado, pickup S1b) + [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md) (plan histórico waves 1-6)

---

## Sprint S1a drift schema/domain — CERRADO (2026-05-18, firma PO Opción A)

Sub-sprint: [`.specs/s1-drift-coverage-e2e/plan-s1a.md`](../../.specs/s1-drift-coverage-e2e/plan-s1a.md). Cierre formal en [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) — **gate APPROVED_BY_PO 2026-05-18, Opción A con 3 condiciones vinculantes** (ver §11).

**S1a Bloque A complete; Bloque B deferred to S2 con sub-spec tripstate-alignment como pre-requisito.**

### Cierre por tarea (Bloque A)

| Task | PR | LOC (+/-) | Estado |
|---|---|---|---|
| T1.1 — Inventario drift schema/domain + pre-commit hook | [#293](https://github.com/boosterchile/booster-ai/pull/293) | +736/-2 | ✅ Merged |
| T1.2 — Caso 5 `tripEventTypeSchema` (alinea 2 valores SQL) | [#294](https://github.com/boosterchile/booster-ai/pull/294) | +242/-15 | ✅ Merged |
| T1.3-discovery — Discovery broader pre-reclasificación | [#295](https://github.com/boosterchile/booster-ai/pull/295) | +205/-0 | ✅ Merged |
| T1.3 — Caso 1 `cargoRequestStatusSchema` → Clase I + annotación | [#296](https://github.com/boosterchile/booster-ai/pull/296) | +86/-32 | ✅ Merged |
| T1.5 — Integration tests Pattern A + B + H-S1a-1 partial cov | [#297](https://github.com/boosterchile/booster-ai/pull/297) | +168/-1 | ✅ Merged |
| Spec/plan v2 + reviews (pre-S1a) | [#292](https://github.com/boosterchile/booster-ai/pull/292) | +968/-0 | ✅ Merged |

**Baseline drift final**: 1 A (resuelta) + 1 I (annotada) + 1 B+ (diferida) + 0 C + 6 H = **0 drift estructural accionable**.

### Bloque B — diferido a S2 (firma PO Opción A + 3 condiciones, [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11)

T1.6 (XState scaffold) + T1.7a/b/c/d (wiring 3 services + followup doc) **no ejecutadas**. Ejecutan en S2 (lane paralela a S1b).

**Condición 1**: sub-spec `.specs/tripstate-alignment/spec.md` con acceptance material (§boundary-translation con 17 TS / 5 machine / 9 SQL mapping + §scope cut + §SCs measurable + §risks ≥3 reales + gate explícito). El trigger de avance es **completitud de las 5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec**, no calendario. Sin eso, S2 sigue bloqueado y el spec quedó como artefacto administrativo.

**Condición 2**: spike `spike/tripstate-machine-exploration` permitido como exploración, NO mergeable. Sirve solo como insumo del sub-spec. Ejecutar T1.6/T1.7 disfrazado de spike sería laundering C disfrazado de A.

**Condición 3**: tras merge de PR #298, S1a está cerrado. `tripstate` work posterior vive en sub-spec / plan-s2 / spike — no en "todavía estamos cerrando S1a".

Razones del PO para descartar B (mezcla concerns S1b worse off) y C (sprint discipline + sub-spec necesaria independiente del timing + estimado optimista) en §11.

### Taxonomía drift extendida (deliverable durable)

ADR-043 define A/B/C; el triage T1.1 + discovery T1.3 amplió a:
- **Clase H** — Falso positivo heurístico (script reporta divergencia pero SQL existe con naming distinto).
- **Clase I** — Intentional pre-materialization (TS schema deliberadamente antes que SQL counterpart, con dependencias estructurales documentadas en ADRs vivos).

Ambas son **categorías operacionales del proyecto Booster AI**, no modificaciones al ADR-043. Tracking en [`inventory-classification.md`](../../.specs/s1-drift-coverage-e2e/inventory-classification.md) §Nomenclatura.

### Follow-ups no bloqueantes (heredados)

| Follow-up | Sprint objetivo | Tracking |
|---|---|---|
| T1.0.heuristic-improvement (mejorar `normalizeForMatch`) | S2 | `plan-s1a.md` §T1.0 |
| T1.x.parser (`@drift-status` parsing en drift-inventory script) | S2 (post-T1.0) | `plan-s1a.md` §T1.x.parser |
| Sub-spec `.specs/tripstate-alignment/` (caso 8) | S2 — pre-requisito de Bloque B (avance gated por readiness, no calendario) | `inventory-classification.md` Caso 8 + `s1a-cierre.md` §6 |
| H-S1a-1 segunda mitad (`.parse()` en boundaries HTTP/DB/queue) | S2 o S3 | `spec.md` §12.5 |
| Bloque B (XState scaffold + wiring) | S2 (lane paralela a S1b) — recomendación Opción A `s1a-cierre.md` §9, pendiente firma PO | `s1a-cierre.md` §6 |

---

---

## Sprint S0 production-readiness — CERRADO (2026-05-18)

Sprint maestro: [`.specs/s0-housekeeping/spec.md`](../../.specs/s0-housekeeping/spec.md) + [`.specs/s0-housekeeping/plan.md`](../../.specs/s0-housekeeping/plan.md) (Approved 2026-05-17).

### Cierre por tarea

| # | Tarea | PR | Cubre SC-S0 | Estado |
|---|---|---|---|---|
| T1 | ADR-043 metodología drift schema/domain | [#278](https://github.com/boosterchile/booster-ai/pull/278) | .1 | ✅ Merged |
| T2 | Archivar `AUDIT.md`/`PLAN-PHASE-0.md`/`DESIGN.md` a `docs/archive/` | [#280](https://github.com/boosterchile/booster-ai/pull/280) | .2 | ✅ Merged |
| T3 | `scripts/repo-checks/check-adr-numbering` + workspace + pre-commit hook | [#281](https://github.com/boosterchile/booster-ai/pull/281) | .3 | ✅ Merged |
| T4 | ADR-046 colisiones históricas (028,034,035) TTL perpetuo | [#282](https://github.com/boosterchile/booster-ai/pull/282) | .4 | ✅ Merged |
| T5 | Eliminar `.gitlab-ci.yml` — GitHub canonical | [#283](https://github.com/boosterchile/booster-ai/pull/283) | .5 | ✅ Merged |
| T6 | RFP auditor GLEC v3.0 + `docs/compliance/` scaffold | [#284](https://github.com/boosterchile/booster-ai/pull/284) | .6 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T7 | RFP vendor pentest pre-launch + shortlist por categoría | [#285](https://github.com/boosterchile/booster-ai/pull/285) | .7 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T8 | ADR-047 load testing tool (k6) + smoke scaffold | [#286](https://github.com/boosterchile/booster-ai/pull/286) | .8 | ✅ Merged |
| T9a | ADR-048 microservices extraction strategy (conceptual) | [#287](https://github.com/boosterchile/booster-ai/pull/287) | .9a | ✅ Merged |
| T10 | Outreach cliente piloto + `.private/` gitignored | [#288](https://github.com/boosterchile/booster-ai/pull/288) | .10 (doc) | ✅ Merged · ⚠️ dry-run + envíos PO pendientes |
| T11 | Wrap CURRENT.md (este PR) | _pending_ | .11 | ⏩ In progress |

11/11 tareas materializadas. **3 SCs cierran a nivel doc + acción PO** (.6 GLEC, .7 pentest, .10 piloto) — los envíos reales corren en lanes externas paralelas, no bloquean el cierre del sprint.

### ADRs nuevos producidos (4)

| ADR | Título | Decisión clave | Consecuencia sobre roadmap |
|---|---|---|---|
| [043](../adr/043-drift-schema-domain.md) | Drift schema ↔ domain — metodología | SQL canónico (español); domain alinea. Clasificación A/B/C por migración. | S1 ejecuta el inventario detallado + migration; tests integration sobre infra T1+T2. |
| [046](../adr/046-historical-adr-numbering-collisions.md) | Historical ADR numbering collisions (028/034/035) | **TTL perpetuo** — las 3 colisiones legacy no se renumeran. Flag `--allow-legacy` permanente en pre-commit. | Disciplina "un número por archivo" desde ADR-040 enforced. Modificaciones a allowlist requieren supersede ADR. |
| [047](../adr/047-load-testing-tool-k6.md) | Load testing tool: k6 | k6 + scripts JS + OTEL nativa. **Reversible hasta S8**. | S8 ejecuta suite real (50 RPS sostenido api, 200 RPS pico, 1000+ TCP gateway). Smoke actual es throwaway. |
| [048](../adr/048-microservices-extraction-strategy.md) | Microservices extraction strategy | Strangler con mirroring **staging** + cutover prod con flag por endpoint + monolito fallback 2 sem. Split T9b/T9c diferido. | S3/S4 ejecutan extracción; cada microservicio produce sub-ADR. T9b (budget USD/sem) en S2; T9c (criterios drill) en spec S3. |

### Sub-spec dependiente

- [`.specs/stubs-decision/spec.md`](../../.specs/stubs-decision/spec.md) — **Approved 2026-05-17**. 8 decisiones binarias: eliminar `ai-provider` + `document-indexer`; promover `trip-state-machine` (S1) + `ui-components` parcial (S2) + 3 apps (S3/S4) + `carta-porte-generator` (S4).

### Velocity check (SC-S0.28 spec maestra)

- Estimación: 8–10 días lane Felipe (post devils-advocate v2).
- Real: 11 PRs producidos en **~5 horas de sesión** (densidad alta porque la mayoría son doc-only o scaffolds; el único código real fue T3 ~110 LOC).
- **Conclusión**: velocity observada >> 0.7× nominal en este sprint. Sin replan formal de S1-S13. Re-evaluar al cierre de S1 (tarea pendiente: `docs/handoff/<fecha>-velocity-check-post-S2.md`).

### Lanes externas activadas

| Lane | Activada por | Fecha esperada respuesta | Owner |
|---|---|---|---|
| **GLEC audit** (cubre SC-23 post-Impl) | T6 — RFP a SGS Chile / Bureau Veritas Chile / DNV LATAM | Respuestas vendors: ≤2 sem; contrato firmado: ≤4 sem; certificado: ≤8 sem post-firma | **PO acción**: enviar emails con template `docs/compliance/glec-rfp.md` §7.2 |
| **Pentest pre-launch** (cubre SC-24) | T7 — RFP a 3 categorías de vendor (Global EMEA / Boutique LATAM / Pentest-as-a-Service) | Respuestas: ≤2 sem; contrato: ≤4 sem; audit final: ≤6 sem post-firma | **PO acción**: enviar emails con template `docs/audits/security-rfp.md` §7.2 |
| **Cliente piloto** (cubre SC-27a) | T10 — shortlist 5+5 prospects en `.private/piloto-prospects.md` | Respuestas: variable (warm 1-2 sem, cold 2-4 sem); contrato firmado: en sprint S13 | **PO acción**: dry-run shortlist + envíos con template `.private/` §"Mensaje template" |

### Objections devils-advocate cerradas en S0

| Obj | Severidad | Status | Cubierta por |
|---|---|---|---|
| O-1 | P0 | ✅ Closed | Split T9a/T9b/T9c en ADR-048 |
| O-2 | P0 | ✅ Closed | SC-S0.1 acotado a metodología (sin enumeración) |
| O-3 | P0 | ✅ Closed | SC-S0.10 reforzado con criterios fit + dry-run PO + irreversibilidad |
| O-4 | P0 | ✅ Closed | OQ-S0.1 resuelta (privada) + OQ-S0.2 verificada por agente |
| O-5 | P0 | ✅ Closed | Estimación movida a 8-10 días; orden re-secuenciado |
| O-8 | P1 | ✅ Closed | ADR-046 TTL perpetuo explícito |
| O-9 | P1 | ✅ Closed | ADR-047 reversibilidad hasta S8 explícita |

### Open questions remaining (post-S0)

- **OQ-S0.3** — Reapuntar remote `origin` (sigue GitLab) a GitHub o eliminar. NO bloquea S1; decisión PO antes de S2.
- **SC-S0.9b** (en S2) — Medir tráfico actual de `notify-*.ts`, `matching*.ts`, `documentos.ts` para producir tabla USD/sem budget mirroring.
- **SC-S0.9c** (en spec S3) — Criterios concretos de rollback drill para primer microservicio (`notification-service`).

---

## Pickup point S1b (branches coverage + Playwright + sharding)

**Plan**: [`.specs/s1-drift-coverage-e2e/plan-s1b.md`](../../.specs/s1-drift-coverage-e2e/plan-s1b.md) (Approved 2026-05-18) — arranque **condicional** a firma PO sobre `s1a-cierre.md` §9.

**Scope S1b**:

- **T1.8** — Identificar branches uncovered + lista nombrada (≥10 error paths reales).
- **T1.9a..T1.9j** — Tests añadidos por path; meta: `apps/api` branches coverage ≥80% (actual: 75.01%).
- **T1.10** — 4 specs Playwright críticos en CI por PR (shipper-publica-carga, carrier-acepta-oferta, login-universal-rut-clave-numerica, public-tracking-via-link) + axe-core (0 violations P0/P1) + sharding + path-based filter en `ci.yml` (cubre SC-29 ≤10 min p95 CI).

**Cubre SCs maestros**: SC-2 (parcial), SC-4, SC-15 (parcial 4/8), SC-16 (parcial), SC-29.

**Bloque B Sprint S1** (XState `trip-state-machine` + wiring): **diferido** a sub-spec `.specs/tripstate-alignment/` cuando arranque T1.x dedicado (ver `s1a-cierre.md` §6 — pendiente firma PO).

**Acción inmediata PO** (S1a firma ya aplicada; S1b listo para arrancar):

1. **Enviar RFP GLEC** (template en `docs/compliance/glec-rfp.md` §7.2). Razón: lead time auditor 4-8 sem.
2. **Enviar RFP pentest** (template en `docs/audits/security-rfp.md` §7.2). Razón: lead time vendor 4-6 sem.
3. **Dry-run + envíos cliente piloto** (`.private/piloto-prospects.md`). Razón: lead time outreach piloto el más largo.
4. **Decidir OQ-S0.3** (qué hacer con remote `origin` GitLab).

**Próxima sesión de agente** (post-merge #298): `/spec tripstate-alignment` siguiendo Condición 1 de [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11. Avance gated por readiness (5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec), no calendario.

---

## Bloqueo D11 v2 T8-T12 (2026-05-17)

**Estado al cierre de sesión 2026-05-17 ~09:10 UTC**:

- D11 v2 T8 implementado en `fix/d11-t8-stakeholder-zonas-endpoint` con test unit-mocked → **NO mergeable** por violación de CLAUDE.md §1/§2 (test no ejerce el SQL real).
- Pivote a spec + plan separados para crear infra de integration testing en `apps/api`.

**Avance de la sesión** (PR [#267](https://github.com/boosterchile/booster-ai/pull/267), 4 commits docs-only):

| Artefacto | Status | Path |
|---|---|---|
| Spec test-integration-infra-apps-api | **Approved** (PO 2026-05-17 ~08:35 UTC) | [`docs/specs/2026-05-17-test-integration-infra-apps-api.md`](../specs/2026-05-17-test-integration-infra-apps-api.md) |
| Spec devils-advocate review | complete (6 P0 + 11 P1 + 7 P2) | [`docs/specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan v2 con 9 tasks (T0..T6) | **Approved** (PO 2026-05-17 ~09:05 UTC) | [`docs/plans/2026-05-17-test-integration-infra-apps-api.md`](../plans/2026-05-17-test-integration-infra-apps-api.md) |
| Plan devils-advocate review | complete (7 P0 + 6 P1 + 5 P2 — 12/13 P0+P1 abordados) | [`docs/plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan D11 v2 (T8-T12 BLOCKED) | actualizado | [`docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md`](../plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md) |

**T0 — PASS (2026-05-17 ~09:10 UTC)**:

Mediciones contra Postgres@16 local (brew, `booster_test_prototype`):

- Run 1 cold (DROP+CREATE+migrate): **472 ms** (<30 s objetivo)
- Run 2 full reset: 115 ms
- Run 3 in-place sin DROP: **4 ms** (<5 s objetivo)
- Sin errores; 36/36/36 migrations consistentes

Evidencia completa: [`2026-05-17-t0-prototype-test-db-output.md`](2026-05-17-t0-prototype-test-db-output.md). El script `apps/api/scripts/prototype-test-db.ts` queda untracked (no se mergea por diseño T0).

**Hallazgo colateral**: `0009_stakeholder_access_log.sql` existe en disco pero NO está en `meta/_journal.json` (37 .sql vs 36 entradas journal). La tabla `stakeholderAccessLog` está declarada en `schema.ts:1406`. En prod la tabla probablemente NO existe. Task separada flagueada (no bloquea T1). Justifica retroactivamente la decisión PO de exigir T0 antes de T1.

**Pickup point próxima sesión — T1**:

Próxima sesión arranca con T1 del plan v2: `vitest.integration.config.ts` + scripts + setup.integration + helper test-db + test ref `SELECT 1`. Acceptance enumerada en plan §T1 (LOC ~95). Sin bloqueos de T0.

**Cómo arrancar próxima sesión**:

```bash
cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/naughty-sinoussi-c8ddf8
git pull github fix/d11-t8-stakeholder-zonas-endpoint
# Verificar Postgres local sigue corriendo: pg_isready -h localhost
# Si no: brew services start postgresql@16
# Leer plan v2: docs/plans/2026-05-17-test-integration-infra-apps-api.md
# Arrancar T1: vitest.integration.config.ts + setup.integration.ts + helpers/test-db.ts + health-db.integration.test.ts
```

**Trabajo preservado en working tree** (no commit, untracked):
- `apps/api/src/routes/stakeholder.ts` (115 LOC) — reusable post-infra.
- `apps/api/test/unit/stakeholder-zonas-route.test.ts` (94 LOC) — descartable.
- `apps/api/src/server.ts` (+7 LOC) — wire de la route.

---

## (a) Waves 1-6 — estado de merge

Las seis waves del plan de identidad universal + dashboard conductor están **completas y mergeadas en `main`**.

| Wave | Alcance | PRs mergeados | Fecha cierre |
|---|---|---|---|
| **Wave 1** | Conductor identity + split dashboard (`/app/conductor` vs `/app/conductor/configuracion`) + migration 0029 + sweep español neutro | [#179](https://github.com/boosterchile/booster-ai/pull/179), [#189](https://github.com/boosterchile/booster-ai/pull/189) (smoke script) | 2026-05-13 |
| **Wave 2** | Tests + sweep i18n argentinismos → neutro | Integrado en [#179](https://github.com/boosterchile/booster-ai/pull/179) (+24 specs) | 2026-05-13 |
| **Wave 3** | Stakeholder organizations + ADR-034 (entidad XOR con empresas, migrations 0030/0031) + zonas filtradas por región + UI miembros | [#180](https://github.com/boosterchile/booster-ai/pull/180) → [#198](https://github.com/boosterchile/booster-ai/pull/198) (reabierto), [#199](https://github.com/boosterchile/booster-ai/pull/199) (zonas), [#203](https://github.com/boosterchile/booster-ai/pull/203) (UI miembros) | 2026-05-13 |
| **Wave 4** | Auth universal RUT + clave numérica + ADR-035 (foundation → UI selector → rotación clave → activación flag) | [#181](https://github.com/boosterchile/booster-ai/pull/181) (foundation 1/3), [#185](https://github.com/boosterchile/booster-ai/pull/185) (UI 2/3), [#187](https://github.com/boosterchile/booster-ai/pull/187) (rotación 3/3), [#190](https://github.com/boosterchile/booster-ai/pull/190) (`AUTH_UNIVERSAL_V1_ACTIVATED=true` en prod) | 2026-05-13 |
| **Wave 5** | Wake-word "Oye Booster" foundation + ADR-036 — service stub, flag `WAKE_WORD_VOICE_ACTIVATED=false` | [#183](https://github.com/boosterchile/booster-ai/pull/183) (foundation 1/2). **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186)) cerrado sin merge** — wire real bloqueado por Picovoice (ver §c). | 2026-05-13 (foundation) |
| **Wave 6** | Research cultura conductor chileno + guion entrevistas (input para refinamientos UI y Wave 5) | [#182](https://github.com/boosterchile/booster-ai/pull/182) | 2026-05-13 |

**Soporte transversal mergeado el mismo día**:
- [#184](https://github.com/boosterchile/booster-ai/pull/184) — bump `@opentelemetry/*` a 0.218 (cierra 4 HIGH vulns, desbloquea `npm audit` en CI).
- [#191](https://github.com/boosterchile/booster-ai/pull/191) — GCP cost efficiency TRL 10 (right-sizing + log exclusion, ADR-034/035).
- [#192](https://github.com/boosterchile/booster-ai/pull/192) — handoff con orden de merge consolidado.

**Verificación**: `gh pr list --state merged --search "wave" --limit 50` (ejecutado 2026-05-16).

### Mergeados 2026-05-16 (post-handoff inicial)

- [#166](https://github.com/boosterchile/booster-ai/pull/166) (commit `b5d1f18`, 22:26 UTC) — `docs(telemetry): Wave 3 v2 — preload CA root + ADR-040`. Rebased sobre main, ADR renumerado de 033→040 por colisión con `033-matching-algorithm-v2`. `npm audit (HIGH+)` resuelto vía bump OpenTelemetry de #184. Files: `docs/adr/040-wave-3-tls-ca-preload-fmc150.md` (+90), `docs/handoff/2026-05-11-wave-3-incidente-rollback.md` (+180), `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md` (±37/2), `docs/runbooks/wave-2-3-deploy.md` (±24/2).
- [#226](https://github.com/boosterchile/booster-ai/pull/226) (commit `641288d`, 22:26 UTC) — `docs(handoff): snapshot CURRENT.md estado proyecto 2026-05-16` (primera versión de este documento, +130 líneas).
- [#227](https://github.com/boosterchile/booster-ai/pull/227) (commit `d5e2e06`, 22:34 UTC) — `docs(handoff): actualizar CURRENT.md post-merge #166 + #226`. Reduce el documento a 1 PR abierto (#164), agrega la sección "Mergeados 2026-05-16" y "Housekeeping ADRs", clarifica que #164 no contiene archivo ADR todavía (solo spec) y recomienda ADR-041.
- [#228](https://github.com/boosterchile/booster-ai/pull/228) (commit `fa03246`, 22:53 UTC) — `docs(runbooks): plantillas /goal v2 con lessons de la sesion 2026-05-16`. Añade `docs/runbooks/goal-templates.md` (+255 líneas) con los aprendizajes operativos del flujo `/goal` aplicado a esta sesión.
- [#229](https://github.com/boosterchile/booster-ai/pull/229) (commit `c8ce2a3`, 23:05 UTC) — `docs(handoff): refresh CURRENT.md post-merge #227 + #228`. Segunda iteración del documento aplicando Plan 1 v2 vía `/goal` (9 min, 12.6k tokens, 0 errores fácticos — validó las plantillas v2 en producción).
- [#164](https://github.com/boosterchile/booster-ai/pull/164) (commit `2429f86`, 23:14 UTC) — `docs(spec): D11 stakeholder geo aggregations — cards + drill-down + ADR-033`. Spec D11 formalizada en `main` tras 5 días en DRAFT. Habilita `/plan` y `/build` cuando el PO decida. Files: `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (+136 líneas).

### Mergeados 2026-05-16/17 (post-coverage batch)

Sesión nocturna dedicada a cobertura de tests por package + housekeeping.

| PR | SHA | UTC | Título | Files |
|---|---|---|---|---|
| [#230](https://github.com/boosterchile/booster-ai/pull/230) | `786a5b3` | 23:17 | `docs(handoff): cierre sesion 2026-05-16 — 0 PRs abiertos` | `docs/handoff/CURRENT.md` (+12/−34) |
| [#231](https://github.com/boosterchile/booster-ai/pull/231) | `94155fe` | 23:22 | `refactor(d11-spec): renumerar ADR-033→041 y migration 0027→0034` | `docs/specs/…-d11.md` (±8/8), `docs/handoff/CURRENT.md` (±3/6) |
| [#232](https://github.com/boosterchile/booster-ai/pull/232) | `48c3d04` | 23:52 | `chore(coverage): infra de coverage en 15 packages + floor baseline` | 15 × `vitest.config.ts` + 15 × `package.json` + `pnpm-lock.yaml` |
| [#233](https://github.com/boosterchile/booster-ai/pull/233) | `fa301d3` | 23:58 | `test(ui-tokens): cobertura 100/100/100/100` | `tokens.test.ts` (+207), `vitest.config.ts` (±5/9) |
| [#234](https://github.com/boosterchile/booster-ai/pull/234) | `96e10c5` | 00:07 | `test(logger): cobertura 93/92/100/93 — createLogger + redaction` | `createLogger.test.ts` (+129), `redaction.test.ts` (+52) |
| [#235](https://github.com/boosterchile/booster-ai/pull/235) | `4a758e6` | 00:13 | `test(config): cobertura 100/100/100/100 — parseEnv + 5 schemas` | `parseEnv.test.ts` + 5 × `schemas/*.test.ts` (+243 total) |
| [#236](https://github.com/boosterchile/booster-ai/pull/236) | `09dc62f` | 00:19 | `test(whatsapp-client): cobertura 95/91/86/97 — WhatsAppClient HTTP` | `client.test.ts` (+156) |
| [#237](https://github.com/boosterchile/booster-ai/pull/237) | `5bd0228` | 00:39 | `test(certificate-generator): cobertura 97.82/80.15/100/97.82` | 5 × test (`ca-self-signed`, `emitir-certificado`, `firmar-kms`, `firmar-pades`, `storage`) + ajuste `generar-pdf-base.test.ts` (+734) |
| [#238](https://github.com/boosterchile/booster-ai/pull/238) | `ba0ee10` | 00:50 | `test(shared-schemas): cobertura 98.53/87.5/94.11/98.52` | `all-schemas.test.ts` (+428) |
| [#239](https://github.com/boosterchile/booster-ai/pull/239) | `756e9b4` | 01:06 | `fix(certificate-generator): CO2e ASCII en section title (subscript crash)` | `generar-pdf-base.ts` (±7/2), `generar-pdf-base.test.ts` (+34) — fix de bug descubierto en #237 + regression test (cert-gen subió a 99.63/82.53/100/99.63) |
| [#240](https://github.com/boosterchile/booster-ai/pull/240) | `a1419a2` | 01:18 | `docs(runbooks): sanity check zero anti-Stop-hook-loop` | `goal-templates.md` (±16/2) |
| [#241](https://github.com/boosterchile/booster-ai/pull/241) | `def7e64` | 01:46 | `docs(handoff): refresh CURRENT.md post-coverage batch` | `docs/handoff/CURRENT.md` (+23/−2) |
| [#242](https://github.com/boosterchile/booster-ai/pull/242) | `21a3d37` | 02:15 | `docs(runbooks): terse post-abort en sanity check zero` | `goal-templates.md` (±3/1) |
| [#243](https://github.com/boosterchile/booster-ai/pull/243) | `69534d3` | 02:21 | `docs(runbooks): embeber terse-post-abort en /goal text de Plans 3-5` | `goal-templates.md` (+10/0) |

**Resultado coverage**: los 15 packages no-stub pasan **≥80/80/80/80** (statements/branches/functions/lines). Lowest: certificate-generator branches=80.15%. Stubs (`ai-provider`, `carta-porte-generator`, `document-indexer`, `trip-state-machine`, `ui-components`) siguen exemptados hasta tener lógica real (PO-aprobado).

---

## (b) PRs abiertos — 9 (D11 BUILD review formal)

D11 BUILD ejecutado autónomamente vía `/goal` el 2026-05-17 (12 tasks DONE, ~$5-10 USD). Review formal con sub-agentes (`code-reviewer`, `devils-advocate`, `security-auditor`, `ux-designer`) reveló **bugs CRITICAL de privacy + violación de contrato agent-rigor + LOC waivers excedidos 2-3×**. Plan v1 BLOCKED, pivote a Opción 2 (`originComunaCode` mapping).

| PR | Task | Status |
|---|---|---|
| [#246](https://github.com/boosterchile/booster-ai/pull/246) | T1 ADR-041 | SUPERSEDE — pendiente ADR-042 |
| [#247](https://github.com/boosterchile/booster-ai/pull/247) | T2 Zod+Drizzle | REQUEST_CHANGES — `numeric` ↔ `z.number()` mismatch |
| [#249](https://github.com/boosterchile/booster-ai/pull/249) | T4 k-anonymity | REQUEST_FIX privacy CRITICAL |
| [#250](https://github.com/boosterchile/booster-ai/pull/250) | T5 hora+pico | REQUEST_CHANGES naming + k-anon |
| [#251](https://github.com/boosterchile/booster-ai/pull/251) | T6 tipo+combustible | MERGE post-T5 fix |
| [#252](https://github.com/boosterchile/booster-ai/pull/252) | T7 puntoEnBoundingBox | REQUEST_CHANGES NaN |
| [#253](https://github.com/boosterchile/booster-ai/pull/253) | T8 abort doc | OPEN — reset a abort-doc-only (`7b2a18e`) |
| [#255](https://github.com/boosterchile/booster-ai/pull/255) | T10 UI drill-down | REQUEST_CHANGES blocked-by-T9-v2 |
| [#256](https://github.com/boosterchile/booster-ai/pull/256) | T11 UI cards | REQUEST_CHANGES + SPLIT blocked-by-T8-v2 |
| [#257](https://github.com/boosterchile/booster-ai/pull/257) | T12 perf | REVERT_DONE_MARK — test tautológico |

**Cerrados sin merge**: #254 (T9, REJECT — privacy bugs heredados).

**Mergeado**: #248 (T3 migration zonas_stakeholder + seed, commit `2843e69`).

**Hallazgos sistémicos**:
1. Helper k-anonymity (#249) tiene 1 CRITICAL (quasi-identifier strings leak) + 3 HIGH. Es el ÚNICO control técnico privacy → prioridad #1.
2. Schema drift `domain/` ↔ `db/`: `domain/trip.ts` tiene state values en inglés (`delivered`, etc.); `db/schema.ts` divergió a español (`entregado`). ADR-042 resolverá.
3. "DONE" sin evidencia: T8 marcado DONE auto-resolviendo abort, T12 marcado DONE con test placeholder tautológico.

**Trazabilidad**: [`docs/handoff/2026-05-17-d11-review-plan.md`](2026-05-17-d11-review-plan.md) + comments en GitHub por PR.

---

## Housekeeping ADRs

**D11 numeración ya alineada con `main`**: el spec en `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` referencia **ADR-041** y **migration 0034** (siguientes libres). El título del PR original #164 menciona "ADR-033" — quedó como artefacto histórico del merge commit, sin impacto en el contenido del spec.

`main` arrastra colisiones históricas de numeración ADR en 028 (`dual-source-data-model-teltonika-vs-maps` + `rbac-auth-firebase-multi-tenant-with-consent-grants`), 034 (`gcp-cost-efficiency-2026-05` + `stakeholder-organizations`) y 035 (`auth-universal-rut-clave-numerica` + `trl10-mantener-ha-recortar-ruido`). No se tocan retroactivamente (los hashes son referenciados externamente). A partir de **ADR-040** se aplica la disciplina de "un número por archivo".

---

## (c) Blockers vigentes

### Picovoice approval

- **Estado**: PENDIENTE. Consola Picovoice respondió *"Thank you for your interest. Our team will review it shortly."* — sin ETA comprometido por el vendor.
- **Cuenta**: creada por Felipe (`dev@boosterchile.com`).
- **Bloquea**:
  - Acceso al modelo custom `oye-booster-cl.ppn` (entrenamiento del wake-word).
  - Provisión de `PICOVOICE_ACCESS_KEY` (Secret Manager + variable Cloud Run).
  - Wire real en `apps/web/src/services/wake-word.ts` (reemplazar `StubWakeWordController` por `PorcupineWakeWordController`).
  - Activación del flag `WAKE_WORD_VOICE_ACTIVATED=true` en prod.
- **Estado UI**: foundation Wave 5 ([#183](https://github.com/boosterchile/booster-ai/pull/183)) mergeado con UI inerte (flag OFF por default). Cero impacto visible para usuarios.
- **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186))** cerrado sin merge — se rehará cuando la approval llegue y el modelo esté disponible.

### Samples de voz Van Oosterwyk

- **Estado**: PENDIENTE coordinación con cliente.
- **Requerimiento**: 3 conductores reales × ~5 min de audio limpio cada uno, idealmente distribución regional:
  - 1 norteño (Antofagasta / Iquique)
  - 1 centro (RM / V Región)
  - 1 sureño (Bío Bío hacia el sur)
- **Pipeline**: subida al training pipeline de Picovoice → ~24h training → output `oye-booster-cl.ppn` (~50 KB) → commit a `apps/web/public/wake-word/`.
- **Dependencia mutua con Picovoice approval**: el upload de samples requiere acceso al Console post-approval. Los dos bloqueantes están encadenados.
- **ETA conjunto realista**: ~1 semana desde el momento en que llegue approval + samples estén grabados.

---

## Apuntadores rápidos

- **Auth universal activo en prod** desde 2026-05-13 ([#190](https://github.com/boosterchile/booster-ai/pull/190)): `app.boosterchile.com` muestra selector RUT + clave numérica. Usuarios legacy (Google / email+password) ven `<RotarClaveModal/>` bloqueante en próximo login.
- **Demo Corfo** agendada para lunes 2026-05-18 con Wave 1 + auth universal listos (hoy es 2026-05-16, faltan 2 días).
- **Subdominio `demo.boosterchile.com`** operativo desde 2026-05-13 ([#206](https://github.com/boosterchile/booster-ai/pull/206)) — 4 personas click-to-enter sin formulario.
- **Issue [#194](https://github.com/boosterchile/booster-ai/issues/194)** (DR deploy) resuelto por [#210](https://github.com/boosterchile/booster-ai/pull/210) (habilitación DNS endpoint cluster DR).
- **Coverage gate activo en CI desde 2026-05-16** ([#232](https://github.com/boosterchile/booster-ai/pull/232)): cada `packages/*` no-stub emite `coverage-summary.json` y vitest enforza thresholds 80/80/80/80 in-config. El bash gate del workflow CI valida los summaries y bloquea merge si alguno cae bajo umbral. Esto cierra el hueco de "CI silenciosamente pasa porque ningún package emite cobertura".
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
