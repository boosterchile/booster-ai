# Drift inventory — Análisis manual + clasificación (T1.1)

- Auto-generado: [`inventory.md`](./inventory.md)
- Sprint: S1a (drift schema/domain implementation)
- Cubre: SC-S1.1 (clasificación) + input para SC-S1.0 gate
- Status: **Propuesta del agente** (firma PO requerida)

---

## Resumen ejecutivo

Script `scripts/repo-checks/drift-inventory.mjs` detectó **10 divergencias** entre `packages/shared-schemas/src/domain/*.ts` y `apps/api/src/db/schema.ts`. Threshold gate es `> 10` (estrictamente mayor) → **gate SC-S1.0 PASA** automáticamente con exit code 0. Sin embargo, requiere clasificación A/B/C antes de T1.2.

| Caso | Clase propuesta | Razón |
|---|---|---|
| 1 — `cargoRequestStatusSchema` (no-sql-match) | **Clase A — falso positivo heurístico** | El SQL probablemente usa otro nombre (verificar manual). TS-only refactor si confirma. |
| 2 — `licenseClassSchema` (no-sql-match) | **Falso positivo** | SQL tiene `licenciaClaseEnum`; heurística falló en match `licenseClass*` ↔ `licenciaClase*`. |
| 3 — `telemetrySourceSchema` (no-sql-match) | **Clase A — TS-only legítimo** | Telemetría source (gps/can_bus/manual) probablemente vive en columna text sin pgEnum. Acceptable TS-only o crear pgEnum (Clase C). |
| 4 — `transportistaStatusSchema` (no-sql-match) | **Falso positivo** | SQL probablemente `empresaStatusEnum` o similar; cross-check manual. |
| 5 — `tripEventTypeSchema` ↔ `tripEventTypeEnum` (value-mismatch) | **Clase A** | Domain ZERO valores en TS-only (lista vacía). SQL tiene 2 extras: `conductor_asignado`, `incidente_reportado`. Domain alinea agregando los 2 valores. |
| 6 — `nivelCertificacionSchema` (no-sql-match) | **Clase A — TS-only legítimo o falso positivo** | Verificar si SQL tiene `certificacionNivelEnum` o similar; si no, TS-only. |
| 7 — `tripMetricsSourceSchema` (no-sql-match) | **Clase A — TS-only legítimo** | Probablemente vive en columna text. Acceptable TS-only. |
| 8 — **`tripStateSchema` ↔ `tripStatusEnum`** (value-mismatch CRÍTICO) | **Clase B** | 17 valores TS vs 9 SQL. Mapeo no 1:1. Requiere ADR de excepción + flag + sunset + posiblemente refactor del state machine completo. |
| 9 — `roleSchema` (no-sql-match) | **Falso positivo** | SQL tiene `membershipRoleEnum`; heurística falló. |
| 10 — `zonaStakeholderTipoSchema` (no-sql-match) | **Clase A — TS-only legítimo o falso positivo** | Verificar si SQL tiene equivalente. |

**Distribución sugerida**:
- **Clase A** (TS-only refactor): 4-6 casos (1, 3, 5, 6, 7, 10) — depende de cross-check manual.
- **Clase B** (breaking API + flag + ADR): **1 caso crítico (tripStateSchema)**.
- **Falsos positivos del heurístico**: ~3-4 casos (2, 4, 9 confirmados; otros por verificar).
- **Clase C** (cambio SQL): 0 candidatos claros.

## Análisis profundo: caso 8 — `tripStateSchema` ↔ `tripStatusEnum`

### El problema

| TS (`tripStateSchema`) | SQL (`tripStatusEnum`, `estado_viaje`) |
|---|---|
| 17 valores fine-grained | 9 valores coarse-grained |
| `requested`, `offered_to_carrier`, `accepted`, `driver_assigned`, `driver_en_route`, `pickup_completed`, `in_transit`, `delivered`, `confirmed_by_shipper`, `completed_rated`, `carrier_rejected`, `carrier_timed_out`, `driver_rejected`, `cancelled_by_shipper`, `cancelled_by_carrier`, `failed`, `disputed` | `borrador`, `esperando_match`, `emparejando`, `ofertas_enviadas`, `asignado`, `en_proceso`, `entregado`, `cancelado`, `expirado` |

### Por qué es Clase B (no Clase A)

- **No es alineación 1:1**: el TS state machine es fine-grained (17 estados); el SQL es coarse-grained (9 estados). Reemplazar TS valores con SQL valores **elimina información de estado** (e.g. `carrier_rejected` vs `driver_rejected` ambos colapsan a `cancelado`).
- **Consumers downstream esperan los 17 valores**: probablemente Wave 5 wake-word, eco-routing, coaching, etc. Refactor breaking.
- **Decisión arquitectónica pendiente**: ¿el dominio debe ser fine-grained y traducir en el boundary HTTP, o coarse-grained alineado con SQL?

### Decisión propuesta (ADR-049 a producir en T1.3 si confirma Clase B)

**Opción A** (recomendada): mantener TS fine-grained, agregar columna SQL `viajes.estado_detallado` con los 17 valores; `viajes.estado` queda como rollup coarse-grained de los 9. Esto es **Clase C** (migración SQL).

**Opción B**: TS reduce a 9 valores; consumers downstream se actualizan. Breaking changes en lógica de negocio. **Clase B** con flag + sunset largo (≥2 sprints).

**Opción C**: mantener TS fine-grained, NO alinear con SQL; documentar como **excepción permanente** al ADR-043. Domain decoupled del SQL para este enum específico.

### Sub-spec recomendada

Este caso solo merece su propia sub-spec `.specs/s1-drift-coverage-e2e/tripstate-alignment/spec.md` con análisis profundo, alternatives, decisión PO. Posiblemente se difiere a S2 o sprint dedicado.

## Recomendación SC-S1.0

Aunque el script reporta exit 0 (10 divergencias = en el borde), el caso 8 (tripState) es estructuralmente Clase B+ y merece su propia sub-spec. **Recomendación**:

1. **Resolver casos 5 (Clase A simple)** en T1.2a — agregar 2 valores SQL a `tripEventTypeSchema`.
2. **Validar manualmente los 4 falsos positivos heurísticos** (casos 2, 4, 6, 9, 10) en T1.2b — confirmar SQL equivalent + actualizar inventory.md.
3. **Diferir caso 8 (tripState)** a sub-spec dedicada `.specs/tripstate-alignment/`. Crear stub spec + plan en T1.2c. Implementación real en sprint dedicado (S1c o S2).
4. **PO decide gate**: dado el split del trabajo, ¿se cambia frontmatter a `APPROVED_BY_PO` ahora y se procede con T1.2a/b/c, o se pausa hasta resolver caso 8 completo?

## Acción PO

Revisar este análisis. Si OK con el plan (T1.2a/b/c arrancan, caso 8 se difiere a sub-spec separada), cambiar frontmatter de `inventory.md` a `gate: APPROVED_BY_PO 2026-05-18` + agregar línea en este doc confirmando la clasificación.

Sin firma PO, `inventory.md` mantiene `gate: PENDING_PO` y pre-commit hook bloquea commits `feat(domain)`.
