# ADR-042 — Stakeholder geo aggregations: filtro por comuna + alineación schema/domain

**Fecha**: 2026-05-17
**Estado**: Accepted
**Supersedes parcial**: ADR-041 (decisión §1 "bounding boxes predefinidos" reemplazada por filtro `originComunaCode`; las decisiones §2 k-anonymity, §3 ventana 30d, §4 proceso "nueva zona" se mantienen).
**Refs**:
- `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (spec D11, ya en main)
- `docs/plans/2026-05-17-d11-stakeholder-geo-aggregations.md` (plan v1, status BLOCKED)
- `docs/handoff/2026-05-17-d11-review-plan.md` (review formal de los 12 PRs del BUILD)
- ADR-005 (telemetry IoT), ADR-009 (Google API key strategy), ADR-034 (stakeholder organizations)

## Contexto

El BUILD autónomo de D11 (commits `bf6770e..117ad37` ejecutados por `/goal` el 2026-05-17) descubrió en T8 un gap entre el spec criterio 3 y el schema real:

| Spec esperaba | Schema real |
|---|---|
| `cargo_request.origin.geocode` (lat/lng) por viaje | `viajes.originAddressRaw` (texto) + `viajes.originComunaCode` (string ISO 3166-2). No hay tabla `cargo_requests`. |
| `tripStateEnum` valores `'delivered' \| 'confirmed_by_shipper' \| 'completed_rated'` | `tripStatusEnum` en `db/schema.ts`: `'borrador' \| 'asignado' \| 'en_curso' \| 'entregado' \| 'cancelado'`. Sin equivalencia 1:1. |
| `viajes.pickup_at` (timestamp) | `viajes.pickupWindowStart` (timestamp) |

El agente del BUILD declaró abort correctamente, pero después auto-resolvió la opción 1 (agregar `origen_lat`/`origen_lng` nullable a `viajes` + backfill futuro Geocoding API) sin sign-off del PO. PR #253 fue REJECTED en review formal por: violación de contrato agent-rigor, k-anonymity bugs amplificados, hardcoded `'carga_seca'`/`'diesel'`, `CREATE INDEX` sin `CONCURRENTLY`, drift schema/domain no mencionado.

Decisión del PO post-review: **pivote a Opción 2** — filtrar viajes por `originComunaCode` mapeado a la zona stakeholder, sin migration de geocode + sin backfill Geocoding API.

## Decisiones

### 1. Filtro por `originComunaCode` (reemplaza bbox)

El endpoint `/stakeholder/zonas` y `/stakeholder/zonas/:slug/agregaciones` filtran viajes así:

```sql
WHERE v.origen_codigo_comuna = ANY(z.comuna_codes)
  AND v.status = 'entregado'
  AND v.pickup_window_start >= now() - interval '30 days'
```

donde `z.comuna_codes` es un nuevo campo `text[]` en `zonas_stakeholder` (ver decisión §2).

**Trade-off vs bbox**: granularidad comuna (≈unidad administrativa chilena) en vez de lat/lng exacto. Para audiencia stakeholder ESG (mesa pública, gremios, mandantes regulatorios) la granularidad comuna es **suficiente y más reconocible** — "viajes a/desde Quilicura" es más interpretable que "viajes dentro de un bbox de coordenadas". Pierde precisión de bordes (un viaje en la frontera de 2 comunas cuenta solo en la comuna registrada), gana auditabilidad (`originComunaCode` viene del propio shipper al crear el cargo, no de geocoding API externa).

### 2. Schema `zonas_stakeholder`: agregar `comuna_codes text[]`

Migration nueva `0036_zonas_stakeholder_add_comuna_codes.sql`:

```sql
ALTER TABLE zonas_stakeholder
  ADD COLUMN comuna_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX CONCURRENTLY idx_zonas_stakeholder_comuna_codes
  ON zonas_stakeholder USING GIN (comuna_codes);

COMMENT ON COLUMN zonas_stakeholder.comuna_codes IS
  'Codigos comuna ISO 3166-2 (e.g. CL-RM-QUI para Quilicura). Un viaje pertenece a la zona si v.origen_codigo_comuna = ANY(z.comuna_codes). Default ARRAY[]::text[] para back-compat — zonas sin comunas no agregan nada.';
```

**Seed update** (en una migration o en T3 v2): cada una de las 5 zonas iniciales recibe sus comuna codes:
- Puerto Valparaíso → `['CL-VS-VAL']` (Valparaíso comuna)
- Puerto San Antonio → `['CL-VS-SAN']` (San Antonio comuna)
- Mercado Lo Valledor → `['CL-RM-PED']` (Pedro Aguirre Cerda comuna)
- Polo Quilicura → `['CL-RM-QUI']` (Quilicura comuna)
- Zona Franca Iquique → `['CL-TA-IQQ']` (Iquique comuna)

(Códigos ISO 3166-2 chilenos verificados contra `https://en.wikipedia.org/wiki/ISO_3166-2:CL`.)

### 3. Columnas `lat_min/max/lng_min/lng_max` se mantienen como metadata informativo

NO se dropean — quedan como bounding box descriptivo de la zona (útil para UI map preview futuro). No se usan para filtrado. Esto evita una migration destructiva sobre tabla recién creada.

### 4. Alineación schema/domain — `tripStatus` y `pickupAt`

**Decisión pragmática**: `packages/shared-schemas/src/domain/trip.ts` se alinea con `apps/api/src/db/schema.ts`, NO al revés. Razones:
- `db/schema.ts` ya tiene data en producción con valores `'entregado'`, etc. Migrar requiere `UPDATE` masivo + downtime + risk.
- El cliente final habla español; los valores del enum aparecen en API responses y UI.
- Espíritu CLAUDE.md "naming bilingüe" admite excepciones documentadas.

**Cambios concretos** (a aplicar en un PR de fix dedicado):
- `domain/trip.ts` `tripStateSchema` → valores en español: `'borrador'`, `'asignado'`, `'en_curso'`, `'entregado'`, `'cancelado'` (mirror del enum SQL).
- `domain/trip.ts` `pickupAt` → renombrar a `pickupWindowStart` (mirror del campo SQL).
- Cualquier consumer de los valores antiguos debe migrar (probablemente cero — el domain canónico no se usaba ampliamente antes).

**Futuro deseado** (no implementado en esta ADR): unificar nomenclatura definitivamente. Pero esto es out-of-scope D11 — sería un sweep mayor de codebase.

### 5. Filtro de estado: solo `'entregado'`

El endpoint cuenta SOLO viajes con `status = 'entregado'`. Razones:
- Es el estado de "viaje completado" — único auditable por stakeholder ESG.
- Otros estados son intermedios (`asignado`, `en_curso`) y agregarían ruido + revelan pipeline interno.
- `cancelado` no debe contar (los kg CO₂e de un viaje cancelado son cero o irrelevantes).

Si el spec futuro pide diferenciar agregaciones entre "todos los viajes" y "solo completados", se agrega query param `?status=all|completed` (default `completed`).

### 6. k-anonymity: aplicar a TRES niveles

Per los hallazgos del review formal (helper #249 fix mergeable como #259):

1. **Dataset-level** (gate de la respuesta): si `total_viajes < k` (k=5), el endpoint retorna el shell con `insufficient_data: true` SIN bucketizar. Esto evita el bucket-existence leak descrito en el security audit de #254 (T9 escondido).

2. **Per-bucket en dimensiones de universo cerrado** (`por_hora_del_dia`): los 24 buckets siempre se emiten (universo cerrado de 24 horas). Cuando un bucket tiene count<k, se enmascara (`viajes: null, co2e_kg: null`, hora preservada). La existencia del bucket no leak porque las 24 horas siempre están.

3. **Per-bucket en dimensiones quasi-identifier** (`por_tipo_carga`, `por_combustible`): se usa `dropSubKBuckets: true` del helper. Buckets con count<k se ELIMINAN del array. La existencia misma del bucket es información sensible.

### 7. T7 puntoEnBoundingBox: DEPRECATED en Opción 2

El helper `puntoEnBoundingBox` (PR #252, REQUEST_CHANGES NaN) NO se necesita en Opción 2. El filtro es por comuna code (SQL `WHERE origen_codigo_comuna = ANY(...)`), no por geo math.

**Acción**: cerrar PR #252 sin merge. El helper queda en git history; si en el futuro se hace pivote a geo filtering, recuperable.

## Alternativas consideradas (post abort T8)

1. **Migration 0035 `origen_lat`/`origen_lng` nullable + backfill Geocoding API** (ADR-041 implícito, PR #253):
   - Costo: ~$50-200 USD en Google Geocoding API + 2-3 días backfill + risk de rate-limit + dependencia externa (ADR-009 implicaciones).
   - Beneficio: precisión lat/lng exacta.
   - Rechazado: granularidad no justifica costo para audiencia stakeholder.
2. **FK `viajes.sucursalOrigenId`** (Opción 3 del abort doc):
   - Solo cubre viajes con origen = sucursal del shipper. Trips con origen "pickup en planta" o "puerto" se pierden.
   - Rechazado: cobertura parcial inadmisible para reporte ESG.
3. **Posponer D11 hasta tener geocoding completo** (Opción 4):
   - Bloquea entrega a stakeholders ESG por meses.
   - Rechazado: la mesa pública pide datos YA.

## Trade-offs

| Eje | Opción 1 (bbox + lat/lng) | Opción 2 ELEGIDA (comuna) |
|---|---|---|
| Precisión geográfica | Alta (lat/lng exacto) | Media (comuna ~ unidad admin chilena) |
| Migration risk | Alta (columns en tabla central + backfill) | Baja (ADD COLUMN nullable + GIN index) |
| Costo externo | $50-200 USD + rate-limit risk | $0 |
| Auditabilidad | Depende de Geocoding API (caja negra) | Comuna code viene del propio shipper (verificable) |
| Tiempo a entrega | ~2-3 días + backfill | Mismo día post-fix de PRs existentes |
| Granularidad UX | Bbox = rectángulo abstracto | Comuna = unidad reconocible para humanos |

## Proceso "nueva zona" (heredado de ADR-041 §4, ajustado)

Para agregar una zona stakeholder:

1. PR con migration que agrega row a `zonas_stakeholder`:
   - `slug`, `nombre`, `region_code`, `tipo` (per enum).
   - `comuna_codes` array de códigos ISO 3166-2 de las comunas que la componen.
   - `lat_min/max/lng_min/lng_max` opcional (informativo).
   - `is_active = true`.
2. Code-reviewer valida que los `comuna_codes` existen en la lista oficial ISO 3166-2:CL.
3. Smoke en staging: hit `/stakeholder/zonas`, confirmar que la nueva zona aparece con o sin `insufficient_data` según volumen de viajes en esas comunas.

Future: admin endpoint en `/admin/stakeholder-zonas` para CRUD sin PR. Out-of-scope D11.

## Consecuencias para los PRs abiertos (post-review)

| PR | Antes (Plan v1) | Ahora (Plan v2 con ADR-042) |
|---|---|---|
| [#246 T1 ADR-041](https://github.com/boosterchile/booster-ai/pull/246) | SUPERSEDE | Status → "Superseded by ADR-042 (decisión §1 reemplazada)". Mergeable como historia. |
| [#247 T2 Zod+Drizzle](https://github.com/boosterchile/booster-ai/pull/247) | REQUEST_CHANGES | Fix: `numeric` → `numeric(10,7) mode:'number'`. Plus añadir `comuna_codes: z.array(z.string())`. Re-target a main. |
| [#250 T5 hora+pico](https://github.com/boosterchile/booster-ai/pull/250) | REQUEST_CHANGES | Fix: `pickup_at` → `pickupWindowStart`. Aplicar k-anon dataset-level en `calcularHorarioPico`. Test bimodal real. |
| [#251 T6 tipo+combustible](https://github.com/boosterchile/booster-ai/pull/251) | MERGE post-T5 | Sin cambios mayores, solo docstring (per review). Re-target a main tras T5 fix. |
| [#252 T7 puntoEnBoundingBox](https://github.com/boosterchile/booster-ai/pull/252) | REQUEST_CHANGES | **DEPRECATED en Opción 2**. Close sin merge. |
| [#253 T8 abort doc](https://github.com/boosterchile/booster-ai/pull/253) | REJECT (reset a abort-doc) | Mergeable como histórico del incidente. T8 v2 nuevo PR. |
| [#255 T10 UI drill-down](https://github.com/boosterchile/booster-ai/pull/255) | CLOSED (base eliminado) | Re-implementar en T10 v2 con barras 24h + banner ADR-042. |
| [#256 T11 UI cards](https://github.com/boosterchile/booster-ai/pull/256) | REQUEST_CHANGES + SPLIT | Re-implementar en T11 v2 con jerarquía banner + retry + drill-down disabled si insufficient_data. |
| [#257 T12 perf gate](https://github.com/boosterchile/booster-ai/pull/257) | REVERT_DONE_MARK | Re-implementar en T12 v2 con EXPLAIN ANALYZE real sobre query de comuna filter + script test:perf separado. |

## Plan D11 v2

Sale como documento separado (`docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md`) post-merge de este ADR.

## Lecciones aplicadas

- **Domain canónico ≠ db schema** es signal de drift. Antes de cualquier feature que toque agregaciones de viajes/cargo, verificar alineación con `domain/trip.ts`.
- **Abort trigger del agente debe respetarse**: el agente NO debe auto-resolver decisiones arquitectónicas. Si el plan v1 hubiera tenido el abort más explícito en el goal text, el incidente del PR #253 no habría pasado.
- **k-anonymity per-bucket no basta**: la presencia/ausencia de buckets también leakea. Helper fix (#259) introduce `dropSubKBuckets`.
- **CI sobre PRs stacked es frágil**: cuando una base branch se elimina, el PR auto-cierra. Mejor: target main directo + rebase manual.

---

**Status final**: Accepted. Esta ADR queda como decisión vigente. ADR-041 se preserva como contexto histórico del intento bbox; ADR-042 es la implementación actual.
