---
gate: APPROVED_BY_PO 2026-05-18
triaged_at: 2026-05-18T14:45:00Z
divergences_post_triage_real: 2 (Clase A) + 1 diferido (Clase B+, caso 8 tripState)
heuristic_false_positives: 6 (Clase H — casos 2, 3, 4, 6, 7, 9, 10)
---

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

---

## S1a — Outcomes

> Sección de cierre del Sprint S1a. Producida durante T1.S1a.cierre ([`s1a-cierre.md`](./s1a-cierre.md)) post-T1.5. Captura el **valor cualitativo** del sprint, complementaria a la tabla cuantitativa de `s1a-cierre.md`.

### 1. Counts finales por clase (post-T1.5)

| Clase | Conteo | Casos | Disposición |
|---|---|---|---|
| **A** (refactor TS-only) | 1 | Caso 5 (`tripEventTypeSchema`) | Resuelta T1.2 ([#294](https://github.com/boosterchile/booster-ai/pull/294)) |
| **I** (Intentional pre-materialization) | 1 | Caso 1 (`cargoRequestStatusSchema`) | Annotada T1.3 ([#296](https://github.com/boosterchile/booster-ai/pull/296)) |
| **B+** (diferida a sub-spec) | 1 | Caso 8 (`tripStateSchema`) | Diferida a `.specs/tripstate-alignment/` (cuando arranque T1.x dedicado) |
| **C** (SQL migration) | 0 | — | — |
| **H** (heurístico FP) | 6 | Casos 2, 3, 4, 6, 7, 9, 10 | T1.0.heuristic-improvement (no bloqueante) |

**Total**: 9 casos clasificados (de 10 reportados; 1 collapsa en H tras triage).
**Drift estructural accionable post-S1a**: **0**.

### 2. Observación meta — qué fue el valor real del sprint

El **deliverable durable** de S1a NO es la alineación de 2 valores enum del Caso 5 (acción mecánica de ~5 LOC en `trip-event.ts`). El deliverable durable es:

1. **Metodología ADR-043 ejecutada end-to-end**: discovery → triage → clasificación → resolución → integration test. Esa secuencia es replicable contra cualquier divergencia futura sin re-inventar el proceso.
2. **Tooling perm**: `scripts/repo-checks/drift-inventory.mjs` + pre-commit hook bloquean drift inadvertido en commits futuros. Coverage 97/91/100/97. Re-ejecutable cuando aparezca nuevo schema.
3. **Taxonomía extendida**: Clases H + I emergieron del triage real, no del ADR original. Son categorías **operacionales del proyecto Booster AI**, no del ADR genérico. Permiten que el siguiente triage no confunda FPs heurísticos con drift real ni elimine scaffolding deliberado.

**Implicación práctica**: si el próximo schema Zod aparece sin counterpart SQL, el agente NO pregunta "¿hay que eliminarlo?" — corre el script, ve la Clase (H/A/I), aplica el playbook documentado.

### 3. Anécdota `trackingCode varchar(12)` — por qué integration tests > theater

Durante implementación de T1.5, el primer intento de helper `createMinimalTrip()` usó:

```typescript
trackingCode: `T15-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
```

Resultado: Postgres rechazó con error 22001 (string too long). El campo es `varchar(12)`, el string generado tenía ≥20 chars.

**Por qué importa**: si T1.5 hubiera sido puramente **declarativo** (script + hook re-validation post-T1.2), este bug NUNCA habría salido a luz — porque el constraint vive en SQL, no en TS schemas. El integration test ejerció el code path real (INSERT contra Postgres) y el constraint se activó.

**Conclusión**: tests declarativos validan la **intención** del autor; integration tests validan la **realidad** del sistema. ADR-043 §4 patterns son específicos sobre esta distinción — Pattern A no es "imprimí el schema y comparalo con el SQL"; es "INSERT + SELECT real, asegurate de que el valor sobrevive el round-trip".

Fix aplicado en T1.5: `trackingCode: \`T15${Math.random().toString(36).slice(2, 11).toUpperCase()}\`` (exactamente 12 chars).

### 4. Hallazgo H-S1a-1 — scope cubierto vs backlog explícito

Spec §12.5 documenta el hallazgo. Post-T1.5:

- **Primera mitad cubierta** (code path runtime ejercitado): integration test confirma que los 2 valores enum agregados en T1.2 pasan por Drizzle ORM y vuelven con identidad exacta. La alineación TS↔SQL es funcional end-to-end, no solo declarativa.
- **Segunda mitad pendiente** (boundary parsing): `apps/api/src/routes/*.ts` aún NO instala `tripEventTypeSchema.parse()` en boundaries HTTP. Idem `DB writers` y `queue consumers` Pub/Sub.

**Decisión de scope**: la segunda mitad NO es una omisión accidental. Es trabajo de S2/S3 con scope dedicado (auditoría boundaries → política `.parse()` vs `.safeParse()` → instrumentación + tests por boundary). T1.5 nunca pretendió cubrirla — su alcance fue verificar que la mitad declarativa de S1a no es theater.

**Trazabilidad futura**: `git log --grep="H-S1a-1"` retorna los commits específicos cuando el planner de S2/S3 quiera contexto sin abrir spec.md.

### 5. Caso 8 (tripStateSchema) — clarificación post devils-advocate

El cierre v1 caracterizó Caso 8 como "foundational blocker" del Bloque B (XState scaffold). **Eso era incorrecto**: spec §SC-S1.5 (línea 43) ya nombra los 5 canonical states de la machine (`borrador, asignado, en_curso, entregado, cancelado`) anclados a `tripStatusEnum`. El scaffold puede ejecutar contra esos 5 estados hoy.

Lo que Caso 8 representa realmente es un problema de **boundary translation**: cómo mapear el `tripStateSchema` TS extendido (17 valores) al subset canónico de la machine (5 valores) y al `tripStatusEnum` SQL (9 valores). Es trabajo paralelo a T1.6, no precondición.

Sub-spec `.specs/tripstate-alignment/` (pendiente, **pre-requisito de Bloque B** — avance gated por readiness no calendario) decide:
- ¿Los 17 valores TS son superset legítimo (e.g. estados intermedios solo en UI)?
- ¿Los 9 SQL son la verdad operacional + 5 canonical son los de máquina?
- ¿Boundary translators dónde viven (route handlers? service layer?)?

### 6. Estado post-cierre

- **Inventario script + hook**: vivos, bloquean nuevos commits drift.
- **Taxonomía H + I**: codificada acá. Próximo triage la consulta sin re-derivarla.
- **0 drift estructural accionable**: sostenible mientras nuevos schemas pasen por el flow ADR-043.
- **Follow-ups tracked**: T1.0.heuristic-improvement, T1.x.parser, sub-spec `tripstate-alignment` (pre-requisito de Bloque B), H-S1a-1 segunda mitad — todos con sprint objetivo + ubicación de tracking.
