---
fecha: 2026-05-18
fase: 1 de 7 (Discovery)
sub_spec: tripstate-alignment
ref: .specs/s1-drift-coverage-e2e/s1a-cierre.md §11 Condición 1
status: draft
---

# Fase 1 — Discovery Lists (materia prima de §boundary-translation)

## Objetivo

Enumerar **verbatim** las 3 listas que serán la materia prima del `§boundary-translation` cuando se redacte `.specs/tripstate-alignment/spec.md`. Esta fase es **lectura pura**: no propone mapping, no propone equivalencias, no edita schemas.

Referencia gobernanza: [`s1a-cierre.md`](../s1-drift-coverage-e2e/s1a-cierre.md) §11 Condición 1 — la sub-spec `tripstate-alignment` debe contener `§boundary-translation` con los 3 niveles documentados. Este doc es el insumo factual para esa sección.

---

## Lista 1 — `tripStateSchema` (Zod, TS-side)

- **Source**: [`packages/shared-schemas/src/domain/trip.ts:16`](../../packages/shared-schemas/src/domain/trip.ts)
- **Definición**: `export const tripStateSchema = z.enum([...])` (líneas 16-35).

### Valores verbatim (en orden de declaración)

| # | Valor | Comentario inline |
|---|---|---|
| 1 | `requested` | — |
| 2 | `offered_to_carrier` | — |
| 3 | `accepted` | — |
| 4 | `driver_assigned` | — |
| 5 | `driver_en_route` | — |
| 6 | `pickup_completed` | — |
| 7 | `in_transit` | — |
| 8 | `delivered` | — |
| 9 | `confirmed_by_shipper` | — |
| 10 | `completed_rated` | — |
| 11 | `carrier_rejected` | `// Excepciones` (línea 27, divisor entre felices y excepciones) |
| 12 | `carrier_timed_out` | — |
| 13 | `driver_rejected` | — |
| 14 | `cancelled_by_shipper` | — |
| 15 | `cancelled_by_carrier` | — |
| 16 | `failed` | — |
| 17 | `disputed` | — |

**Conteo**: 17 ✓ (matches expected).

**Comentario JSDoc en la definición** (líneas 11-15):

> "Estados del Trip lifecycle. Ver ADR-004 'Trip lifecycle como máquina de estados'. Las métricas ESG (huella, distancia, combustible) NO viven acá — viven en `trip-metrics.ts` (1:1 con trip)."

---

## Lista 2 — 5 canonical states declarados en SC-S1.5

- **Source**: [`.specs/s1-drift-coverage-e2e/spec.md:43`](../s1-drift-coverage-e2e/spec.md)
- **Cita verbatim del párrafo**:

> "**SC-S1.5** — `packages/trip-state-machine` implementado con XState v5. Estados desde `db/schema.ts` `tripStatusEnum`: `borrador`, `asignado`, `en_curso`, `entregado`, `cancelado`. Coverage ≥80/80/80/80."

### Valores verbatim (en orden de declaración)

| # | Valor |
|---|---|
| 1 | `borrador` |
| 2 | `asignado` |
| 3 | `en_curso` |
| 4 | `entregado` |
| 5 | `cancelado` |

**Conteo**: 5 ✓ (matches expected).

---

## Lista 3 — `tripStatusEnum` (SQL pgEnum, Drizzle schema)

- **Source**: [`apps/api/src/db/schema.ts:210`](../../apps/api/src/db/schema.ts)
- **Definición**: `export const tripStatusEnum = pgEnum('estado_viaje', [...])` (líneas 210-220).
- **SQL enum name** (mapeo Drizzle): TS identifier `tripStatusEnum` → SQL enum name `estado_viaje`.

### Valores verbatim (en orden de declaración)

| # | Valor |
|---|---|
| 1 | `borrador` |
| 2 | `esperando_match` |
| 3 | `emparejando` |
| 4 | `ofertas_enviadas` |
| 5 | `asignado` |
| 6 | `en_proceso` |
| 7 | `entregado` |
| 8 | `cancelado` |
| 9 | `expirado` |

**Conteo**: 9 ✓ (matches expected).

**Uso en runtime** (factual, sin interpretación): la columna `status` de la tabla `trips` usa este enum, con default `'esperando_match'` (línea 1063):

> `status: tripStatusEnum('estado').notNull().default('esperando_match'),`

---

## Observaciones factuales

Hechos, sin interpretación. La fase 2 decidirá qué hacer con cada uno.

### O-1. Counts coinciden con el expected del briefing

- Lista 1 (`tripStateSchema`): **17/17 ✓**
- Lista 2 (SC-S1.5): **5/5 ✓**
- Lista 3 (`tripStatusEnum`): **9/9 ✓**

Ninguna lista presenta count anómalo. Checkpoint por count **no es necesario**.

### O-2. Naming convention difiere entre Lista 1 y Listas 2-3

- **Lista 1** (`tripStateSchema`): mezcla de inglés (`requested`, `offered_to_carrier`, `driver_en_route`, `pickup_completed`, `in_transit`, `delivered`, `confirmed_by_shipper`, `completed_rated`, `carrier_rejected`, `carrier_timed_out`, `driver_rejected`, `failed`, `disputed`) + español/espanglish (`accepted`, `driver_assigned`, `cancelled_by_shipper`, `cancelled_by_carrier`). Casing: `snake_case` consistente.
- **Lista 2 y Lista 3**: español puro, `snake_case`. Lista 3 nombre del SQL enum es `estado_viaje` (snake_case spanish).

### O-3. Discrepancia entre Lista 2 y Lista 3 al nivel de string (NO count)

SC-S1.5 (Lista 2) declara: _"Estados desde `db/schema.ts` `tripStatusEnum`: `borrador`, `asignado`, `en_curso`, `entregado`, `cancelado`"_.

**4 de los 5 nombres aparecen verbatim en `tripStatusEnum` (Lista 3)**:

| SC-S1.5 (Lista 2) | tripStatusEnum (Lista 3) | Match string idéntico |
|---|---|---|
| `borrador` | `borrador` | ✓ |
| `asignado` | `asignado` | ✓ |
| `en_curso` | **NO existe en Lista 3** — Lista 3 tiene `en_proceso` | ✗ |
| `entregado` | `entregado` | ✓ |
| `cancelado` | `cancelado` | ✓ |

**Verificación runtime** (`rg "'en_curso'" --type ts`): **0 ocurrencias** en código TS. El string `'en_curso'` solo aparece en `.specs/s1-drift-coverage-e2e/spec.md` (la propia declaración SC-S1.5) y referencias subsecuentes que la citan.

**Verificación runtime** (`rg "'en_proceso'" --type ts`): aparece en al menos 6 archivos de runtime — services (`emitir-dte-liquidacion.ts`, `matching-v2-lookups.ts`, `confirmar-entrega-viaje.ts`), routes (`asignacion-detalle.tsx`), tests (`carga-track.test.tsx`).

Hecho factual: SC-S1.5 declara `en_curso` pero `tripStatusEnum` en SQL tiene `en_proceso`. El runtime usa `en_proceso`.

### O-4. Strings idénticos entre Lista 1 y Lista 3

Comparando `tripStateSchema` (Lista 1, 17 valores) contra `tripStatusEnum` (Lista 3, 9 valores):

| Valor | Lista 1 | Lista 3 |
|---|---|---|
| `borrador` | ✗ (no en Lista 1) | ✓ |
| `esperando_match` | ✗ | ✓ |
| `emparejando` | ✗ | ✓ |
| `ofertas_enviadas` | ✗ | ✓ |
| `asignado` | ✗ | ✓ |
| `en_proceso` | ✗ | ✓ |
| `entregado` | ✗ | ✓ |
| `cancelado` | ✗ | ✓ |
| `expirado` | ✗ | ✓ |

**0 strings idénticos** entre Lista 1 y Lista 3. Los conceptos pueden tener overlap semántico (por ejemplo `accepted` ↔ `asignado`, `in_transit` ↔ `en_proceso`, `delivered` ↔ `entregado`, etc.) — pero ese análisis es **Fase 2**, no Fase 1.

### O-5. Strings idénticos entre Lista 2 y Lista 1

`tripStateSchema` (Lista 1) tiene 0 valores que coincidan verbatim con los 5 nombres de SC-S1.5 (Lista 2). Los conceptos están en español (Lista 2) vs mixto-inglés (Lista 1).

### O-6. Definición del SQL enum precede semánticamente a Lista 2

`tripStatusEnum` SQL existe y tiene runtime usage extenso. SC-S1.5 fue redactada **citando** SQL como source-of-truth (frase _"Estados desde `db/schema.ts` `tripStatusEnum`"_) pero **introduce un nombre (`en_curso`) que no existe en ese enum**. Esto es hecho factual, no interpretación.

### O-7. ADR-004 referenciado en el JSDoc de Lista 1

El comentario de `tripStateSchema` cita ADR-004 ("Trip lifecycle como máquina de estados") como autoridad del lifecycle. Para Fase 2 sería relevante consultar ese ADR — fuera de scope Fase 1.

---

## Checkpoint requerido antes de Fase 2

No requerido por **count** (todos matchean expected).

**Sí requerido por valor** según juicio PO: la discrepancia O-3 (`en_curso` en SC-S1.5 vs `en_proceso` en SQL + runtime) puede ser:

- Typo en el spec — `en_curso` debería ser `en_proceso`.
- Decisión deliberada — el spec propone renombrar `en_proceso` → `en_curso` en la machine canonical.
- Otra cosa que solo el PO puede aclarar.

**Esa decisión NO es de Fase 1**. Surface al PO antes de arrancar Fase 2 (drafting de `§boundary-translation`), para que el mapping no se construya sobre ambigüedad.

---

## Status

DRAFT — esperando review PO. NO drafting de mapping (Fase 2) hasta firma sobre O-3.
