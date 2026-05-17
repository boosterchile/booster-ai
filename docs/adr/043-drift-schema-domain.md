# ADR-043 — Drift schema ↔ domain: metodología de alineación

**Fecha**: 2026-05-17
**Estado**: Accepted
**Refs**:
- `docs/handoff/CURRENT.md` §c (drift documentado: `domain/trip.ts` en inglés vs `db/schema.ts` en español)
- ADR-042 §4 ("Alineación schema/domain — `tripStatus` y `pickupAt`") — alineación caso-específico para D11
- ADR-001 (stack selection — type safety end-to-end declarado como principio)
- ADR-044 (migration journal integrity guard — gemelo en materia de "drift latente que pasó 4 días invisible")
- `.specs/production-readiness/spec.md` SC-4
- `.specs/s0-housekeeping/spec.md` SC-S0.1 + `plan.md` T1
- CLAUDE.md §"Reglas de naming bilingüe" + §"Type safety end-to-end"

## Contexto

Booster AI tiene dos fuentes de verdad estructurales para tipos de dominio:

1. **`apps/api/src/db/schema.ts`** — schema canónico SQL declarado en Drizzle. Identifiers SQL en **español snake_case** (regla CLAUDE.md "naming bilingüe"). 35 tablas, 38 migraciones aplicadas en prod. Valores de enums en español sin tildes (`'entregado'`, `'asignado'`, `'borrador'`, etc.).
2. **`packages/shared-schemas/src/domain/`** — schemas Zod del dominio canónico para reuse cross-package y validación de boundaries. Históricamente, parte del código se escribió con identifiers en inglés (`tripStatus = 'delivered'`, `pickupAt`, etc.), antes de la regla de naming bilingüe.

El drift entre ambas fuentes apareció primero en el BUILD autónomo de D11 (commits `bf6770e..117ad37`, 2026-05-17) cuando T8 falló por inconsistencias entre `tripStateEnum` esperado por el agente (valores en inglés) y `tripStatusEnum` real en `db/schema.ts` (valores en español); idem para `pickupAt` vs `pickupWindowStart`. ADR-042 §4 resolvió **el caso específico de trip status + pickup window** alineando el domain al SQL canónico.

Sin embargo, ADR-042 §4 no estableció una **política general**: hay otras tablas/columnas/enums potencialmente afectados (`tripEvents`, `assignments`, `offers`, `metricasViaje`, `dispositivosTelemetria`, etc.) y, sin metodología explícita, cada nuevo drift se resolvería ad-hoc con la posibilidad de inconsistencias entre ADRs.

CLAUDE.md §1 fija "cero deuda técnica desde day 0" y §"Type safety end-to-end" exige "**no hay frontera donde los tipos se pierdan**". Drift schema↔domain es exactamente esa frontera: el dominio Zod ya no es la fuente verdadera cuando diverge del SQL aplicado.

Este ADR establece la **metodología** para detectar, decidir y aplicar la alineación general. La **ejecución del inventario detallado de divergencias y las migraciones específicas son deliverables de S1** (sprint siguiente en `.specs/production-readiness/roadmap.md`).

## Decisión

### 1. Dirección de alineación: SQL es canónico, domain alinea

Ratificamos como **política general** lo que ADR-042 §4 estableció caso-específico:

> El `apps/api/src/db/schema.ts` (Drizzle, español snake_case) es la **fuente de verdad** para identifiers y valores de enums. `packages/shared-schemas/src/domain/*` se alinea al SQL, no al revés.

**Razones (rendondan ADR-042 §4 con perspectiva general)**:

- **Costo de cambiar el SQL**: 38 migraciones aplicadas en prod con data viva en valores español. Renombrar columns o enum values requiere `UPDATE` masivo, downtime estimado, riesgo de inconsistencia transitoria. Cambiar TypeScript no toca data.
- **Coherencia con CLAUDE.md**: regla bilingüe explícita "TypeScript code: identifiers en inglés camelCase" se vuelve más débil que "SQL DDL: tablas y columnas en español snake_case sin tildes" cuando hay conflicto — porque SQL DDL ya es source-of-truth aplicado en prod, mientras los identifiers TS son maleables hasta el próximo deploy.
- **UI y API responses**: hablan español al usuario final chileno. Los enum values cruzan la frontera de API y aparecen en logs operativos. Mantenerlos en español elimina una traducción adicional en el boundary.
- **Espíritu naming bilingüe**: la regla admite excepciones documentadas. Esto se documenta acá.

### 2. Metodología de inventario (deliverable S1)

S1 producirá el inventario completo de divergencias usando este procedimiento:

1. **Detección automatizada**:
   ```bash
   # Identificar exports en domain con valores literales en inglés
   grep -rE "= '(delivered|confirmed|completed|pending|active|cancelled|...)'" packages/shared-schemas/src/domain/
   # Identificar identifiers TS en camelCase inglés que mapean a columns SQL espanol
   grep -rE "(\w+)Status|(\w+)At\b|(\w+)Count\b" packages/shared-schemas/src/domain/
   ```
2. **Cross-check contra schema.ts**: para cada divergencia detectada, leer la definición SQL en `apps/api/src/db/schema.ts` y registrar (campo TS, campo SQL, tipo de divergencia: nombre / valor enum / tipo).
3. **Clasificación por costo de migración**:
   - **Clase A** (cambio TS-only, sin breaking API): renombrar identifier TS o ajustar valor enum del domain Zod. Sin migration SQL.
   - **Clase B** (breaking API en responses): el valor cruza la frontera HTTP y consumers externos pueden depender. Requiere feature flag + período de doble-emit + sunset documentado.
   - **Clase C** (requiere migration SQL inesperado): la divergencia revela un SQL históricamente mal nombrado que aceptamos cambiar (raro; necesita ADR de excepción).

### 3. Estrategia de migración por clase

- **Clase A**: PR único con cambio domain + búsqueda y reemplazo en consumers + tests. Sin migration, sin flag. Acceptance: `pnpm typecheck` + `pnpm test` verdes.
- **Clase B**: PR con (a) nuevo campo añadido al schema Zod alineado a SQL, (b) feature flag `DOMAIN_ALIGNMENT_<X>_ACTIVATED=false`, (c) endpoint responde **ambos** valores en período de transición, (d) sunset documentado en CHANGELOG con fecha objetivo (≤2 sprints post-merge), (e) tras sunset, PR de cleanup que elimina el campo viejo. Cada Clase B requiere su propio ADR de excepción.
- **Clase C**: requiere ADR explícito argumentando por qué el nombre SQL actual no se sostiene. Migration con backfill + rollback testeado.

### 4. Test list patterns para S1 (mínimo 3 tests)

S1 producirá tests integration sobre la infra `vitest.integration.config.ts` ya mergeada (PR #271/#272). Los patterns mínimos:

1. **Pattern A — round-trip de enum value**: para cada enum afectado (post-alineación), test integration que: (a) inserta una row con el valor SQL canónico, (b) lee el dominio Zod desde el código de servicio, (c) verifica que el valor leído es el mismo string. Sin transformaciones de string en boundary.
2. **Pattern B — identifier match en read query**: para cada column afectado (post-alineación), test que ejerce un endpoint que lee la column y verifica que el campo del response coincide con el identifier domain (camelCase TS sobre el identifier SQL snake_case — esto ya lo hace Drizzle automáticamente, el test prueba que no hubo regresión).
3. **Pattern C — feature flag durante transición Clase B**: para cada migration Clase B, test que verifica el doble-emit: con flag OFF, el endpoint responde solo valor viejo; con flag ON, responde ambos; tras sunset, solo nuevo.

Cantidad concreta de tests = depende del inventario S1. **Mínimo 3 tests cubriendo los 3 patterns** incluso si solo hay 1 divergencia Clase A (los patterns son la guía, no la cantidad).

### 5. Gate de feature flag para migraciones breaking

Toda migración Clase B activa requiere flag explícito siguiendo el patrón ya existente (`AUTH_UNIVERSAL_V1_ACTIVATED`, `WAKE_WORD_VOICE_ACTIVATED`, etc.) declarado en `apps/api/src/config.ts` con `booleanFlag(defaultValue)`. Default `false` en development, `true` solo tras período de transición + sunset.

## Consecuencias

### Positivas

- **Política única**: el agente o cualquier dev futuro tiene metodología documentada para resolver cualquier nuevo drift sin re-litigar la dirección de alineación.
- **Costo de migración mínimo en mayoría de casos**: la mayor parte de las divergencias son Clase A (TS-only); cero riesgo en prod.
- **Trazabilidad**: Clase B requiere ADR + flag + sunset documentado; la decisión queda en repo.
- **Test patterns establecidos**: S1 no parte de cero. Los integration tests sobre infra T1+T2 son el medio.

### Negativas

- **El domain Zod queda en español** para identifiers que provienen del SQL (`pickupWindowStart` se vuelve un identifier TS válido que no respeta la regla "camelCase inglés" de CLAUDE.md). Excepción documentada acá: la regla bilingüe cede ante la prioridad SQL-canónico cuando el campo es directamente mapeable a una column SQL.
- **Costo de migración Clase B**: cuando aparezca, requiere coordinación de 2 PRs (introducción + sunset) y ≥2 sprints. No es gratis. Pero el riesgo de no hacerlo (clientes externos consumiendo valores que cambian sin aviso) es peor.

### No mitigadas (out of scope ADR-043)

- **Drift entre `packages/shared-schemas/src/domain/*` y consumers que duplican tipos**: si algún consumer ignora el domain y define sus propios tipos paralelos, este ADR no lo detecta. Auditable manualmente en S1 si surge.
- **Drift entre Zod schemas declarados en `apps/web/`** (frontend) y los del domain canónico: en teoría el frontend debe importar del package; si redefine localmente, surface gap. No se trata acá.

## Alternativas consideradas

### A. Domain canónico (en inglés), SQL alinea — RECHAZADA

Era la dirección "intuitiva" para developers anglo. Rechazada por:
- Costo de migración prohibitivo: `UPDATE` masivo de enum values en 38 migraciones + downtime + riesgo.
- Conflicto con regla bilingüe ya escrita en CLAUDE.md (que reserva inglés para identifiers de código, español para SQL).
- ADR-042 ya estableció precedente caso-específico contrario. Cambiar dirección crearía inconsistencia entre ADRs.

### B. Coexistencia bilingüe con boundary explícito — RECHAZADA

Cada valor SQL se traduce a valor TS en español-a-inglés en el boundary (servicios). Rechazada por:
- Crea una capa de mapeo adicional en cada read/write. Cada cambio de SQL requiere actualizar el mapper.
- Cuando una traducción falla silenciosamente (typo en mapper), produce bugs que solo se detectan en runtime con datos específicos.
- Viola el principio CLAUDE.md "no hay frontera donde los tipos se pierdan" — el boundary del mapper ES esa frontera.

### C. Enumerar todas las divergencias en este ADR — RECHAZADA

La spec S0 explícitamente (SC-S0.1 v2) acotó este ADR a metodología, no enumeración. Razón: el inventario requiere lectura sistemática de código que es deliverable medible de S1; mezclar metodología con inventario diluiría ambos.

## Validación

- [ ] S1 produce inventario completo de divergencias en `.specs/s1-drift-fix/plan.md` (o equivalente) clasificadas A/B/C.
- [ ] S1 produce ≥3 integration tests cubriendo los 3 patterns (§4).
- [ ] Cada divergencia Clase B tiene su propio ADR de excepción + flag declarado en `apps/api/src/config.ts`.
- [ ] `pnpm typecheck` verde post-S1 (no debe haber `any` introducido por el refactor).
- [ ] `pnpm test --filter @booster-ai/api` verde post-S1 con tests integration corriendo contra Postgres real.
- [ ] CURRENT.md §c (drift) marcado como "Resuelto en S1 — ADR-043 metodología + ADR-XXX excepciones Clase B si las hubo".
