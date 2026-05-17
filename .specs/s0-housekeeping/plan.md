# Plan: s0-housekeeping

- Spec: [`spec.md`](./spec.md)
- Created: 2026-05-17
- Status: **Approved** (PO 2026-05-17, v2 post devils-advocate P0)
- Estimated lane Felipe: **8–10 días** (~2 semanas calendario con realidad solo-dev) *(reestimado post-O-5 review.md)*

## Tasks

> Tareas verticales atómicas. Cada T: compila + testea + mergeable independiente. LOC estimado neto. Las que tocan código incluyen tests.

### T1: ADR-043 — drift schema/domain (metodología, sin enumeración) [DONE 2026-05-17]
- **Files**: `docs/adr/043-drift-schema-domain.md` (nuevo).
- **LOC estimate**: ~120 (markdown). *(Reducido post-O-2 review.md: sin enumeración detallada de divergencias.)*
- **Depends on**: ninguna.
- **Acceptance** (T-S0.1):
  - Archivo existe con `Status: Accepted`, `Date: 2026-05-17`, secciones Contexto/Decisión/Consecuencias/Alternatives/Validación.
  - Plan de migración describe **metodología**: cómo se identificarán divergencias en S1 (script grep automatizado vs lectura manual), dirección de alineación elegida (español SQL canónico → domain alinea a español, o se traduce en boundary explícito), criterios para decidir caso por caso.
  - **NO enumera divergencias específicas** — el inventario es deliverable de S1.
  - Test list para S1 enumerado (mínimo 3 tests integration, en términos de patterns no de tablas específicas).
- **Rollback**: revert PR. No afecta runtime.

### T2: archivar AUDIT.md, PLAN-PHASE-0.md, DESIGN.md raíz [DONE 2026-05-17]
- **Files**: `git mv` de los 3 + `docs/archive/2026-05-17-{audit,plan-phase-0,design}.md` con frontmatter `superseded_by:`. Posible `docs/archive/README.md` (~20 LOC) si la carpeta no existe aún.
- **LOC estimate**: ~60 (mv + 3 frontmatters + README opcional).
- **Depends on**: ninguna.
- **Acceptance** (T-S0.2):
  - `ls AUDIT.md PLAN-PHASE-0.md DESIGN.md` → no existe.
  - `ls docs/archive/2026-05-17-*.md` → 3 archivos.
  - Cada uno tiene primera línea con frontmatter YAML: `superseded_by: docs/handoff/CURRENT.md`, `archived_at: 2026-05-17`, `reason: "Reemplazado por production-readiness spec + handoff vivo"`.
- **Rollback**: revert PR; archivos vuelven al raíz.

### T3: scripts/check-adr-numbering.mjs + tests + pre-commit
- **Files**: `scripts/check-adr-numbering.mjs` + `scripts/check-adr-numbering.test.mjs` + edit `.husky/pre-commit` (+1 línea).
- **LOC estimate**: ~110 (80 script + 25 tests + 5 husky).
- **Depends on**: ninguna.
- **Acceptance** (T-S0.3):
  - Script ejecutado contra `docs/adr/` actual con flag `--allow-legacy 028,034,035` → exit 0.
  - Script sin flag contra estado actual → exit 1 (detecta 3 colisiones legacy).
  - Test añade ADR-100 duplicado en fixtures → exit 1.
  - Coverage del script ≥80/80/80/80 (verificable con `pnpm test --filter scripts`).
  - `.husky/pre-commit` invoca `node scripts/check-adr-numbering.mjs --allow-legacy 028,034,035` antes de salir.
- **Rollback**: `git revert`; pre-commit deja de invocar el script.

### T4: ADR-XXX — historical ADR numbering collisions
- **Files**: `docs/adr/<próximo-libre>-historical-adr-numbering-collisions.md`. Verificar próximo libre con `ls docs/adr/ | sort | tail -3` (post-ADR-045, hueco visible en 043 que va a T1; así que este toma 046).
- **LOC estimate**: ~80 (markdown).
- **Depends on**: T1 (ADR-043 ya creado, para no chocar numeración).
- **Acceptance** (T-S0.4):
  - Archivo existe con `Status: Accepted`.
  - Lista las 3 colisiones (028 dual-source-data-model + rbac-auth-firebase; 034 gcp-cost-efficiency + stakeholder-organizations; 035 auth-universal + trl10-mantener-ha-recortar-ruido) con SHA del commit de merge de cada uno.
  - Política: "Desde ADR-040 (incluido), aplica disciplina 'un número por archivo'. Numeración pre-040 queda con colisiones documentadas para no romper referencias externas."
- **Rollback**: revert PR.

### T5: eliminar .gitlab-ci.yml
- **Files**: `git rm .gitlab-ci.yml` + commit mensaje `chore(ci): remove gitlab mirror — GitHub canonical (memoria PO)`.
- **LOC estimate**: -78 (delta neto negativo).
- **Depends on**: OQ-S0.2 resuelta (ninguna branch GitLab activa requiere migración).
- **Acceptance** (T-S0.5):
  - `git log --diff-filter=D -- .gitlab-ci.yml` muestra commit.
  - CURRENT.md actualizado con línea "GitLab CI eliminado, repo canónico = GitHub (PR #YYY)".
- **Rollback**: revert PR (archivo vuelve).

### T6: RFP auditor GLEC v3.0
- **Files**: `docs/compliance/glec-rfp.md` + `docs/compliance/README.md` (si no existe, ~30 LOC).
- **LOC estimate**: ~130 (100 RFP + 30 README opcional).
- **Depends on**: ninguna.
- **Acceptance** (T-S0.6):
  - `docs/compliance/glec-rfp.md` con secciones: Scope, SLAs esperados (lead time entrega ≤8 sem, formato deliverable, precio rango), Methodology (referencia ADR-021, ADR-022 + `packages/carbon-calculator`), Sample data willingness, Timeline, Section "Sent to" con tabla (Auditor / Contact / Date sent / Status).
  - Tabla "Sent to" tiene ≥3 entradas con `Status: Sent` y fecha (Felipe envía emails como parte de esta task).
- **Rollback**: revert PR; emails ya enviados no se rollbackean (notificación de retiro si necesario).

### T7: RFP vendor pentest
- **Files**: `docs/audits/security-rfp.md` (`docs/audits/` ya existe).
- **LOC estimate**: ~110.
- **Depends on**: ninguna.
- **Acceptance** (T-S0.7):
  - Estructura paralela a T6: Scope (penetration test + OWASP Top 10 review sobre staging + auth flows + WhatsApp webhook + microservicios pre-extraction), SLAs (lead time ≤6 sem, reporte priorizado por severidad), Timeline (post-S10), Sent to ≥3 vendors.
- **Rollback**: revert PR.

### T8: ADR tool de load testing + setup k6 mínimo
- **Files**: `docs/adr/047-load-testing-tool-k6.md` (asumiendo 046 fue tomado por T4) + `apps/api/test/load/smoke.k6.js` + `apps/api/test/load/README.md` + edit `apps/api/package.json` (script `load-test:smoke`).
- **LOC estimate**: ~180 (120 ADR + 30 smoke + 20 README + 10 package.json).
- **Depends on**: T4 (para conocer numeración).
- **Acceptance** (T-S0.8):
  - ADR con `Status: Accepted`, alternatives consideradas (k6, Artillery, Locust), decisión k6 con razón (OTEL integration + JS scripts afines al stack + cloud + OSS).
  - `apps/api/test/load/smoke.k6.js` ejecutable: 1 request a `/health`, assert status 200.
  - `pnpm --filter @booster-ai/api load-test:smoke` corre y reporta.
  - Sin overrun de quota Cloud (corre 100% local o staging quota separada).
- **Rollback**: revert PR; script no se ejecuta en CI todavía (gating real es S8).

### T9a: ADR strangler vs cutover — decisión conceptual (sin números)
- **Files**: `docs/adr/048-microservices-extraction-strategy.md`.
- **LOC estimate**: ~130 (decisión + alternatives + criterios cualitativos). *(Reducido post-O-1 review.md: sin tabla budget cuantitativa ni criterios drill detallados.)*
- **Depends on**: T4 (numeración).
- **Acceptance** (T-S0.9a):
  - ADR con `Status: Accepted`, secciones Contexto (microservicios SC-9/10/11), Decisión (recomendación inicial: strangler con mirroring staging + cutover a prod con flag por endpoint, monolito retiene fallback 2 sem), Alternatives (cutover puro, strangler full incl. prod mirroring), Consecuencias cualitativas (no cuantitativas).
  - Declara explícitamente: "Tabla cuantitativa de budget USD/sem por microservicio y criterios detallados de drill se producen como sub-tareas SC-S0.9b (S2) y SC-S0.9c (S3 spec)."
- **Rollback**: revert PR; S3 queda sin guía y debe re-arrancarse desde decisión conceptual.

> **T9b (medición budget)** se difiere a **S2** — requiere métricas de tráfico reales que aún no se han instrumentado para esto específicamente. Cubre la parte cuantitativa de SC-30 del plan maestro.
> **T9c (criterios drill)** se incorpora a la **spec de S3** como parte del SC-30 del plan maestro.

### T10: outreach cliente piloto — identificar ≥5 prospects + dry-run PO + primer contacto
- **Files**:
  - `.private/piloto-prospects.md` (gitignored). **OQ-S0.1 resuelta: privada**.
  - `.gitignore` (edit: agregar `.private/` si no está).
  - `docs/handoff/2026-05-XX-piloto-outreach.md` (stub público con conteos agregados).
- **LOC estimate**: ~150 (.private detalle) + ~50 (stub público) + 1 línea `.gitignore`.
- **Depends on**: ninguna (OQ-S0.1 ya resuelta).
- **Sub-pasos** (reflejan SC-S0.10 v2):
  1. Identificar ≥5 prospects en `.private/piloto-prospects.md`. Cada entry con tabla obligatoria: empresa, contacto, sector (transporte / agroindustria / forestal / minería / otro), flota mínima estimada (≥X vehículos), caso de uso GLEC justificable, canal de intro (warm/cold).
  2. **Dry-run PO**: presentar la lista a Felipe para revisión + go/no-go por prospect. NO enviar emails hasta aprobación explícita.
  3. Post-aprobación: enviar emails personalizados; registrar fecha + canal + resultado en `.private/` (status: `sent`, `replied`, `no-reply`, `declined`).
  4. Actualizar stub público con conteos agregados.
- **Acceptance** (T-S0.10):
  - `.private/piloto-prospects.md` existe con ≥5 entries que cumplen tabla obligatoria.
  - Aprobación PO documentada en `.private/piloto-prospects.md` (línea "PO approved: <fecha>").
  - Stub público en `docs/handoff/` mergeado con conteos (sin nombres ni contactos).
  - `.private/` agregado a `.gitignore`.
- **Rollback / irreversibilidad**: outreach es **acción irreversible** (admitido en spec.md §11). Si un prospect inicia diálogo y luego no procedemos, cierre formal con email de "no fit en este momento". El git revert solo afecta el stub público, no las conversaciones ya iniciadas.

### T11: actualizar CURRENT.md al cierre del sprint
- **Files**: `docs/handoff/CURRENT.md` (edit).
- **LOC estimate**: ~30 (sección nueva "Sprint S0 cierre 2026-05-XX" + actualización del estado general).
- **Depends on**: T1..T10 completas (esta es la última).
- **Acceptance** (T-S0.11):
  - CURRENT.md tiene nueva sección con: artefactos producidos en S0 (linked), estado de lanes externas (RFPs enviados, prospects contactados), pickup point para S1 (drift schema/domain + branches coverage + 4 Playwright + sharding).
- **Rollback**: revert PR; CURRENT.md vuelve al estado pre-S11.

## Out-of-band tasks

Items que no son del critical path de S0 pero deben tracker:

- Verificar tras T5 si hay GitLab branches/issues abiertos que requieran migración a GitHub (OQ-S0.2). Si los hay, crear issue.
- Mantener mailbox limpio para respuestas a RFPs (T6/T7) — tracking centralizado en cada RFP doc.
- Actualizar `.gitignore` si T10 → privado (agregar `.private/`).

## Open questions

~~**OQ-S0.1**~~ → **Resuelta**: privada en `.private/piloto-prospects.md`. Reflejada en T10.

~~**OQ-S0.2**~~ → **Resuelta**: sin branches GitLab activas. T5 ejecutable.

**Open quedantes**:

- **OQ-S0.3** (post-T5) — Reapuntar remote `origin` a GitHub o eliminarlo. Decisión PO antes de S2. NO bloquea S0.

## Order of execution (Felipe lane) — 8-10 días

Dependencias mínimas; secuencia honesta con realidad solo-dev (1 ADR denso por día como máximo):

| Día | Tareas | Notas |
|---|---|---|
| 1 | T1 (ADR-043 metodología) | Empezar fresco; ADR + test list patterns. |
| 2 | T2 (archivar legacy) + T3 inicio (script + tests) | T2 rápido; T3 requiere foco tests. |
| 3 | T3 cierre (pre-commit) + T4 (ADR colisiones) | Verificar `--allow-legacy` dry-run sobre repo. |
| 4 | T6 (RFP GLEC) — solo redacción + revisión Felipe + shortlist | NO enviar emails este día (esperar T7 listo). |
| 5 | T7 (RFP pentest) — idem T6 + dry-run combinado de ambos emails antes de enviar | Envío de los 6 emails este día. |
| 6 | T9a (ADR strangler conceptual) | Denso pero acotado v2 (sin tabla cuantitativa). |
| 7 | T8 (ADR k6 + smoke script) + T5 (eliminar .gitlab-ci.yml) | k6 smoke testeado localmente. |
| 8 | T10 paso 1 (.private/ con ≥5 prospects + criterios fit) | Dry-run PO al cierre del día. |
| 9 | T10 paso 2 (envío emails post-aprobación PO) + T10 paso 3 (stub público) | Buffer para esperar aprobación PO. |
| 10 | T11 (CURRENT.md cierre) + buffer para fixes | Día de wrap-up + responder a respuestas RFP/outreach que ya hayan llegado. |

**Buffer 1-2 días** para imprevistos (respuestas a RFPs que requieren follow-up, fix de pre-commit hook, OQ-S0.3 si PO quiere resolverlo este sprint).

Total LOC neto estimado v2: ~1 200 LOC (T1 reducido + T9 reducido + T10 reorganizado, sin perder cobertura SC). Código real: ~110 LOC.

## Verification (skill 20 §Verification)

- [x] All tasks vertical slices (compile + test + mergeable independiente).
- [x] All tasks ≤ 100 LOC net change — **excepción justificada por categoría** (v2 post-O-6):
  - **Prose-only** (waiver válido — comprensión humana, no LOC): T2 (~60), T4 (~80), T6 (~130 RFP doc), T7 (~110 RFP doc), T11 (~30).
  - **Code-bound** (sin waiver): T3 (~110, dentro de tolerancia). T5 (negativo).
  - **Decisión arquitectónica acotada** (post-v2): T1 (~120, reducido de 180), T9a (~130, reducido de 220 por split T9b/T9c), T8 (~180 con setup mínimo — aceptable porque mayor parte es ADR prose).
  - **Operacional con sub-pasos** (estructura mitiga tamaño): T10 (~200 incluyendo `.private/` + stub + dry-run + envío, con 4 sub-pasos secuenciales explícitos).
- [x] Acceptance trazable a SC-S0.1..11 en spec.md §3 + §10.
- [x] Rollback plan por task. **Acciones irreversibles** (T6/T7/T10) marcadas explícitamente.
- [x] Devils-advocate output captured en [`review.md`](./review.md). 5 P0 + 5 P1 + 4 P2. P0 aplicadas v2.

## Decision log

- **2026-05-17** — Initial draft.
- **2026-05-17** — Devils-advocate: 5 P0 + 5 P1 + 4 P2 (review.md).
- **2026-05-17** — **Aplicado v2**: T1 acotado a metodología (O-2); T9 split en T9a (S0) + T9b (S2) + T9c (S3) (O-1); T10 reforzado con criterios fit + dry-run PO + irreversibilidad (O-3); OQ-S0.1/S0.2 resueltas (O-4); estimación 8-10 días con buffer (O-5); waiver discriminado por categoría (O-6).
- **2026-05-17** — **APPROVED por PO** junto con spec.md v2. T1 puede arrancar (con cooling-off recomendado por skill 20 §Solo-Developer Adaptation).
