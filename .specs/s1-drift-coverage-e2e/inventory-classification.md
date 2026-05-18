# Drift inventory — Triage manual + clasificación (T1.1)

- Auto-generado: [`inventory.md`](./inventory.md)
- Sprint: S1a (drift schema/domain implementation)
- Cubre: SC-S1.1 (clasificación) + gate SC-S1.0
- Status: **Triaged 2026-05-18 por PO** — gate APPROVED_BY_PO

---

## Nomenclatura extendida (post-triage)

ADR-043 original define 3 clases (A/B/C). El triage T1.1 reveló necesidad de **4ta categoría: H = heurístico FP**.

| Clase | Descripción ADR-043 / extensión |
|---|---|
| **A** | TS-only refactor: cambio en `domain/*.ts`, sin migration SQL. PR ≤100 LOC. |
| **B** | Breaking API: requiere flag + doble-emit + sunset + ADR de excepción. |
| **C** | Cambio SQL: migration + ADR de excepción + down-migration testeada. |
| **H** | **Falso positivo heurístico** (nuevo, post-T1.1 triage): el script `drift-inventory.mjs` reportó divergencia pero **el SQL sí tiene equivalente** con naming distinto que el match heurístico no captura. Resolución: ajustar allowlist o mejorar `normalizeForMatch` (tracked en T1.0.heuristic-improvement, no bloqueante). |

> **Nota**: Clase H NO es modificación al ADR-043 — es categoría operacional propia del proceso de triage T1.1. Las migraciones reales que ejecuta T1.2-T1.4 siguen siendo A/B/C del ADR original. H casos NO requieren acción de refactor; solo ajustar el script (T1.0.heuristic-improvement).

---

## Triage detallado por caso

### Caso 1 — `cargoRequestStatusSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: `grep pgEnum.*(cargo|carga|request|solicitud)` retorna solo `cargoTypeEnum` (tipo_carga, no status). El "status" de un cargo request probablemente vive en columna `trips.status` o en `cargoRequests.status` como columna text directa (no pgEnum).
- **Clase**: **A** (legítimo) — schema TS no tiene equivalente pgEnum SQL; refactor TS-only si se decide alinear, o queda como TS-only legítimo.

### Caso 2 — `licenseClassSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: ✅ `licenciaClaseEnum` (`licencia_clase`) existe en `schema.ts`. Match real con naming distinto que el heurístico `licenseClass*` ↔ `licenciaClase*` no captura.
- **Clase**: **H** (falso positivo) — agregar match al script en T1.0.heuristic-improvement. Sin acción de refactor.

### Caso 3 — `telemetrySourceSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: ✅ 2 candidatos en SQL — `tripEventSourceEnum` (origen_evento_viaje) y `routeDataSourceEnum` (fuente_dato_ruta). Probable: `telemetrySourceSchema` representa la fuente del dato telemétrico (CAN bus / GPS / manual), match con uno de los dos.
- **Clase**: **H** — refinar match en script T1.0.heuristic-improvement.

### Caso 4 — `transportistaStatusSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: `empresaStatusEnum` (estado_empresa) existe; transportista es un tipo de empresa (membership), por lo que su status probablemente reusa el enum genérico de empresa.
- **Clase**: **H** (probable) — si transportista reusa `empresaStatusEnum`, agregar match. Si tiene status propio diferenciado, sería **A**. Validar en T1.0.heuristic-improvement.

### Caso 5 — `tripEventTypeSchema` (`value-mismatch`)

- **Heurístico reportó**: match con `tripEventTypeEnum` (tipo_evento_viaje), SQL tiene 2 valores extras: `conductor_asignado`, `incidente_reportado`.
- **Triage manual**: ✅ confirmado. SQL es source-of-truth (ADR-043 §1); domain TS está incompleto.
- **Clase**: **A** — agregar `conductor_asignado` y `incidente_reportado` a `tripEventTypeSchema`. PR ~30 LOC.

### Caso 6 — `nivelCertificacionSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: ✅ `certificationLevelEnum` (nivel_certificacion) existe. Match real con naming inglés↔español.
- **Clase**: **H** — agregar match en T1.0.heuristic-improvement.

### Caso 7 — `tripMetricsSourceSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: ✅ La columna `source` de `tripMetrics` (en tabla `metricas_viaje`) usa `tripEventSourceEnum`. Reuso de enum, no enum propio.
- **Clase**: **H** — agregar match (apunta al mismo enum que Caso 3).

### Caso 8 — `tripStateSchema` (`value-mismatch` CRÍTICO)

- **Heurístico reportó**: match con `tripStatusEnum`, 17 valores TS vs 9 SQL, mapeo no 1:1.
- **Triage manual**: ✅ caso real, NO falso positivo. Requiere decisión arquitectónica (mantener TS fine-grained con boundary translation vs reducir TS a 9 estados vs columna SQL extendida).
- **Clase**: **B+** — **DIFERIDO** a sub-spec dedicada `.specs/tripstate-alignment/` que se crea cuando arranque T1.x específico. **No bloquea S1a**.

### Caso 9 — `roleSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: ✅ 2 candidatos: `membershipRoleEnum` (rol_membresia) y `chatSenderRoleEnum` (rol_remitente_chat). El match depende del contexto del schema TS.
- **Clase**: **H** — agregar match en T1.0.heuristic-improvement (probablemente match con `membershipRoleEnum`).

### Caso 10 — `zonaStakeholderTipoSchema` (`no-sql-match`)

- **Heurístico reportó**: sin match.
- **Triage manual**: `zoneTypeEnum` (tipo_zona) existe pero es genérico (`recogida`, `entrega`, `ambos`). Zonas de stakeholder pueden tener tipos distintos (zona industrial, comercial, rural, etc.) o ser un subset de zonas generales. **Requiere verificación adicional en el contenido del Zod schema**.
- **Clase**: **A** (probable, legítimo TS-only) — pendiente confirmación durante T1.2.

---

## Resumen baseline post-triage

| Clase | Conteo | Casos |
|---|---|---|
| **A (real, requiere refactor)** | 2-3 | 5 ✅ confirmado, 1 y 10 (probable) |
| **B+ (diferido)** | 1 | 8 — sub-spec dedicada futura |
| **C (cambio SQL)** | 0 | — |
| **H (heurístico FP)** | 5-6 | 2, 3, 4, 6, 7, 9 |
| **Total divergencias reales (A+B+C)** | **3-4** | (vs 10 reportadas por heurístico) |

**Gate SC-S1.0**: 3-4 divergencias estructurales reales << threshold 10. **Gate APPROVED_BY_PO**.

---

## Acciones derivadas (no bloqueantes)

1. **T1.0.heuristic-improvement** (no bloqueante, paralelo a T1.2+): mejorar `normalizeForMatch` en `drift-inventory.mjs` para reconocer:
   - `licenseClass` ↔ `licenciaClase`
   - `nivelCertificacion` ↔ `certificationLevel`
   - `telemetrySource` ↔ `tripEventSource` (o `routeDataSource`)
   - `role` ↔ `membershipRole` / `chatSenderRole`
   - `transportistaStatus` ↔ `empresaStatus`

   Re-correr script post-mejora debería reducir false positives a 0.

2. **Sub-spec `tripstate-alignment`**: se crea cuando arranque T1.x dedicado (sprint posterior). En este sprint S1a, mención en `followup-state-machine-migration.md` como pendiente arquitectónico.

3. **T1.2 arranca** con Caso 5 (Clase A confirmada) + verificar Casos 1 y 10 (probables Clase A legítima).

---

## Decision log

- **2026-05-18 ~10:30 UTC** — Triage manual completo. Baseline real post-triage: 3-4 divergencias estructurales (vs 10 reportadas). Caso 8 diferido a sub-spec futura. 5-6 falsos positivos del heurístico → T1.0.heuristic-improvement no bloqueante. **Gate SC-S1.0 APPROVED_BY_PO**.
