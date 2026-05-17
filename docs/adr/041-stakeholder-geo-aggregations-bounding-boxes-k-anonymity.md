# ADR-041 — Stakeholder geo aggregations: bounding boxes predefinidos + k-anonymity ≥ 5

**Fecha**: 2026-05-17
**Estado**: Accepted
**Refs**: `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md`, `docs/plans/2026-05-17-d11-stakeholder-geo-aggregations.md`, ADR-034 (`stakeholder-organizations`), ADR-021 (`glec-v3-compliance`)

## Contexto

El rol `stakeholder_sostenibilidad` (ADR-034) accede a la surface `/app/stakeholder/zonas` para auditar agregaciones de viajes en zonas geográficas relevantes (puertos, mercados de abastos, polos industriales, zonas francas). El sprint demo (PR #157) entregó la página con 5 zonas hardcoded en el frontend y datos `demo_*` inventados. Esto bloquea:

1. Demos a mandantes regulatorios (mesa público-privada, gremios) — los números no resisten preguntas.
2. Compliance ESG bajo GLEC v3.0 / GHG Protocol — el reporte debe ser reproducible desde la BD.
3. La promesa pública de la surface ("ninguna celda identifica a empresas individuales") — sin código que la garantice es marketing.

D11 reemplaza el skeleton por agregaciones reales. La decisión sobre **cómo** se delimita una "zona" y **cómo** se garantiza la no-identificabilidad tiene impacto en privacidad, auditabilidad y roadmap. Esta ADR fija ambos.

## Decisión

### 1. Bounding boxes predefinidos curados por migration

Las zonas viven en la tabla `zonas_stakeholder` con columnas `lat_min, lat_max, lng_min, lng_max` (rectángulo lat/lng axis-aligned). Se pueblan vía seed migration (`0034_zonas_stakeholder.sql`, T3 del plan) con bounding boxes validados manualmente contra OpenStreetMap. La columna `slug` (unique) es estable y referenciada por la UI.

**No se acepta input arbitrario de polígonos desde el cliente.** El admin que quiera agregar una zona abre un PR con una nueva fila de migration. Roadmap futuro: admin endpoint protegido para curar zonas — fuera del scope de D11.

### 2. k-anonymity ≥ 5 a nivel de servidor

El backend aplica `aplicarKAnonymity(buckets, k=5, countField='viajes')` (helper puro en `packages/shared-schemas/src/aggregations/k-anonymity.ts`, T4 del plan) sobre cada celda numérica antes de serializar la respuesta. Si `count < 5` los campos numéricos del bucket se reemplazan por `null` y el endpoint adjunta `insufficient_data: true` en cards o `viajes: null` en celdas de drill-down.

El threshold k=5 es **invariante por diseño**, codificado en el helper y verificado por test. No es parámetro de query.

### 3. Ventana fija de 30 días

Las queries filtran `pickup_at >= now() - interval '30 days'`. El param `?window=30d` se valida en el endpoint y rechaza cualquier otro valor con 400. La spec puede expandirse a 7d/90d en iteración 2 si la mesa pública lo pide formalmente.

## Alternativas consideradas y rechazadas

| Alternativa | Razón rechazo |
|---|---|
| **Geohash** (prefix de N caracteres) | Resolución no-uniforme (cells distintos sizes según latitud). Buscar "todos los geohashes de un puerto" requiere multiple prefixes, complicando query. No traceable visualmente sin tooling. |
| **H3 hex grid** (Uber) | Resolución uniforme pero requiere dependency adicional (`h3-js`) y traduce a queries con joins contra una tabla de cells precomputed. Overkill para 5 zonas curadas; útil si tuviéramos 500+. |
| **Polygon input libre desde frontend** | Vector de ataque: un stakeholder malicioso ajusta el polygon hasta que solo cae 1 empresa dentro → bypasea k-anonymity por carving. Requiere defensa server-side compleja (mínimo área, mínimo k post-recorte). Bounding boxes curados eliminan el ataque. |
| **PostGIS `ST_Within(geom, polygon)`** | PostGIS aún no está habilitado en este proyecto. Habilitarlo es decisión cross-feature (afecta backups, latency, costos). Bounding box rectangular se resuelve con `BETWEEN` sobre `lat`/`lng` numéricos — suficiente para D11. |
| **k=3 o k=10 en vez de k=5** | k=5 es el umbral defendido en literatura clásica (Samarati 1998) como balance entre privacidad y utilidad. k=3 es porous; k=10 deja la mayoría de celdas con `null` en nuestro volumen actual (~50 viajes/día). |

## Trade-offs aceptados

| Eje | Costo | Beneficio |
|---|---|---|
| **Precisión geográfica** | Bbox rectangular incluye edges no-pertenecientes a la zona real (ej. el bbox del Puerto Valparaíso incluye unos metros de mar). | Query trivial (`BETWEEN`), zero dependencies, debuggable a ojo. |
| **Privacidad** | Pierde utilidad analítica cuando los buckets son pequeños (zona con 4 viajes en 30d → todos los breakdowns en `null`). | Garantía formal de no-identificabilidad ≥ 5. Auditable por test unitario. |
| **Auditabilidad** | Documentar el bbox de cada zona como comentario SQL es manual y puede driftear vs. el rectángulo real. | Cualquier humano puede copiar/pegar las 4 coordenadas a OSM y verificar. Reproducible. |
| **Evolución** | Crecer a 100 zonas requiere o migration por cada una, o el admin endpoint del roadmap. | Para las 5 iniciales de D11 (más expansión esperada gradual), migration es suficiente. |

## Proceso "nueva zona"

Hasta que exista admin endpoint:

1. Identificar bbox sobre OSM (`https://www.openstreetmap.org/`).
2. Verificar que `lat_min < lat_max` y `lng_min < lng_max`.
3. Validar contra Zod schema (test unit del schema captura bbox invertido).
4. PR con migration nueva (`NNNN_zona_<slug>.sql`) que hace `INSERT INTO zonas_stakeholder (...) VALUES (...)`. Comment SQL con link OSM del bbox.
5. Review code-reviewer + security-auditor (bbox no-ataque vector).
6. Merge → deploy → smoke test desde stakeholder.

## Consecuencias

### Positivas

- Privacidad garantizada por construcción server-side; el frontend no puede romperla.
- Surface auditable: schemas Zod, helpers puros con tests, ADR referenciable desde la metodología visible al usuario (link en banner reemplazado).
- Sin dependencias nuevas (no h3, no PostGIS) — superficie de cambio mínima.

### Negativas / riesgos

- **Zonas con `null` por k < 5** generan UX "Sin data suficiente" en volumen bajo. Mitigación: ventana de 30 días suaviza variabilidad.
- **Migration por cada nueva zona** no escala más allá de ~20 zonas. Mitigación: roadmap admin endpoint cuando la presión llegue.
- **Bbox manualmente curado** puede driftear si el operador modifica sin re-verificar OSM. Mitigación: comment SQL con link al rectángulo en OSM (auditable a ojo).

## Referenced by

- T2 (Zod + Drizzle schema)
- T3 (Migration 0034 + seed)
- T4 (k-anonymity helper)
- T8 (endpoint cards 30d)
- T9 (endpoint agregaciones drill-down)
- T11 (UI cards — link al ADR desde nota metodológica)
