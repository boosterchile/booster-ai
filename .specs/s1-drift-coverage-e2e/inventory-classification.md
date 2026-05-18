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
| **I** | **Intentional pre-materialization** (nuevo, post-T1.3 discovery): schema TS existe **deliberadamente antes** de su contraparte SQL, con **dependencias estructurales documentadas** (ADRs, skills, FKs activas desde otros schemas). No es drift accidental, no es FP heurístico, no es decisión arquitectónica pendiente — es **scaffolding deliberado del roadmap**. Anotación obligatoria en código vía tag `@drift-status intentional-pre-materialization` + campos `@materialization-trigger`, `@depends-on`, `@review-on` para que sea machine-readable. Resolución: drift-inventory script ignora schemas con la tag (tracked en T1.x.parser, no bloqueante). |

> **Nota sobre Clases H + I**: NO son modificaciones al ADR-043 — son **categorías operacionales** propias del proceso de triage de Booster AI. Las migraciones reales que ejecuta T1.2-T1.n siguen siendo A/B/C del ADR original. H/I NO requieren acción de refactor; solo ajustar el script (T1.0.heuristic-improvement para H; T1.x.parser para I).
>
> **Distintivos entre Clases**:
> - **A vs I**: A requiere alinear TS con SQL (acción); I requiere DOCUMENTAR que TS existe antes que SQL deliberadamente (anotación + dependencias).
> - **H vs I**: H es bug del heurístico (SQL existe pero el script no lo encontró); I es realidad estructural (SQL no existe todavía pero hay roadmap documentado).
> - **B+ vs I**: B+ (caso 8 tripState) es decisión arquitectónica pendiente con análisis abierto; I es decisión ya tomada (el roadmap está en ADRs vivos) — solo falta la materialización del SQL.

---

## Triage detallado por caso

### Caso 1 — `cargoRequestStatusSchema` (`no-sql-match`) — RECLASIFICADO POST-DISCOVERY T1.3

- **Heurístico reportó**: sin match.
- **Triage profundo inicial T1.1** (`rg cargoRequest --type ts apps/ packages/`): 0 consumers en `apps/`, 0 tabla SQL, 0 pgEnum cargoRequest*. **Diagnóstico inicial T1.1 (errado)**: schema TS-only orphan, acción = eliminar.
- **Discovery exhaustivo T1.3** (8 puntos del checklist PO, `.specs/s1-drift-coverage-e2e/t1.3-discovery.md`):
  - `cargoRequestIdSchema` **YA es FK estructural** en `tripSchema.cargo_request_id` (concepto integrado al dominio Trip canónico vigente).
  - **4 ADRs vivos + 1 skill core** describen `CargoRequest` como concepto del producto:
    - ADR-006 (WhatsApp NLU): criterio acceptance _"CargoRequest válido desde conversación de 4-6 turnos"_.
    - ADR-008 (PWA multirol): `NewCargoRequest.tsx` route planificada.
    - ADR-010 (marketing+commerce): onboarding wizard _"Crea tu primera carga"_.
    - skill `empty-leg-matching`: `cargoRequest: CargoRequest` input central del algoritmo.
  - Comentario en `trip-request.ts` que parecía concept-orphan = **roadmap explícito del Slice 2** del flujo WhatsApp NLU.
- **Clase post-T1.3**: **I — Intentional pre-materialization** (categoría nueva, ver §Nomenclatura).

**Acción T1.3 aplicada (Opción C firmada PO)**:
1. Annotación machine-readable en `domain/cargo-request.ts` con `@drift-status intentional-pre-materialization` + `@materialization-trigger` + `@depends-on` + `@review-on`.
2. Esta entrada reclasificada como **instancia de Clase I**, no de Clase A.
3. Schema **NO se elimina** — se mantiene como scaffolding deliberado.
4. **Follow-up no bloqueante**: T1.x.parser en `plan-s1a.md` agregará parsing de `@drift-status` al drift-inventory script para que ignore automáticamente schemas Clase I anotados.

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

## Resumen baseline post-triage (CERRADO sin rangos) — UPDATED post-T1.3

| Clase | Conteo | Casos |
|---|---|---|
| **A (real, requiere refactor)** | **1** | **5** (agregar 2 valores SQL faltantes) — DONE en T1.2 |
| **I (Intentional pre-materialization)** | **1** | **1** (`cargoRequestStatusSchema` — annotada en T1.3) |
| **B+ (diferido a sub-spec)** | **1** | **8** (`tripStateSchema` — sub-spec dedicada futura) |
| **C (cambio SQL)** | **0** | — |
| **H (heurístico FP)** | **6** | **2, 3, 4, 6, 7, 9, 10** (7 casos; verificar que `transportistaStatus` reusa empresaStatusEnum durante T1.0.heuristic-improvement → si no, sería A) |
| **Total divergencias estructurales reales (A+B+C)** | **2** | vs 10 reportadas por heurístico (post-T1.3: 1 A resuelta + 1 I anotada + 1 B+ diferida = 0 drift estructural accionable en S1a) |

**Gate SC-S1.0**: APPROVED_BY_PO 2026-05-18. Baseline final post-T1.2+T1.3: **0 drift estructural accionable** en S1a (Case 5 ya alineado, Case 1 reclasificado como Clase I + annotación machine-readable, Case 8 diferido a sub-spec dedicada).

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
- **2026-05-18 ~11:30 UTC** — Triage profundo Casos 1 y 10. Caso 10 → Clase H confirmada (`tipoZonaStakeholderEnum` existe). Caso 1 → "Clase A sub-tipo TS-only-orphan" tentativa. Baseline intermedio: 2 A + 1 B+ + 0 C + 6 H = 3 estructurales.
- **2026-05-18 ~14:00 UTC** — Discovery broader pre-T1.3 (8 puntos del checklist PO). Hallazgo decisivo: `cargoRequestIdSchema` es FK estructural en `trip.cargo_request_id` + 4 ADRs vivos + 1 skill core describen `CargoRequest` como concepto del producto vigente. Caso 1 NO es orphan abandonado.
- **2026-05-18 ~15:00 UTC** — PO firma **Opción C con 3 refinamientos**: (a) crear Clase I como categoría taxonómica nueva (no docstring libre), (b) annotación machine-readable con tags `@drift-status` `@materialization-trigger` `@depends-on` `@review-on`, (c) ampliar taxonomía en este doc paralelo a Clase H. Plus follow-up no bloqueante: T1.x.parser para drift-inventory parsing del tag.
- **2026-05-18 ~15:30 UTC** — T1.3 implementado: Clase I agregada al §Nomenclatura; Caso 1 reclasificado de A-orphan a I-pre-materialization; `domain/cargo-request.ts` recibe annotación estructurada; baseline final post-T1.2+T1.3: **0 drift estructural accionable en S1a** (1 A resuelta + 1 I anotada + 1 B+ diferida).
