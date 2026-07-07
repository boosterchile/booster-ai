# ADR-073 — Tipologías de flota (motriz/arrastre/carrocería) y clase GLEC derivada de la configuración

**Estado**: Accepted
**Fecha**: 2026-07-06
**Decider**: Felipe Vicencio (Product Owner)
**Related**: `.specs/hito-2-corfo-mes-8/decisiones.md` (D1, D4 — vinculantes), `.specs/hito-2-corfo-mes-8/w4-contexto.md`, `.specs/_followups/flota-bitren-0-n-arrastres.md`, [ADR-021](./021-glec-v3-compliance.md) (GLEC v3.0 en carbon-calculator), [ADR-066](./066-db-migration-rollback-strategy.md) (expand/contract), [ADR-044](./044-migration-journal-integrity-guard.md) (journal guard), `apps/api/drizzle/0048_tipologias_flota.sql`

---

## Contexto

Booster modela hoy un "vehículo" como una unidad plana: `vehiculos.tipo_vehiculo` (enum de 9 valores: camioneta, furgon_pequeno/mediano, camion_pequeno/mediano/pesado, semi_remolque, refrigerado, tanque). Este modelo no distingue entre:

- **Unidad motriz** (tiene motor propio: camioneta, furgón, camión rígido, tracto camión) y **unidad de arrastre** (remolcada, sin motor: semirremolque, remolque).
- **Carrocería** (plano, cortina, furgón cerrado, refrigerado, tolva, cisterna, portacontenedor, cama baja, jaula, forestal), que hoy vive mezclada dentro del tipo (`refrigerado`, `tanque` son en realidad carrocerías montadas sobre un chasís, no "tipos de vehículo" ortogonales).
- **Configuración de viaje**: qué unidad motriz + qué unidad de arrastre (si hay) están efectivamente enganchadas en un servicio. Un tracto sin semirremolque no puede cargar nada (`capacity_kg` positivo bloquea esto hoy); un semirremolque sin tracto no es un vehículo operable.

Esto bloquea al piloto (mes 8, hito CORFO): transportistas reales operan combinaciones tracto+semirremolque y rígido+remolque, y la clase GLEC (LDV/MDV/HDV, que calibra el factor de corrección por carga α — GLEC Framework v3.0 §6.3, ver ADR-021) debe derivarse de la **configuración articulada**, no del tipo de vehículo suelto: un tracto liviano con un semirremolque sigue siendo un articulado pesado (HDV) a efectos de consumo/manejo, no un LDV.

El hallazgo estructural de `w4-contexto.md` corrigió además un error de atribución del plan original: el vehículo de un servicio vive en `asignaciones.vehiculo_id` (`assignments`, 1:1 con `viajes` vía `viaje_id` UNIQUE), no en `viajes`. La FK de la unidad de arrastre debía seguir esa misma tabla, no `viajes`.

## Decisión

Se generaliza el modelo de flota con **4 piezas ortogonales**, aprobadas por el PO en dos rondas (D1: Opción A + 4 condiciones; D4: DDL final con 5 condiciones adicionales — ver `.specs/hito-2-corfo-mes-8/decisiones.md`).

### 1. Taxonomía

```
categoria_unidad ∈ {motriz, arrastre}                      -- D1
tipo_unidad      ∈ {tracto_camion, camion_rigido, camioneta, -- D4
                     furgon, semirremolque, remolque}
tipo_carroceria  ∈ {plano, cortina, furgon_cerrado,          -- D4
                     refrigerado, tolva, cisterna,
                     portacontenedor, cama_baja, jaula,
                     forestal}
```

`tipo_unidad` y `tipo_carroceria` son **ortogonales**: un `camion_rigido` puede tener carrocería `refrigerado`, `tolva`, `plano`, etc. `categoria_unidad` es una función determinista de `tipo_unidad` (motriz ⟺ tipo_unidad ∉ {semirremolque, remolque}), pero se persiste como columna independiente (no generada) porque así lo aprobó el DDL D4 y porque permite que el CHECK sea legible y auditable en `psql` sin depender de lógica aplicativa.

El enum legacy `tipo_vehiculo` (9 valores) **NO se toca**: sigue NOT NULL, sigue siendo la fuente de verdad para `packages/matching-algorithm`, `apps/api/src/routes/cargo-request.ts` (`required_vehicle_type`) y `apps/api/src/services/seed-demo.ts`. Ninguno de esos consumidores fue modificado en esta tarea — quedan explícitamente fuera de alcance (ver §Alcance).

### 2. Configuración de viaje: motriz + 0..1 arrastre

`asignaciones.unidad_arrastre_id` (FK nullable a `vehiculos`, `ON DELETE RESTRICT`) representa la unidad de arrastre efectivamente enganchada en esa asignación. **Corrección D4 vs el plan original**: vive en `asignaciones` (junto a `vehiculo_id`, que ya representa la unidad motriz del servicio), no en `viajes` — el vehículo del servicio nunca vivió en `viajes`.

**Cardinalidad 0..1, no 0..N**: Chile permite bitrenes (1 tracto + 2 semirremolques) bajo permiso especial en corredores autorizados (D.S. N°158/1980 MOP y resoluciones asociadas — ver §Fuentes normativas). El parque objetivo del piloto (mes 8) no opera bitrenes. Se acepta 0..1 como **deuda explícita** (condición D1.1), con plan de pago declarado en `.specs/_followups/flota-bitren-0-n-arrastres.md` (commit `cd73e95`): tabla puente `viaje_unidades_arrastre` con `UNIQUE(viaje_id, posicion)` y guard `N≤2` tras flag `BITREN_ENABLED`, migrando `unidad_arrastre_id` a `posicion=1` (expand/contract).

### 3. Semántica por categoría (D1.2 + D4.5) — Zod, no solo CHECK

La BD solo puede expresar con un CHECK simple la coherencia tipo↔categoría (`chk_vehiculos_tipo_categoria`, ver DDL). El resto de la semántica de negocio vive en runtime (`packages/shared-schemas/src/domain/vehicle.ts::validarCoherenciaUnidadVehiculo`, reusada por `apps/api/src/routes/vehiculos.ts` para responder **422 antes de tocar la BD**):

| Categoría / tipo | `capacity_kg` | `curb_weight_kg` | `consumo`/`fuel_type` |
|---|---|---|---|
| motriz, `tracto_camion` | `>= 0` (D1.2: un tracto no carga solo) | nullable, como hoy | **REQUERIDO** (`> 0` y `fuel_type` no-null) — texto vinculante D4, decisiones.md línea 30: "tracto_camion → capacity_kg = 0 permitido y consumo requerido". Un tracto no carga solo, pero sí tiene motor propio y consume combustible; `curb_weight_kg` sigue nullable porque D4.5 solo lo exige para `arrastre` |
| motriz, demás tipos | `> 0`, como hoy | nullable, como hoy | nullable, como hoy |
| arrastre | `> 0` | `> 0` **REQUERIDO** (D4.5: la tara del semi es insumo directo del GVW agregado, y por tanto del cálculo GLEC) | **siempre `null`** (D4.5: un arrastre no tiene motor propio) |

`teltonika_imei` queda opcional para arrastre (asset-tracker independiente del motriz — caso de uso futuro, no bloqueado por este DDL).

**Fix W4a review (I1)**: la implementación inicial dejó `consumo`/`fuel_type` nullable para `tracto_camion` (arrastrando por error la nota "nullable, como hoy" de `curb_weight_kg"). El texto vinculante de D4 (decisiones.md línea 30) exige el consumo explícitamente — corregido en `validarCoherenciaUnidadVehiculo` (nuevos códigos `tracto_consumo_requerido`/`tracto_combustible_requerido`) con el mismo scope que la exigencia de `tipo_unidad` (D4.2): aplica a escrituras nuevas, no reabre filas legacy con `tipo_unidad` NULL.

### 4. Clase GLEC derivada de la CONFIGURACIÓN, no del vehículo suelto

Nueva función pura `categoriaPorConfiguracion()` en `packages/carbon-calculator/src/glec/factor-carga.ts` (junto a la ya existente `categoriaVehiculo()`, que NO cambia de comportamiento para los 9 tipos legacy):

```
con arrastre enganchado         → HDV (articulado, independiente del peso agregado)
motriz sola, GVW = curb+capacity:
  GVW < 3.5 t                   → LDV
  3.5 t <= GVW <= 16 t           → MDV
  GVW > 16 t                     → HDV
```

El servicio orquestador (fuera de alcance de W4a — lo consume W4c) computa la configuración efectiva (motriz + arrastre de la asignación) y pasa la `categoria` explícita a `calcularModeladoConCategoria`/`calcularFactorCorreccionPorCarga` — la API del calculator **ya aceptaba** una categoría override (ADR-021), así que esta pieza no requiere romper el contrato del package.

`DEFAULTS_POR_TIPO` y el switch de `categoriaVehiculo()` ganan 3 entradas nuevas (`tracto_camion`, `semirremolque`, `remolque`) para el modo legacy `por_defecto` (un solo tipo, sin más contexto), documentadas con su razonamiento en el código — `camion_rigido`/`camioneta`/`furgon` de `tipo_unidad` NO se agregan porque ya están cubiertos por sus equivalentes legacy (`camion_pequeno/mediano/pesado`, `camioneta`, `furgon_pequeno/mediano`); duplicarlos sería una fuente de drift entre dos entries que deberían responder lo mismo.

### 5. Mapping/backfill de datos existentes (D4, caveat D4.1)

```
camioneta                              → motriz / camioneta       / (sin carrocería)
furgon_pequeno | furgon_mediano        → motriz / furgon          / furgon_cerrado
camion_pequeno|mediano|pesado          → motriz / camion_rigido   / (sin carrocería)
semi_remolque                          → arrastre / semirremolque / (sin carrocería)
refrigerado                            → motriz / camion_rigido   / refrigerado
tanque                                 → motriz / camion_rigido   / cisterna
```

**Caveat D4.1 (extendido por el PO en la ronda de aprobación de D4)**: el enum legacy no tenía un valor "tracto" — los tractos reales del piloto están **casi seguro** registrados hoy como `camion_pesado`, y este backfill los clasifica como `camion_rigido` (heurística: "el más pesado de los rígidos"), lo cual es **sabido como incorrecto** para cualquier tracto real. Lo mismo aplica a `refrigerado`/`tanque`, que el backfill asume montados sobre chasís rígido cuando en la práctica pueden ser semirremolques. **Acción requerida**: revisar las filas reales del piloto en la UI de flota (W4b) y corregir manualmente. Este backfill es un punto de partida auditable (documentado en comentarios SQL en la propia migración 0048), no un hecho verificado — la columna `tipo_vehiculo` original permanece intacta como fuente de reconciliación.

**Caveat M3 (fix review W4a) — consumo/combustible latentes en `semi_remolque` legacy**: el backfill de la fila `UPDATE ... WHERE tipo_vehiculo = 'semi_remolque'` (migración 0048) **NO nulifica** `consumption_l_per_100km_baseline`/`fuel_type`. Bajo la semántica nueva (D4.5), `arrastre` exige esos campos SIEMPRE `null`; si una fila legacy los tenía poblados (herencia del modelo plano anterior, donde `semi_remolque` no distinguía motriz/arrastre), queda en un estado **latente contra D4.5** hasta que se limpie — no viola el CHECK de BD (que no los toca) ni bloquea lecturas, pero el primer `PATCH` que toque la config de unidad de esa fila (`validarCoherenciaUnidadVehiculo`) exigirá que vengan `null` en el mismo PATCH y devolverá 422 (`arrastre_consumo_debe_ser_null`/`arrastre_combustible_debe_ser_null`) si no se limpian a la vez. Revisión de estas filas es parte de W4b, junto con el caveat D4.1.

### 6. Plan de contract (D4.2)

`vehiculos.tipo_unidad` queda **nullable** en esta migración (expand-only, ADR-066). Zod exige el campo en toda escritura nueva (`apps/api/src/routes/vehiculos.ts`: 400 si falta en `POST /vehiculos`) desde este mismo PR — el `NULL` solo puede ocurrir en filas legacy backfilled. Una migración **contract** futura puede endurecer la columna a `NOT NULL` cuando:

1. El backfill legacy (caveat D4.1) haya sido revisado y corregido en la UI de flota (W4b).
2. Las escrituras nuevas lleven ≥1 sprint exigiendo el campo (ya lo exigen desde este PR) sin incidentes.
3. **(M2, fix review W4a) `apps/api/src/services/seed-demo.ts` esté actualizado para insertar `tipo_unidad`** (hoy inserta vehículos sin ese campo — cada seed nuevo crearía filas `NULL` frescas, no solo backfill legacy, lo que reabre la ventana que el punto 1 busca cerrar) **o el subsistema demo esté retirado** (decisión de negocio ya tomada para el go-live de carriers reales, jun-2026 — ver memoria `demo-subsystem-debt`). Cualquiera de las dos satisface esta precondición; no aplicar el `SET NOT NULL` mientras ninguna se cumpla.

Esa migración futura debe llevar el marcador `-- contract-phase: ADR-073` (exigido por el guard `scripts/repo-checks/check-migration-safety.mjs`, ADR-066) porque `SET NOT NULL` sobre una columna con filas `NULL` existentes es DDL destructivo (rompe backward-compat si alguna revisión vieja de Cloud Run todavía escribe sin el campo).

### 7. Compatibilidad tracto↔semirremolque / rígido↔remolque (D1.3)

Helper puro `esConfiguracionCompatible(motrizUnitType, arrastreUnitType)` en `packages/shared-schemas/src/domain/vehicle.ts`: `tracto_camion` solo compone con `semirremolque`; `camion_rigido` solo con `remolque`; `camioneta`/`furgon` no llevan arrastre hoy. Es **insumo para W4c** (armado de la configuración efectiva del servicio) — W4a no tiene write path de asignación, solo deja el helper listo y testeado. El guard complementario "un arrastre nunca puede ser `vehiculo_id` de una asignación" (D1.3) también queda documentado para W4c: no hay write path de asignación en esta tarea, por lo que no hay dónde enforzarlo todavía.

### 8. FK en `asignaciones`, no en `viajes` (corrección D4)

El plan original atribuyó `unidad_arrastre_id` a `viajes`. `w4-contexto.md` encontró que el vehículo del servicio vive en `asignaciones.vehiculo_id` (el campo `asignado_a_vehiculo_id` que el plan original tenía en mente pertenece en realidad a `dispositivos_pendientes`, una tabla no relacionada). El PO corrigió esto en D4: `unidad_arrastre_id` vive en `asignaciones`, con `CHECK chk_asignaciones_arrastre_distinto (unidad_arrastre_id IS NULL OR unidad_arrastre_id <> vehiculo_id)` para impedir que la misma fila apunte al mismo vehículo como motriz y como arrastre simultáneamente.

## Alcance (qué NO toca esta tarea)

- `packages/matching-algorithm`, `apps/api/src/routes/cargo-request.ts`, `apps/api/src/services/seed-demo.ts`: siguen en el enum `tipo_vehiculo` legacy sin cambios.
- UI de flota (W4b): la revisión/corrección manual del backfill (caveat D4.1) es tarea de esa fase.
- `trip-state-machine` / handler de inicio de viaje (W4c): el armado de la configuración efectiva (validando `esConfiguracionCompatible` + el guard "arrastre nunca como `vehiculo_id`") y el consumo de `categoriaPorConfiguracion()` desde el service orquestador quedan para esa fase — no hay write path de asignación en W4a.
- Bitrén 0..N: deuda declarada, plan de pago en `.specs/_followups/flota-bitren-0-n-arrastres.md`.

## Fuentes normativas

- **GLEC Framework v3.0** (Smart Freight Centre, 2023) §6.3 — misma fuente que calibra `ALFA_POR_CATEGORIA`/`categoriaVehiculo()` (ADR-021). La segmentación LDV/MDV/HDV por GVW que usa `categoriaPorConfiguracion()` está alineada en espíritu con esa sección, pero **el corte numérico exacto de 16 t para el techo de MDV no está tomado literalmente de una tabla publicada de GLEC v3.0** — es una convención de ingeniería de este proyecto (razonable, consistente con la segmentación LDV/MDV/HDV ya usada en `categoriaVehiculo()`, pero **referencial**, no una cita verificada palabra por palabra contra el texto del framework). Documentado así explícitamente para no reclamar más precisión normativa de la que se puede sostener.
- **D.S. N°158/1980** (Ministerio de Obras Públicas de Chile, Diario Oficial 07-abr-1980, "Fija peso máximo de los vehículos que pueden circular por caminos públicos", modificado por D.S. N°181/2024) — **corrección de atribución**: el brief de esta tarea lo citaba como "D.S. 158 MTT"; verificado (búsqueda web, 2026-07-06) que es del **MOP** (Ministerio de Obras Públicas), no del MTT (Ministerio de Transportes y Telecomunicaciones). El decreto fija pesos máximos por eje y peso bruto total para circular en caminos públicos chilenos (contexto regulatorio de por qué existe un límite práctico de configuraciones tracto+semirremolque/bitrén), pero **no define por sí mismo** una segmentación LDV/MDV/HDV — se cita como contexto regulatorio del peso máximo de circulación, no como fuente de los cortes numéricos de clasificación GLEC usados en el calculator.
- Ley de Tránsito chilena (D.S. N°170, clases de licencia A1-A5) — ya citada en `apps/api/src/db/schema.ts` (`licenciaClaseEnum`, comentario preexistente): A5 es la única clase que habilita "camión articulado > 3.500 kg con remolque", consistente con el modelo de configuración articulada de este ADR (motriz + arrastre).

## Consecuencias

### Positivas

- El piloto puede declarar tracto+semirremolque y rígido+remolque sin bloquear `capacity_kg` (bug de UX real, D1.2).
- La clase GLEC de un articulado ya no se malclasifica por el tipo del chasís motriz solo.
- Backfill auditable con caveats explícitos en la propia migración — no se oculta la incertidumbre del mapping.
- Expand-only completo (ADR-066): cero riesgo de rollback de código incompatible con el esquema.

### Negativas / deuda aceptada

- 0..1 arrastre (no 0..N/bitrén) — deuda declarada, plan de pago existente.
- El backfill de `camion_pesado`/`refrigerado`/`tanque` puede estar objetivamente mal para filas reales del piloto — requiere revisión manual en W4b antes de confiar en el dato para reporting GLEC certificado.
- El corte GVW de 16 t en `categoriaPorConfiguracion()` es una convención de ingeniería, no una cita normativa verificada — marcado explícitamente como referencial en código y acá.
- Dos columnas de "tipo" coexisten (`tipo_vehiculo` legacy + `tipo_unidad` nuevo) hasta que W4b/consumidores legacy migren — mismo patrón que ADR-043 (SQL es canónico, domain/consumers migran cuando corresponda).

## Status

Accepted. Implementado en `feat/tipologias-flota-y-huella-inicio-viaje` (W4a): migración `0048_tipologias_flota.sql`, schema Drizzle, `packages/shared-schemas/src/domain/vehicle.ts`, `packages/carbon-calculator` (`categoriaPorConfiguracion`), `apps/api/src/routes/vehiculos.ts`. Apply a prod pendiente de checkpoint del PO (fuera de alcance de esta tarea — el entregable es la migración mergeable + evidencia local).
