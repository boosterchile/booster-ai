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

### Caso 1 — `cargoRequestStatusSchema` (`no-sql-match`) — CERRADO

- **Heurístico reportó**: sin match.
- **Triage profundo** (`rg cargoRequest --type ts apps/ packages/`):
  - **0 consumers en `apps/`** (todo el código).
  - **0 tabla SQL** `cargo_requests`, **0 pgEnum** cargoRequest*.
  - Referencias: solo `domain/cargo-request.ts` (definición), `primitives/ids.ts` (`cargoRequestIdSchema`), `all-schemas.test.ts` (smoke test), y comentario en `trip-request.ts` que dice _"esto NO es un cargoRequest completo… matching tentativo produce cargoRequest real"_.
  - Veredicto: schema TS-only **orphan** — el dominio define el concepto pero **nunca se materializó** en SQL ni en código. Diseño legacy abandonado (trips fueron el modelo dominante).
- **Clase**: **A — sub-tipo "TS-only-orphan"**. Acción T1.2: investigar abandono y decidir entre:
  - (a) Eliminar `cargoRequestStatusSchema` + `cargoRequestSchema` completo del domain (PR de cleanup).
  - (b) Mantener como "concepto TS-future documentado" si hay roadmap futuro para cargo_requests separados de trips.

  Recomendación pre-T1.2: **(a) eliminar** — 24 días de historia del proyecto sin uso real sugiere abandono claro.

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

### Caso 10 — `zonaStakeholderTipoSchema` (`no-sql-match`) — CERRADO

- **Heurístico reportó**: sin match.
- **Triage profundo** (`rg tipoZonaStakeholderEnum apps/api/src/db/schema.ts`):
  - ✅ `tipoZonaStakeholderEnum` (`tipo_zona_stakeholder`) EXISTE en SQL.
  - **Mismos 4 valores exactos** en ambos lados: `puerto`, `mercado_abastos`, `polo_industrial`, `zona_franca`.
  - Heurístico `normalizeForMatch` falló porque SQL ts-name empieza con `tipo` (`tipoZonaStakeholderEnum`) en lugar de terminar con `Enum` precedido del concept name (`zonaStakeholderTipoEnum`). El stemming `tipo...Stakeholder...` ↔ `zonaStakeholder...Tipo` no es captado.
- **Clase**: **H** (falso positivo del heurístico) — match perfecto en SQL. Agregar mapping en T1.0.heuristic-improvement.

---

## Resumen baseline post-triage (CERRADO sin rangos)

| Clase | Conteo | Casos |
|---|---|---|
| **A (real, requiere refactor)** | **2** | **5** (agregar 2 valores SQL faltantes) + **1** (TS-only-orphan, eliminar) |
| **B+ (diferido)** | **1** | **8** — sub-spec dedicada futura |
| **C (cambio SQL)** | **0** | — |
| **H (heurístico FP)** | **6** | **2, 3, 4, 6, 7, 9, 10** (7 casos; verificar que `transportistaStatus` reusa empresaStatusEnum durante T1.0.heuristic-improvement → si no, sería A) |
| **Total divergencias estructurales reales (A+B+C)** | **3** | vs 10 reportadas por heurístico |

**Gate SC-S1.0**: 3 divergencias estructurales reales (2 A + 1 B+ diferido) << threshold 10. **Gate APPROVED_BY_PO 2026-05-18**.

> **Nota sobre Caso 4** (`transportistaStatus`): clasificado **H probable** pero sujeto a verificación durante T1.0.heuristic-improvement. Si el schema `transportistaStatusSchema` reusa los mismos valores que `empresaStatusEnum`, es H confirmado. Si tiene valores propios diferenciados, se reclasifica a A en ese PR (no bloquea S1a — el ajuste a la baseline ocurre en T1.0.heuristic-improvement post-merge).

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
