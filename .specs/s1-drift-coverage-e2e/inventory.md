<!-- AUTO-GENERATED FILE — do not edit by hand. -->
<!-- Curated metadata (gate, triage stats, decisions) lives in inventory-classification.md -->
---
generated_at: 2026-05-18T14:22:30.670Z
source_domain: packages/shared-schemas/src/domain
source_schema: apps/api/src/db/schema.ts
divergences_total: 10
gate_threshold: 10
---

# Drift inventory schema/domain — Sprint S1 T1.1

Generado por `scripts/repo-checks/drift-inventory.mjs`. Cubre SC-S1.1 + gate SC-S1.0 del sprint S1.

**Total divergencias detectadas**: 10 (threshold gate: 10).

## Acción del PO

Clasificar cada divergencia como **Clase A** (TS-only refactor), **Clase B** (breaking API → flag + sunset + ADR), o **Clase C** (cambio SQL → ADR de excepción).

Tras clasificar, cambiar frontmatter `gate: PENDING_PO` → `gate: APPROVED_BY_PO <fecha>` para permitir que pre-commit hook acepte commits `feat(domain)`.

## Divergencias

| # | Schema domain (TS) | Schema SQL (Drizzle) | Tipo | TS-only values | SQL-only values | Clase (PO) |
|---|---|---|---|---|---|---|
| 1 | `cargoRequestStatusSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 2 | `licenseClassSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 3 | `telemetrySourceSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 4 | `transportistaStatusSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 5 | `tripEventTypeSchema` | `tripEventTypeEnum` (`tipo_evento_viaje`) | value-mismatch | (none) | conductor_asignado, incidente_reportado | _TBD_ |
| 6 | `nivelCertificacionSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 7 | `tripMetricsSourceSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 8 | `tripStateSchema` | `tripStatusEnum` (`estado_viaje`) | value-mismatch | requested, offered_to_carrier, accepted, driver_assigned, driver_en_route, pickup_completed, in_transit, delivered, confirmed_by_shipper, completed_rated, carrier_rejected, carrier_timed_out, driver_rejected, cancelled_by_shipper, cancelled_by_carrier, failed, disputed | borrador, esperando_match, emparejando, ofertas_enviadas, asignado, en_proceso, entregado, cancelado, expirado | _TBD_ |
| 9 | `roleSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |
| 10 | `zonaStakeholderTipoSchema` | _no match_ | no-sql-match | (none) | (none) | _TBD_ |

## Tabla LOC adaptive (T1.5)

Patterns aplicables para T1.5 (40 LOC × N patterns):

- Pattern A (round-trip enum) → aplica si ≥1 Clase A.
- Pattern B (identifier match en read query) → aplica si ≥1 Clase B.
- Pattern C (flag transición Clase B durante doble-emit) → aplica si ≥1 Clase B.

## Cómo regenerar

```bash
node scripts/repo-checks/drift-inventory.mjs
```