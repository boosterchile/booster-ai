# Spec — D11 Stakeholder geo aggregations (cards + drill-down)

**Fecha**: 2026-05-11
**Owner**: Felipe Vicencio (PO) + Claude
**Branch**: `claude/spanish-greeting-pqMN2`
**Sprint origen**: PR #157 (demo features) — D11 quedó como skeleton con mock data
**ADR a crear**: `033-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md`

---

## Problema

El sprint demo (#157) entregó la surface `/app/stakeholder/zonas` para el rol `stakeholder_sostenibilidad` con **5 zonas predefinidas hardcoded en el frontend** (Puerto Valparaíso, Puerto San Antonio, Mercado Lo Valledor, Polo Quilicura, Zona Franca Iquique) y **datos demo inventados** (`demo_viajes_30d`, `demo_co2e_kg`, `demo_horario_pico`). El handoff `docs/handoff/2026-05-11-demo-features-night-sprint.md` (línea 134) lo deja documentado como follow-up:

> D11 agregaciones reales — sustituir mock data del frontend por queries reales sobre trips agregadas con k-anonymity ≥ 5.

Hoy el stakeholder ve cards plausibles pero **no auditables** (cualquier humano nota números redondos), el botón "Drill-down — próximamente" está disabled, y no hay ADR que formalice la metodología (k-anonymity ≥ 5, bounding boxes predefinidos, sin PII). Esto bloquea:

1. Demos a mandantes regulatorios reales (mesa público-privada, gremios) — los datos no resisten una pregunta.
2. Compliance ESG bajo GLEC v3.0 / GHG Protocol — el reporte tiene que ser reproducible desde la BD.
3. La promesa pública de la surface ("ninguna celda identifica a empresas individuales") — sin código que la garantice, es marketing.

## Solución propuesta

Reemplazar el skeleton con un sistema end-to-end de agregaciones reales sobre `viajes` filtradas por bounding box geográfico predefinido y ventana temporal, aplicando k-anonymity ≥ 5 a nivel de servidor. Las zonas dejan de vivir en el frontend y pasan a una tabla `zonas_stakeholder` poblada por seed migration (curable por la mesa pública sin redeploy del web). El endpoint `GET /stakeholder/zonas` devuelve totales 30d (viajes, CO₂e, horario pico) por zona; `GET /stakeholder/zonas/:id/agregaciones` devuelve breakdown por hora del día, tipo de carga y mix de combustible. Frontend pulla ambos endpoints con TanStack Query y reemplaza el banner "datos de demostración" por la metodología real (k-anonymity threshold, ventana, fuente). Decisión arquitectónica formalizada en ADR-033.

## Criterios de aceptación

Cada criterio debe ser verificable con evidencia (test, output, screenshot).

1. **Tabla `zonas_stakeholder`** existe en BD vía migration `0027_zonas_stakeholder.sql` con columnas: `id` (uuid), `slug` (text unique), `nombre` (text), `region_code` (text), `tipo` (enum `puerto`/`mercado_abastos`/`polo_industrial`/`zona_franca`), `lat_min`, `lat_max`, `lng_min`, `lng_max` (doubles, bounding box), `is_active` (bool), `created_at`, `updated_at`. Seed insert de las 5 zonas iniciales con bounding boxes reales (validados manualmente sobre OSM). **Evidencia**: migration aplicada en test DB + query `SELECT COUNT(*) FROM zonas_stakeholder WHERE is_active = true` retorna 5.

2. **Schema Zod canónico** `zonaStakeholderSchema` en `packages/shared-schemas/src/domain/zona-stakeholder.ts` con tipos exportados. Drizzle table coincide 1:1 (snake_case en SQL, camelCase en TS). **Evidencia**: tests unit del schema (válido / inválido / bounding box invertido).

3. **Endpoint `GET /stakeholder/zonas`** retorna 200 con array de cards `{ id, slug, nombre, region, tipo, viajes_30d, co2e_total_kg, horario_pico_inicio, horario_pico_fin }`. Si una zona tiene <5 viajes en la ventana, los campos numéricos vienen como `null` y un campo `insufficient_data: true`. Los campos de viajes considerados: `viajes` con `state IN ('delivered', 'confirmed_by_shipper', 'completed_rated')` cuyo `cargo_request.origin.geocode` cae dentro del bounding box, y `pickup_at >= now() - interval '30 days'`. **Evidencia**: integration test con seed de 6 viajes (5 dentro del bbox + 1 fuera) verifica que retorna la zona con `viajes_30d=5` y la fuera con `null + insufficient_data=true`.

4. **Endpoint `GET /stakeholder/zonas/:id/agregaciones?window=30d`** retorna 200 con breakdown:
   - `por_hora_del_dia`: array de 24 entries `{ hora: 0..23, viajes, co2e_kg }` con k-anonymity ≥ 5 por celda (si <5 → `viajes: null, co2e_kg: null`).
   - `por_tipo_carga`: array `{ tipo: CargoType, viajes, co2e_kg }` con mismo filtro k.
   - `por_combustible`: array `{ fuel_type: FuelType, viajes, co2e_kg }` con mismo filtro k.
   - Campo top-level `metodologia: { k_anonymity: 5, ventana_dias: 30, fuente: 'viajes_completados', generado_at: ISO }`.

   **Evidencia**: integration test verifica bucketing horario correcto + k-anonymity flag en celda con 4 viajes vs 5 viajes.

5. **Authorization**: ambos endpoints requieren rol `stakeholder_sostenibilidad` activo en `me.active_membership.role`. Cualquier otro rol responde **403 forbidden** con mensaje en español. **Evidencia**: integration tests con cada uno de los 5 roles (rechazo + 1 admisión).

6. **k-anonymity correctness**: helper puro `aplicarKAnonymity(buckets, k)` en `packages/shared-schemas/src/aggregations/k-anonymity.ts` (o package nuevo si decidimos en /plan). Reemplaza valores numéricos por `null` cuando `count < k`. **Evidencia**: unit tests cubriendo k=5, k=1, bucket vacío, bucket de exactamente k.

7. **CO₂e fuente**: prioriza `trip_metrics.carbon_emissions_kgco2e_actual`; fallback a `_estimated`; si ambos `null`, el viaje **no contribuye al total** (se loguea como warning estructurado pero no rompe). **Evidencia**: unit test del agregador.

8. **Horario pico**: ventana de 4 horas consecutivas con mayor número de pickups en los últimos 30 días, calculado server-side. Si <5 viajes en toda la ventana, `null`. **Evidencia**: unit test con casos sintéticos.

9. **UI cards reales**: `apps/web/src/routes/stakeholder-zonas.tsx` deja de importar `ZONAS_DEMO`, pulla `GET /stakeholder/zonas` con TanStack Query, muestra spinner mientras carga, "Sin data suficiente" cuando `insufficient_data: true`, y elimina el banner amarillo "Datos de demostración". Banner se reemplaza por una nota neutra que enlaza a la metodología (ADR-033). **Evidencia**: vitest + screenshot manual.

10. **UI drill-down**: nueva ruta `/app/stakeholder/zonas/$slug` (TanStack Router) muestra los 3 breakdowns (hora, tipo, combustible) como gráficos simples (barras horizontales con números, no chart library nueva — reusar tailwind). Botón "Drill-down" deja de estar disabled. **Evidencia**: vitest del componente + screenshot.

11. **ADR-033** `docs/adr/033-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md` documenta:
    - Decisión: bounding boxes predefinidos (no arbitrary polygon input) + k-anonymity ≥ 5 + ventana 30d.
    - Alternativas consideradas (geohash, h3 hex grid, polygon input libre) y por qué se rechazaron.
    - Trade-offs (precisión vs privacidad vs auditabilidad).
    - Cómo se expande (proceso para curar nueva zona via migration o admin endpoint).
    - Referenced by: schema canónico, endpoints, UI metodología.

12. **Coverage ≥ 80%** mantenido en `apps/api`, `apps/web`, `packages/shared-schemas` (regla bloqueante de CI). **Evidencia**: output `pnpm test --coverage`.

13. **Logging estructurado**: cada hit a los endpoints registra log con `correlationId`, `stakeholderId`, `zonaSlug` (sin PII de viajes). **Evidencia**: unit test del logger middleware o assertion en integration test.

## No goals

Para evitar scope creep, esta spec **NO** cubre:

- **CRUD admin de zonas**: las zonas se administran vía migration. UI admin para añadir/editar zonas queda para sprint posterior si la mesa pública lo pide.
- **Drill-down a trip individual**: nunca. El stakeholder NO ve trips identificables. Esto es invariante por diseño (ADR-033).
- **Exportación CSV/PDF de las agregaciones**: queda para sprint posterior si stakeholders lo piden formalmente.
- **WebSockets / streaming en vivo**: las queries son batch sobre últimos 30d, refrescables on demand. No hay live updates.
- **Ventanas configurables por el usuario** (7d, 90d): por ahora ventana fija de 30d. Param `window` se valida pero solo acepta `30d`. Spec puede expandirse en iteración 2.
- **Soporte multi-tenant para stakeholders** (ej. consorcio de gremios con vistas separadas): todos los stakeholders activos ven la misma data agregada — los `consent grants` no aplican aquí porque la data ya es anónima. Esto es decisión documentada en ADR-033.
- **Geocoding de cargo requests sin `geocode`**: si un `cargo_request.origin.geocode` viene null, el viaje simplemente no entra en ninguna zona (se loguea pero no se interpola). Backfill de geocoding es spec separada.
- **Cache (Redis)**: las queries son lo suficientemente simples para no cachear en v1. Si el dashboard sufre, se añade cache en iteración posterior.

## Riesgos + mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **k-anonymity bug → fuga de viajes individuales** | Media | Crítico (privacy breach + reputación) | Helper puro con tests exhaustivos (incluye edge cases k=0, k=1, bucket=k, bucket=k-1). PR review obligatorio. Audit log de cualquier respuesta con `insufficient_data=false` y `viajes < 10` por 90d. |
| **Bounding boxes mal calibrados** | Media | Medio (datos engañosos) | Validar bbox de cada zona contra OSM antes del seed; documentar fuente del bbox en comment de la migration. Test integration con coordenadas borde. |
| **Performance de query con muchos trips** | Baja (volumen actual ~50/día) | Medio | Index sobre `(pickup_at, state)` ya existe; añadir GIN/btree sobre `cargo_requests.origin->>'geocode'` si EXPLAIN ANALYZE muestra full scan. Medir con seed de 10k trips. |
| **`cargo_request.origin.geocode` null en producción** | Alta (no toda carga viene geocodificada) | Bajo (zona simplemente no la cuenta) | Loguear warning estructurado. Métrica de "% trips geocodificados" en dashboard observability. No bloquea spec. |
| **Stakeholder ve data y exige más zonas** | Alta | Bajo (es el objetivo) | Proceso de "nueva zona" documentado en ADR-033 (PR con migration). Roadmap futuro: admin endpoint. |
| **CO₂e en `actual` y `estimated` ambos null** | Media | Bajo | Fallback documentado (criterio 7); warning log. |

## Plan de testing

### Unit tests (vitest)

- `packages/shared-schemas/src/aggregations/k-anonymity.test.ts`: helper puro con casos k=5, k=1, k=0, bucket vacío, bucket=k, bucket=k-1.
- `packages/shared-schemas/src/domain/zona-stakeholder.test.ts`: schema válido / inválido / bounding box invertido (`lat_min > lat_max`).
- `apps/api/src/services/stakeholder-aggregations.test.ts`: helpers `agregarPorHora`, `agregarPorTipoCarga`, `agregarPorCombustible`, `calcularHorarioPico`, `puntoEnBoundingBox`. Casos: cero viajes, exactamente k, k+1, mix de geocodes null.

### Integration tests (vitest + test DB)

- `apps/api/src/routes/stakeholder.test.ts`:
  - GET `/stakeholder/zonas` con seed de 6 viajes (5 dentro de Lo Valledor + 1 fuera): retorna 5 zonas, Lo Valledor con números, resto con `insufficient_data: true`.
  - GET `/stakeholder/zonas/:slug/agregaciones`: bucketing horario correcto.
  - 403 con cada rol no-stakeholder (5 roles).
  - 200 con stakeholder.
  - Zona inexistente → 404.

### Component tests (vitest + jsdom)

- `apps/web/src/routes/stakeholder-zonas.test.tsx`: render con TanStack Query mock — estados loading / data / sin data.
- `apps/web/src/routes/stakeholder-zona-detalle.test.tsx`: render del drill-down + assertion de "Sin data suficiente" en celda con `null`.

### Manual verification

- Seed demo en dev local → loguearse con user `stakeholder@boosterchile.com` → verificar:
  - Cards muestran números reales del seed.
  - Drill-down abre y muestra los 3 breakdowns.
  - "Sin data suficiente" aparece donde corresponde.
- Screenshot pegado en el PR.

### Coverage

- `pnpm test --coverage` global ≥ 80% (gate de CI bloqueante). Si baja por archivo nuevo, añadir tests.

## Rollout

- **Sin feature flag** — esta surface ya existe en producción con mock data y rol `stakeholder_sostenibilidad` ya restringido. Reemplazar mock por real es estrictamente mejora.
- **Migration**: aplicada automáticamente al startup del API por `src/db/migrator.ts` (ver `apps/api/drizzle.config.ts`).
- **Sin downtime**: tabla nueva, endpoints nuevos, ruta web nueva. La ruta existente cambia su data source (mock → API call) pero contractuamente la página se renderiza igual.
- **Verificación post-deploy**: smoke test manual en staging con stakeholder de prueba; revisar logs estructurados primer hit.
- **Rollback plan**: si los endpoints fallan, el frontend muestra estado de error genérico (TanStack Query lo maneja). Sin riesgo de data corruption porque son solo queries de lectura.

---

**Estado**: pendiente de aprobación del PO antes de pasar a `/plan`.
