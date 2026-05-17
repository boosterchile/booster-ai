# Plan v2: D11 — Stakeholder geo aggregations (filtro por comuna)

- **Spec**: [`docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md`](../specs/2026-05-11-stakeholder-geo-aggregations-d11.md) (en main desde `2429f86`)
- **ADRs**:
  - [ADR-041](../adr/041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md) — k-anonymity ≥5, ventana 30d, proceso "nueva zona" (vigente).
  - [ADR-042](../adr/042-stakeholder-geo-aggregations-comuna-filter-and-domain-alignment.md) — **filtro por comuna code + alineación schema/domain (supersedes ADR-041 §1)**.
- **Plan v1**: [`2026-05-17-d11-stakeholder-geo-aggregations.md`](2026-05-17-d11-stakeholder-geo-aggregations.md) — BLOCKED, ver §"Status post-review".
- **Owner**: Felipe Vicencio (PO) + Claude
- **Creado v2**: 2026-05-17 post review formal (12 PRs) + ADR-042 mergeado.
- **Status**: Active.

---

## Cambios estructurales respecto al plan v1

| Eje | Plan v1 (bbox) | Plan v2 (comuna) |
|---|---|---|
| Filtro de viajes | `puntoEnBoundingBox(viaje.geocode, zona.bbox)` | `viaje.originComunaCode = ANY(z.comuna_codes)` |
| Migration adicional | 0035 con `viajes.origen_lat/lng` nullable + backfill Geocoding API | 0036 con `zonas_stakeholder.comuna_codes text[]` (ya en main, [#261](https://github.com/boosterchile/booster-ai/pull/261)) |
| Costo externo | $50-200 USD Google Geocoding | $0 |
| T7 `puntoEnBoundingBox` | Necesario | **DEPRECATED** (closed [#252](https://github.com/boosterchile/booster-ai/pull/252)) |
| k-anonymity | per-bucket numeric | **3 niveles**: dataset + per-bucket-universo-cerrado + per-bucket-quasi-identifier (`dropSubKBuckets`) |
| Drift schema/domain | Ignorado | Resuelto en ADR-042 §4 (domain sigue al db, Spanish enum values) |

---

## Status de T1–T7 (helpers + infra ya en main)

| Task | PR original | PR replacement (v2 post-fix) | Commit en main | Status |
|---|---|---|---|---|
| T1 ADR-041 con Superseded | [#246](https://github.com/boosterchile/booster-ai/pull/246) closed | [#262](https://github.com/boosterchile/booster-ai/pull/262) | merged | ✅ |
| T2 Zod+Drizzle + comuna_codes + migration 0036 | [#247](https://github.com/boosterchile/booster-ai/pull/247) closed | [#261](https://github.com/boosterchile/booster-ai/pull/261) | `4aa4f6c` | ✅ |
| T3 Migration 0034 + seed | [#248](https://github.com/boosterchile/booster-ai/pull/248) | (mismo) | `2843e69` | ✅ |
| T4 k-anonymity helper (3 niveles privacy) | [#249](https://github.com/boosterchile/booster-ai/pull/249) closed | [#259](https://github.com/boosterchile/booster-ai/pull/259) | `3e1765e` | ✅ |
| T5 hora+pico (pickupWindowStart + k-anon ventana) | [#250](https://github.com/boosterchile/booster-ai/pull/250) closed | [#263](https://github.com/boosterchile/booster-ai/pull/263) | `b21dbec` | ✅ |
| T6 tipo+combustible (+ aplicarKAnonymityQuasiId) | [#251](https://github.com/boosterchile/booster-ai/pull/251) closed | (next merge — fix/d11-t6-tipo-combustible) | (pending) | ✅/⏳ |
| T7 puntoEnBoundingBox | [#252](https://github.com/boosterchile/booster-ai/pull/252) | DEPRECATED (cerrado) | — | ✅ (closed) |
| ADR-042 supersede parcial | [#260](https://github.com/boosterchile/booster-ai/pull/260) | (mismo) | `495d744` | ✅ |

---

## Tasks v2 — endpoints + UI + perf (T8–T12)

### T8 v2: Endpoint `GET /stakeholder/zonas` (cards 30d, comuna filter)

- **Files**:
  - `apps/api/src/routes/stakeholder.ts` (nuevo)
  - `apps/api/test/integration/stakeholder-zonas.test.ts` (nuevo)
  - `apps/api/src/server.ts` (register route)
- **LOC estimate**: ~150 *(waiver: endpoint + auth check + 4 queries + agregación + k-anon dataset gate + integration tests con 3 escenarios. Splitearlo crea PRs con menos coherencia funcional.)*
- **Depends on**: T2 (schema en main), T3 (table+seed en main), T4 (helper en main), T5+T6 (en main).
- **Acceptance** (spec criterio 3 + decisiones ADR-042):
  - Endpoint registrado, requiere rol `stakeholder_sostenibilidad` (403 con cada uno de 5 otros roles).
  - Por cada zona activa: card con `viajes_30d`, `co2e_total_kg`, `horario_pico_inicio`, `horario_pico_fin`, `comuna_codes` (informativo).
  - **Filtro**: `WHERE v.origen_codigo_comuna = ANY(z.comuna_codes) AND v.status='entregado' AND v.pickup_window_start >= now() - interval '30 days'`.
  - Si zona <5 viajes total: campos numéricos `null` + `insufficient_data: true` (k-anon dataset-level).
  - **Zona activa con 0 viajes**: incluida con `insufficient_data: true` (decisión PO).
  - Logging estructurado con `correlationId`, `stakeholderId`.
  - **Integration tests con 3 escenarios**:
    - Zona A: 6 viajes en `CL-VS-VAL` → `viajes_30d=6`, números visibles.
    - Zona B: 4 viajes en `CL-VS-SAN` → `insufficient_data: true`, `viajes_30d: null`.
    - Zona C: 0 viajes en `CL-RM-PED` → `insufficient_data: true`.
  - Integration tests con 6 roles (5 negados + 1 admitido).
- **Rollback**: revertir commit. UI v1 (mock data) sigue funcionando hasta T11 v2.

### T9 v2: Endpoint `GET /stakeholder/zonas/:slug/agregaciones`

- **Files**:
  - `apps/api/src/routes/stakeholder.ts` (extender T8)
  - `apps/api/test/integration/stakeholder-zonas.test.ts` (extender T8)
- **LOC estimate**: ~120 *(waiver: 3 breakdowns + metodologia + k-anon per-bucket aplicado correctamente para cada dimensión. Auth ya de T8.)*
- **Depends on**: T8.
- **Acceptance** (spec criterio 4 + ADR-042 §6):
  - Retorna `por_hora_del_dia` (24 entries con `aplicarKAnonymityHorario` — universo cerrado).
  - Retorna `por_tipo_carga` (con `aplicarKAnonymityQuasiId` — buckets sub-k filtrados).
  - Retorna `por_combustible` (con `aplicarKAnonymityQuasiId` — buckets sub-k filtrados).
  - Top-level `metodologia: { k_anonymity: 5, ventana_dias: 30, fuente: 'viajes_entregados', generado_at: ISO, adr: 'ADR-042' }`.
  - **Dataset-level guard**: si dataset <5 viajes total, retorna shell con `insufficient_data: true` SIN bucketizar (evita bucket-existence leak observado en review T9 v1).
  - Param `?window=30d` validado; otros valores → 400 (default a 30d si ausente).
  - Zona inexistente o `is_active=false` → 404.
  - Tests cubren k-anonymity en cada dimensión + zona insufficient + 6 roles.
- **Rollback**: revertir commit. T10 v2 UI maneja error genérico vía TanStack Query.

### T10 v2: UI drill-down route `/app/stakeholder/zonas/$slug`

- **Files**:
  - `apps/web/src/routes/stakeholder-zonas.$slug.tsx` (nuevo o re-implementar)
  - `apps/web/src/services/stakeholder-aggregations-client.ts` (nuevo o re-implementar)
  - `apps/web/src/routes/stakeholder-zonas.$slug.test.tsx` (nuevo — RENDER tests, no smoke)
- **LOC estimate**: ~130 *(waiver: route + hook + componente + render tests reales)*
- **Depends on**: T9.
- **Acceptance** (spec criterio 10 + review T10 v1):
  - Ruta TanStack Router registrada con typed `useParams`.
  - **Banner de metodología visible** con link a ADR-042 (jerarquía igual a la página padre — usar `<MetodologiaBanner>` componente reusable).
  - **`<h1>` muestra `nombre` de la zona** (no slug crudo). Si nombre no viene en response, fetch desde `useStakeholderZonas` con mismo cache key.
  - **24 barras horizontales** para `por_hora_del_dia` (Tailwind, sin chart library), ancho proporcional a `viajes / max`.
  - `por_tipo_carga` y `por_combustible`: barras horizontales similares con `nombre · número · co2e_kg`.
  - "Sin data suficiente" cuando `viajes === null` (k-anon). Contraste WCAG AA (`text-neutral-600` mínimo).
  - Estado vacío explícito si `por_*: []`.
  - `encodeURIComponent` en el slug del fetch.
  - Render tests con TanStack Query + RouterProvider mock: loading / data / insufficient / error.
- **Rollback**: revertir. T11 v2 enlace al drill-down se rompe (404).

### T11 v2: UI cards `stakeholder-zonas.tsx`

- **Files**:
  - `apps/web/src/routes/stakeholder-zonas.tsx` (refactor)
  - `apps/web/src/services/stakeholder-aggregations-client.ts` (extender T10 con `useStakeholderZonas`)
  - `apps/web/src/routes/stakeholder-zonas.test.tsx` (re-escribir con render real)
- **LOC estimate**: ~150 *(waiver: refactor + hook + 4 states + render tests)*
- **Depends on**: T8 (endpoint), T10 (ruta drill-down registrada).
- **Acceptance** (spec criterio 9 + review T11 v1):
  - `ZONAS_DEMO` eliminada (`rg ZONAS_DEMO apps/web | wc -l` → 0).
  - Hook `useStakeholderZonas()` con TanStack Query.
  - **4 estados visualmente distinguibles**:
    - Loading: skeleton de 6 cards (no `<p>Cargando…</p>` global → previene CLS).
    - Data: cards reales con números o "Sin data suficiente".
    - Error: mensaje neutro + **botón Reintentar** (refetch TanStack Query) + `role="alert"`.
    - Empty: estado con icono + copy.
  - **Banner ADR-042** reemplaza al banner amarillo "Datos de demostración": surface neutro (`bg-neutral-50` border), icono `Shield` (Heroicons/Lucide), link externo con `target="_blank" rel="noopener" aria-label`.
  - Botón "Drill-down" **disabled** si `insufficient_data: true` (con tooltip "Sin data suficiente para drill-down"). Habilitado cuando hay data.
  - Cards tienen `cursor-pointer` cuando navegables, hover transitions 150-300ms (`motion-safe:transition-colors`).
  - Render tests para los 4 estados + screenshot manual.
- **Rollback**: revertir. UI vuelve a estado pre-D11 mock (cosmetic, no crítico).

### T12 v2: Perf gate — `EXPLAIN ANALYZE` real + script `test:perf` separado

- **Files**:
  - `apps/api/test/perf/stakeholder-zonas-explain.test.ts` (re-implementar con DB real)
  - `apps/api/scripts/seed-perf-stakeholder.ts` (nuevo — seed de 10k viajes distribuidos en las 5 comunas)
  - `apps/api/package.json` (agregar `test:perf` script + `vitest.config.ts` exclude para default run)
- **LOC estimate**: ~100 *(waiver: seed script + test perf + package config)*
- **Depends on**: T8 (endpoint a medir).
- **Acceptance** (spec §riesgos + ADR-042):
  - Script seed inserta 10k viajes con `originComunaCode` distribuido en las 5 comunas seed (`CL-VS-VAL`, etc.) + `pickup_window_start` aleatorio en últimos 30d.
  - Test ejecuta `EXPLAIN (ANALYZE, FORMAT JSON)` del query principal del endpoint `/stakeholder/zonas`.
  - **Output capturado en chat + commit body**: `Total Cost`, `Actual Time`, `Index Scan` vs `Seq Scan` sobre `viajes.origen_codigo_comuna`.
  - **Assertion**: si plan muestra Seq Scan sobre `viajes`, crear migration `0037_viajes_origen_comuna_index.sql` con `CREATE INDEX CONCURRENTLY ... ON viajes (origen_codigo_comuna) WHERE status='entregado'`.
  - **Script `pnpm test:perf`** separado del default `pnpm test`. `vitest.config.ts` excluye `test/perf/` del run normal.
- **Rollback**: revertir commit. Si migration 0037 se creó, `DROP INDEX CONCURRENTLY`.

---

## Out-of-band tasks

- **`docs/handoff/CURRENT.md`** se actualiza tras cada merge (Plan 1 v2 del runbook `/goal`).
- **Smoke staging** post-T11: login con `stakeholder@boosterchile.com`, verificar cards + drill-down, screenshot.
- **Métrica observability**: contador `stakeholder_aggregations_request_total` (label `zonaSlug`) en Cloud Monitoring. No bloquea, post-T11.
- **Métrica `% viajes con origen_codigo_comuna válido`**: spec lo lista como mitigación. Out-of-band.

---

## Open questions

Ninguna. Decisiones cerradas en ADR-042 + PO confirmaciones en reviews:

1. ✅ Zona sin viajes incluida con `insufficient_data` (PO).
2. ✅ Viaje sin CO2e cuenta en `viajes` no en `co2e_kg` (PO review #251).
3. ✅ T10 antes que T11 (PO).
4. ✅ T12 perf gate explícito (PO).
5. ✅ Helper k-anon a 3 niveles (security audit #249 + ADR-042 §6).
6. ✅ Schema/domain alignment: domain sigue al db (Spanish enum) — ADR-042 §4.

---

## Verificación del plan (skill checklist)

- [x] Todas las tasks T8–T12 son vertical slices (compile + test + mergeable independientemente).
- [x] Acceptance traza a spec §3 + ADR-042 para cada task.
- [x] Rollback plan para cada task con caveats explícitos (T9 depende de T8, T10 depende de T9, T11 depende de T8+T10).
- [x] LOC waivers justificados (cohesión funcional, no scope creep).
- [x] T1–T7 marcadas DONE solo cuando el PR está mergeado en main (no auto-DONE mid-build).
- [ ] Aprobación PO explícita — pendiente.

---

## Solo-developer adaptation

Tras aprobación PO: cooling-off 30 min antes de `/build` (agent-rigor §6.1). Re-leer plan con ojos frescos.

## Estimación total

- 5 tasks (T8–T12) × ~130 LOC promedio = ~650 LOC netas.
- 5 PRs con waiver, cada uno con CI + review formal + cooling-off.
- Tiempo estimado: 4-6 horas de implementación + tiempo de review entre tasks.

## Lecciones del plan v1 aplicadas

- Schema verificado contra `db/schema.ts` real ANTES de definir acceptance (no asumir nombres del spec).
- k-anonymity siempre a 3 niveles (no solo per-bucket).
- LOC waivers documentados con razón cohesiva, no "el plan estaba mal granulado".
- Tests integration NO mocked-Drizzle — usar test DB real (per spec §10).
- UI tests son render reales (con RouterProvider + Query mock), NO type-only smoke.
- Endpoint NO hardcodea valores de enums (e.g. `'carga_seca'`, `'diesel'`) — viene siempre del cargo_request real.
