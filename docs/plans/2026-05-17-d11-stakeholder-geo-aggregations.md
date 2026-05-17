# Plan: D11 — Stakeholder geo aggregations (cards + drill-down)

- **Spec**: [`docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md`](../specs/2026-05-11-stakeholder-geo-aggregations-d11.md) (mergeado en `main` 2026-05-16, commit `2429f86`)
- **Owner**: Felipe Vicencio (PO) + Claude
- **Creado**: 2026-05-17
- **Revisado**: 2026-05-17 post devils-advocate (12 objeciones, 4 fuertes resueltas)
- **Status**: Active
- **ADR a producir en T1**: ADR-041 (`041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md`)
- **Migration a producir en T3**: `0034_zonas_stakeholder.sql`

**Convención de path**: este plan vive en `docs/plans/` (no `.specs/`) para consistencia con `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`. Desviación deliberada del framework agent-rigor.

---

## Módulos tocados (5 lógicos, 14 archivos)

| Módulo | Archivos | Rol |
|---|---|---|
| `apps/api/drizzle/` | `0034_zonas_stakeholder.sql`, `meta/_journal.json` | Migration + seed SQL |
| `apps/api/src/` | `db/schema.ts` (extender), `db/seed/zonas-stakeholder.ts`, `routes/stakeholder.ts`, `services/stakeholder-aggregations.ts` + 2 tests | Backend |
| `packages/shared-schemas/src/` | `domain/zona-stakeholder.ts`, `aggregations/k-anonymity.ts` + 2 tests, `index.ts` | Schema + helper puro |
| `apps/web/src/` | `routes/stakeholder-zonas.tsx`, `routes/stakeholder-zonas.$slug.tsx`, `services/stakeholder-aggregations-client.ts` + 2 tests | UI |
| `docs/adr/` | `041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md` | Decisión |

---

## Decisiones cerradas (post devils-advocate + PO)

1. **Zona activa sin viajes** → endpoint la incluye con `insufficient_data=true` y campos numéricos `null`. Stakeholder ve la zona configurada aunque no tenga datos suficientes.
2. **Helper `aplicarKAnonymity`** → vive en `packages/shared-schemas/src/aggregations/k-anonymity.ts` (cohesión schema-adyacente).
3. **`puntoEnBoundingBox`** → vive en `apps/api/services/stakeholder-aggregations.ts` (frontend no lo necesita).
4. **Orden UI** → drill-down ruta (T10) **antes** que UI cards (T11). T11 al mergear ya enlaza a ruta registrada sin botón disabled intermedio.
5. **Índice geocode** → task T12 explícito con `EXPLAIN ANALYZE` + 10k seed (no out-of-band).

---

## Tasks

### T1: ADR-041 — decisiones arquitectónicas [DONE 2026-05-17 — PR #246]

- **Files**: `docs/adr/041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md` (nuevo)
- **LOC estimate**: ~80
- **Depends on**: ninguna
- **Acceptance** (criterio 11):
  - Documenta: bounding boxes predefinidos (no polygon input), k-anonymity ≥ 5, ventana 30d fija.
  - Alternativas rechazadas: geohash, h3, polygon libre — con razones.
  - Trade-offs: precisión vs privacidad vs auditabilidad.
  - Proceso "nueva zona" via migration; roadmap futuro admin endpoint.
  - Referenced by: T2, T8, T9, T11.
- **Rollback**: revertir commit (puro doc, sin consumidores).

### T2: Zod schema canónico + Drizzle table [DONE 2026-05-17 — PR #247]

- **Files**: `packages/shared-schemas/src/domain/zona-stakeholder.ts` (nuevo), `packages/shared-schemas/src/domain/zona-stakeholder.test.ts` (nuevo), `apps/api/src/db/schema.ts` (extender con `zonasStakeholder` Drizzle table), `packages/shared-schemas/src/index.ts` (re-export)
- **LOC estimate**: ~80
- **Depends on**: T1
- **Acceptance** (criterio 2):
  - `zonaStakeholderSchema` Zod exportado con tipo `ZonaStakeholder`.
  - Drizzle table `zonasStakeholder` en `db/schema.ts` coincide 1:1 con Zod (snake_case SQL ↔ camelCase TS).
  - Unit tests Zod: válido / inválido / bounding box invertido.
- **Rollback**: revertir commit (sin migration aún, sin endpoint que consuma).
- **Nota objeción #2 resuelta**: T2 viene ANTES que T3 (la migration + seed importan esta table definition).

### T3: Migration 0034 + seed 5 zonas [DONE 2026-05-17 — PR #248]

- **Files**: `apps/api/drizzle/0034_zonas_stakeholder.sql` (nuevo), `apps/api/drizzle/meta/_journal.json` (update), `apps/api/src/db/seed/zonas-stakeholder.ts` (nuevo, importa de T2)
- **LOC estimate**: ~80
- **Depends on**: T2
- **Acceptance** (criterio 1):
  - Migration crea tabla `zonas_stakeholder` con columnas exactas del spec.
  - Seed inserta 5 zonas (Puerto Valparaíso, Puerto San Antonio, Mercado Lo Valledor, Polo Quilicura, Zona Franca Iquique) con bounding boxes validados contra OSM.
  - Cada bounding box documentado en comment del seed con link OSM.
  - `SELECT COUNT(*) FROM zonas_stakeholder WHERE is_active = true` retorna 5.
- **Rollback**: revertir commit + ejecutar `DROP TABLE zonas_stakeholder` si aplicada. **Caveat (objeción #11 resuelta)**: una vez T8/T9 estén en `main`, este rollback rompe los endpoints. Si T8 ya mergeó, revertir T3 requiere revertir también T8/T9 como unidad.

### T4: k-anonymity helper puro [DONE 2026-05-17 — PR #249]

- **Files**: `packages/shared-schemas/src/aggregations/k-anonymity.ts` (nuevo), `packages/shared-schemas/src/aggregations/k-anonymity.test.ts` (nuevo), `packages/shared-schemas/src/index.ts` (re-export)
- **LOC estimate**: ~90 (≈30 helper + ≈60 tests)
- **Depends on**: ninguna
- **Acceptance** (criterio 6):
  - Función `aplicarKAnonymity<T>(buckets: T[], k: number, countField: keyof T): T[]` reemplaza campos numéricos por `null` cuando count < k.
  - Tests exhaustivos: k=5, k=1, k=0, bucket vacío, bucket exactamente k, bucket k-1.
- **Rollback**: revertir commit. Caveat: si T8/T9 ya consumen, ese rollback rompe los endpoints — revertir T8/T9 también.
- **Nota objeción #3**: la firma `aplicarKAnonymity<T>(buckets, k, countField)` es decisión de API pública. Si tras T8 se descubre que la firma no escala, el cambio cascade a T8/T9. Mitigación: tests cubren los casos de uso reales antes de T8.

### T5: Aggregations helpers — hora del día + horario pico [DONE 2026-05-17 — PR #250]

- **Files**: `apps/api/src/services/stakeholder-aggregations.ts` (nuevo), `apps/api/test/unit/stakeholder-aggregations.test.ts` (nuevo)
- **LOC estimate**: ~100
- **Depends on**: T4
- **Acceptance** (criterio 4 parcial + criterio 8):
  - `agregarPorHoraDelDia(viajes): { hora, viajes, co2e_kg }[]` (24 entries).
  - `calcularHorarioPico(viajes): { inicio, fin } | null` (ventana 4h consecutivas, null si <5 viajes total).
  - Tests: cero viajes, exactamente k, k+1, distribución bimodal.
- **Rollback**: revertir commit (helpers no expuestos por endpoint todavía).

### T6: Aggregations helpers — tipo carga + combustible

- **Files**: `apps/api/src/services/stakeholder-aggregations.ts` (extender), `apps/api/test/unit/stakeholder-aggregations.test.ts` (extender)
- **LOC estimate**: ~80
- **Depends on**: T5
- **Acceptance** (criterio 4 parcial + criterio 7):
  - `agregarPorTipoCarga(viajes): { tipo: CargoType, viajes, co2e_kg }[]`.
  - `agregarPorCombustible(viajes): { fuel_type: FuelType, viajes, co2e_kg }[]`.
  - Tests: fallback CO₂e `actual` → `estimated` → skip + warning log.
- **Rollback**: revertir commit.

### T7: `puntoEnBoundingBox` helper

- **Files**: `apps/api/src/services/stakeholder-aggregations.ts` (extender), `apps/api/test/unit/stakeholder-aggregations.test.ts` (extender)
- **LOC estimate**: ~50
- **Depends on**: T2 (necesita `ZonaStakeholder` type)
- **Acceptance** (subset criterio 3):
  - `puntoEnBoundingBox(point: {lat, lng}, zona: ZonaStakeholder): boolean`.
  - Tests: dentro, fuera, en borde (lat=lat_min, lng=lng_max), bbox invertido (defensive).
- **Rollback**: revertir commit.

### T8: Endpoint `GET /stakeholder/zonas` (cards 30d)

- **Files**: `apps/api/src/routes/stakeholder.ts` (nuevo o extender), `apps/api/test/integration/stakeholder.test.ts` (nuevo, incluye fixtures inline)
- **LOC estimate**: ~120 *(waiver: endpoint integra auth + agregación + k-anonymity + logging + integration tests con fixtures de 3 escenarios. Splitearlo crea PRs con menos coherencia funcional. Test fixtures inline son ~30 LOC dentro del waiver, no task aparte.)*
- **Depends on**: T3, T4, T5, T6, T7
- **Acceptance** (criterios 3, 5, 13):
  - Endpoint registrado, requiere rol `stakeholder_sostenibilidad` (403 con otros 5 roles).
  - Por cada zona activa: card con `viajes_30d`, `co2e_total_kg`, `horario_pico_inicio/fin`.
  - Si zona <5 viajes: campos numéricos `null` + `insufficient_data: true`.
  - **Zona activa con 0 viajes en ventana**: incluida con `insufficient_data: true` (decisión PO).
  - Filtro: `viajes.state IN ('delivered', 'confirmed_by_shipper', 'completed_rated')` con `pickup_at >= now() - interval '30 days'` y `cargo_request.origin.geocode` dentro del bbox.
  - Logging estructurado con `correlationId`, `stakeholderId`.
  - **Integration test (objeción #4 resuelta)**: seed con 3 escenarios:
    - Zona A: 6 viajes (5 dentro del bbox + 1 fuera) → `viajes_30d=5`, números visibles.
    - Zona B: 4 viajes (3 dentro + 1 fuera) → `insufficient_data: true`, `viajes_30d: null`.
    - Zona C: 0 viajes → `insufficient_data: true`, `viajes_30d: null`.
  - Integration test: 6 roles (5 negados + 1 admitido).
- **Rollback**: revertir commit. **Caveat (objeción #6 resuelta)**: si T11 (UI cards) ya mergeó, este rollback rompe la página de cards con 500 en producción. Plan de rollback post-T11: revertir T11 ANTES de T8 (frontend vuelve a estado pre-D11 con mock data).

### T9: Endpoint `GET /stakeholder/zonas/:slug/agregaciones`

- **Files**: `apps/api/src/routes/stakeholder.ts` (extender), `apps/api/test/integration/stakeholder.test.ts` (extender)
- **LOC estimate**: ~110 *(waiver: 3 breakdowns + metodologia + integration tests con k-anonymity per-cell. Auth ya viene de T8. El extra sobre 100 son los 3 helpers de agregación llamados en sequence + el field `metodologia` con generación del ISO timestamp.)*
- **Depends on**: T8 (auth + logging compartidos)
- **Acceptance** (criterio 4):
  - Retorna `por_hora_del_dia` (24 entries), `por_tipo_carga`, `por_combustible`.
  - Top-level `metodologia: { k_anonymity: 5, ventana_dias: 30, fuente: 'viajes_completados', generado_at: ISO }`.
  - Param `?window=30d` validado; otros valores → 400.
  - Zona inexistente → 404.
  - Integration test: bucketing horario + k-anonymity en celda con 4 viajes (null) vs 5 viajes (número).
- **Rollback**: revertir commit. **Caveat**: si T10 (UI drill-down) ya mergeó, esa página retorna error genérico (TanStack Query maneja). Sin daño funcional crítico, pero estakeholder ve "error" en drill-down hasta revertir T10 también.

### T10: UI drill-down ruta + componente

- **Files**: `apps/web/src/routes/stakeholder-zonas.$slug.tsx` (nuevo), `apps/web/src/services/stakeholder-aggregations-client.ts` (nuevo — hook `useStakeholderAgregaciones`), `apps/web/src/routes/stakeholder-zonas.$slug.test.tsx` (nuevo)
- **LOC estimate**: ~100
- **Depends on**: T9
- **Acceptance** (criterio 10):
  - Ruta TanStack Router `/app/stakeholder/zonas/$slug` registrada.
  - 3 secciones: por hora (24 barras), por tipo carga, por combustible. Visualización Tailwind barras horizontales con números, sin chart library nueva.
  - "Sin data suficiente" en celdas con `null` (k-anonymity).
  - Component tests: render con TanStack Query mock + assertion k-anonymity.
- **Rollback**: revertir commit. Caveat: si T11 ya mergeó y enlaza a esta ruta, los links dan 404. Aceptable como degradación transitoria — el banner pre-D11 vuelve al revertir T11.
- **Nota orden T10→T11 (decisión PO)**: T10 mergea primero para que T11 enlace a ruta existente.

### T11: UI cards reales (`stakeholder-zonas.tsx`)

- **Files**: `apps/web/src/routes/stakeholder-zonas.tsx` (modificar — remover `ZONAS_DEMO`, agregar TanStack Query), `apps/web/src/services/stakeholder-aggregations-client.ts` (extender — hook `useStakeholderZonas`), `apps/web/src/routes/stakeholder-zonas.test.tsx` (modificar)
- **LOC estimate**: ~120 *(waiver: refactor + nuevo cliente + tests. Alternativa de 2 PRs deja UI rota mid-merge.)*
- **Depends on**: T8, T10 (ya hay ruta drill-down registrada)
- **Acceptance** (criterio 9):
  - `ZONAS_DEMO` eliminada (`rg ZONAS_DEMO apps/web | wc -l` → 0).
  - Hook `useStakeholderZonas()` pulla `GET /stakeholder/zonas` con TanStack Query.
  - Estados: spinner / data / "Sin data suficiente" / error.
  - Banner "Datos de demostración" reemplazado por nota neutra con link a ADR-041.
  - Botón "Drill-down" navega a `/app/stakeholder/zonas/$slug` (ruta ya existe por T10).
  - Component tests + screenshot manual.
- **Rollback**: revertir commit. UI vuelve a mock data (no daño crítico, solo cosmético).

### T12: Performance — `EXPLAIN ANALYZE` + índice condicional

- **Files**: `apps/api/test/perf/stakeholder-zonas-explain.test.ts` (nuevo, ejecutable manual + en CI), eventualmente `apps/api/drizzle/0035_geocode_index.sql` (condicional)
- **LOC estimate**: ~50 (test + posible migration condicional)
- **Depends on**: T8 (endpoint debe existir para medir)
- **Acceptance** (cierra mitigación spec §riesgos):
  - Test perf seed 10k viajes distribuidos en 5 zonas.
  - Ejecuta `EXPLAIN ANALYZE` del query del endpoint /stakeholder/zonas.
  - Output capturado en chat.
  - Si plan muestra Seq Scan sobre `cargo_requests.origin->>'geocode'`: crea migration `0035_geocode_index.sql` con `CREATE INDEX CONCURRENTLY ... USING gin ((origin->>'geocode'))`.
  - Si Index Scan ya está activo: no crear migration, documentar en el commit.
- **Rollback**: revertir commit. Si la migration condicional se creó, `DROP INDEX CONCURRENTLY`.
- **Nota objeción #8 resuelta**: sin este task, el riesgo "performance degradación con volumen" del spec quedaba sin gate explícito.

---

## Out-of-band tasks

- **`docs/handoff/CURRENT.md`**: actualizar tras merge final (D11 completo, sale de "pendiente"). Plan 1 v2 lo cubre.
- **Métrica observability**: contador `stakeholder_aggregations_request_total` (label `zonaSlug`) en Cloud Monitoring. No bloquea, ejecutar dentro de 1 semana post-deploy.
- **Smoke staging**: tras merge T11, loguearse con `stakeholder@boosterchile.com`, verificar cards + drill-down, screenshot en CURRENT.md.
- **Métrica % viajes geocodificados**: spec lo lista como mitigación. Ticket separado.

---

## Open questions

**Resueltas en este plan revisado** (post devils-advocate + PO):

1. ~~Helper ubicación~~ → `packages/shared-schemas/src/aggregations/`.
2. ~~`puntoEnBoundingBox` ubicación~~ → `apps/api/services/`.
3. ~~Zona sin viajes~~ → incluir con `insufficient_data: true`.
4. ~~Orden T7/T8~~ → T10 (drill-down) antes que T11 (cards).
5. ~~Índice geocode~~ → task T12 explícito.

**Sin abrir** — no quedan.

---

## Verificación del plan (skill checklist)

- [x] Todas las tasks son vertical slices (compile + test + mergeable independientemente).
- [x] Todas las tasks ≤ 100 LOC estimate, excepto T8/T9/T11 con waiver justificado (cohesión funcional, no scope creep).
- [x] Acceptance traza a spec §3 (criterios 1-13) para cada task.
- [x] Rollback plan para cada task, con caveats explícitos cuando hay dependencias inversas (T3/T8/T9 post-merge irreversibles aisladamente).
- [x] Devils-advocate output capturado en respuesta del agente (12 objeciones, 4 fuertes resueltas: #2 swap T2/T3, #4 4-viajes-test en T8, #6 caveat rollback T8 post-T11, #11 caveat rollback T3 post-T8).
- [ ] Aprobación explícita del PO *(siguiente — pendiente)*

---

## Solo-developer adaptation

Tras aprobación: cooling-off 30 min antes de empezar T1 (agent-rigor §6.1). Re-leer plan con ojos frescos antes de invocar `/build`.

## Estimación total

- 12 tasks × ~85 LOC promedio = ~1020 LOC netas
- 4 PRs con waiver (T8, T9, T11; +T12 si requiere migration)
- Tiempo estimado: 5-7 días con foco continuo, 10-14 con interrupciones
