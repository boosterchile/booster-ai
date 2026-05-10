# ADR-023 — Algoritmo de matching v1: greedy, online, capacity-scoring determinista

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: nada (formaliza retroactivamente la implementación de `packages/matching-algorithm/` PR #31).
**Related**:
- [ADR-004 Modelo Uber-like y roles](./004-uber-like-model-and-roles.md) (define matching carrier-based, no driver-based)
- [ADR-021 GLEC v3.0 compliance](./021-glec-v3-compliance.md) (factor de matching de retorno consumido por carbon-calculator)
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) (priority boost futuro NO implementado en v1)

---

## Contexto

Booster AI necesita un algoritmo que, ante una `trip_request` recién creada, seleccione hasta `N` empresas transportistas a las que enviar una oferta. La oferta tiene TTL; el primer carrier que acepta gana la asignación. Esto define el "matching" del marketplace.

A 2026-05-10 la implementación vive en `packages/matching-algorithm/` y se invoca desde `apps/api/src/services/matching.ts:runMatching()` síncronamente al `POST /trip-requests-v2`. El PR #31 (commit `ce85fb8`) agregó 18 tests cubriendo scoring + selección + config y dejó el algoritmo en estado verificable. Sin embargo **no existe ADR formal** que documente:

- Por qué el scoring es **capacity-only** (no precio, no rating, no distancia, no tier)
- Por qué se usa **greedy + online**, no batch optimization (Hungarian, LP, auction)
- Cuál es la garantía de **determinismo** (tie-breaking) y por qué importa
- Cómo se **separa** el factor de matching de retorno (GLEC §6.4) del scoring de selección
- Qué dimensiones del scoring son **roadmap** y bajo qué señal se activan

Sin un ADR, decisiones tomadas por presión de scope quedan implícitas y se debaten cíclicamente. Este documento las cierra para v1 y declara el contrato bajo el que el código vive hasta su próximo super-set.

---

## Decisión

Adoptar y formalizar el siguiente diseño para `packages/matching-algorithm/` v1.

### 1. Scoring puramente capacitario (best-fit)

Para cada `VehicleCandidate` ofrecido por un carrier candidato, el score se calcula:

```
si cargoWeightKg ≤ 0:
    score = 1.0                         # sin información de peso, no penalizar

si cargoWeightKg > 0:
    slackRatio = (vehicleCapacityKg - cargoWeightKg) / vehicleCapacityKg
    score     = max(0, 1 - slackRatio · CAPACITY_SLACK_PENALTY)
```

Constantes (en `packages/matching-algorithm/src/index.ts`):

| Constante | Valor | Propósito |
|---|---:|---|
| `MAX_OFFERS_PER_REQUEST` | `5` | Máximo de ofertas paralelas — limita latencia y evita "spray" |
| `OFFER_TTL_MINUTES` | `60` | Tiempo de vida de una oferta pendiente |
| `CAPACITY_SLACK_PENALTY` | `0.1` | Por cada 100% de slack se resta 10% del score |

**Interpretación**: penalizamos vehículos sobredimensionados (camión grande para carga chica → costo logístico mayor + slot ocupado que podría servir otra carga). Vehículos sub-dimensionados ya están filtrados a nivel SQL (`capacityKg ≥ cargoWeightKg`). Por construcción el scoring es **best-fit** (priorizamos el vehículo más pequeño que aún sirve).

### 2. Selección greedy, online, top-N determinista

`runMatching(tripId)` ejecuta secuencialmente, dentro de una transacción:

1. Filtrar empresas con **zona de recogida activa** en `trip.originRegionCode` (`zones.zoneType ∈ {recogida, ambos}`).
2. De esas empresas, filtrar las que son `isTransportista=true` y `status='activa'`.
3. Por cada empresa restante: seleccionar el **vehículo activo de menor capacidad ≥ cargo** (SQL `ORDER BY capacityKg ASC LIMIT 1`).
4. Calcular `score` con `scoreCandidate()`.
5. `selectTopNCandidates(candidates, MAX_OFFERS_PER_REQUEST)` ordena por `score` desc; **tiebreak por `vehicleId.localeCompare()` ascendente** (string ASCII estable).
6. INSERT N rows en `offers` con `score = scoreToInt(score) ∈ [0, 1000]`, `proposedPriceClp = trip.proposedPriceClp ?? 0`, `expiresAt = now + OFFER_TTL_MINUTES`.
7. UPDATE trip → `'ofertas_enviadas'`. Audit en `tripEvents` (`matching_iniciado` + `ofertas_enviadas`).
8. Fire-and-forget `notifyOfferToCarrier()` por offer (Web Push → FCM → WhatsApp; ver ADR-004).

**Determinismo**: dado el mismo set de candidatos (mismas filas en `vehicles`/`zones`/`empresas`), la salida es bit-idéntica entre corridas. Esto es requisito para auditabilidad ESG (GLEC v3.0 exige reproducibilidad de cálculo).

### 3. Razones de fallo enumeradas y observables

Cuando no hay match, `runMatching` resuelve la ausencia con uno de tres estados públicos:

| `NoCandidatesReason` | Cuándo se emite |
|---|---|
| `no_carrier_in_origin_region` | Ningún carrier tiene zona activa en la región del origen |
| `no_active_carriers` | Hay zonas pero ninguna empresa pasa `isTransportista=true ∧ status='activa'` |
| `no_vehicle_with_capacity` | Hay carriers activos pero ningún vehículo activo cumple `capacityKg ≥ cargoWeightKg` |

El trip queda en estado `'expirado'` con la razón en `tripEvents.payload.reason`. El operador puede revisar y, si aplica, ajustar las zonas / capacidades / tier de carriers en la región afectada.

### 4. Backhaul factor SEPARADO del scoring de selección

`calcularFactorMatching()` en `packages/matching-algorithm/src/factor-matching.ts` calcula el porcentaje del retorno cubierto entre dos viajes consecutivos del mismo transportista (GLEC §6.4 + ISO 14083):

```
rama EXACTA (cuando hay distancia Distance Matrix):
    kmAhorrados = distanciaRetornoTotalKm − distanciaPrevDestinoANextOrigenKm
    factor      = clamp([0, 1], kmAhorrados / distanciaRetornoTotalKm)

rama COMUNA (fallback binario):
    factor      = (prevDestinoComunaCode == nextOrigenComunaCode) ? 1 : 0

ventana temporal: 0 ≤ Δt ≤ MATCHING_TIME_WINDOW_HORAS (= 4h)
```

Esta función **NO se llama desde `runMatching()`**. Se invoca **post-entrega confirmada** desde `apps/api/src/services/calcular-metricas-viaje.ts` para poblar el campo ESG `factor_matching` del viaje. El motivo: si el factor afectara el scoring de selección, sería trivialmente gameable (un carrier marca "tengo backhaul" para subir su orden), comprometería la verificabilidad GLEC y no es la métrica que maximiza el bienestar del shipper en el momento del match.

### 5. Decisiones explícitamente diferidas a v2+

Las siguientes dimensiones están **fuera del scope de v1** y se documentan acá para que no se reabran en revisión sin un ADR superseding:

| Dimensión | Razón de exclusión v1 | Señal para activar |
|---|---|---|
| **Distancia Origin↔Carrier** | Sin geocoding lat/lng confiable; zona regional alcanza | Routes API integration + `vehicles.last_known_location` |
| **Tier membership boost** | Tablas `carrier_memberships` aún no creadas (ADR-026 pending) | Cuando ADR-026 §2-§5 se implemente: aplicar `score_adjusted = score + tier.priorityBoost` |
| **Rating histórico carrier** | <90 días de historial; data sparse | ≥6 meses de historial con N≥30 trips por carrier |
| **ML scoring (LightGBM/XGBoost)** | Sin volumen para entrenar; overfit garantizado | Cuando aceptación rate sea estable (varianza <5% mensual) por ≥3 meses |
| **Multi-leg consolidation** | NP-hard; out of scope MVP | Cuando >30% de ofertas vengan de carriers con ≥2 trips/día |
| **Time-window optimization** | Pickup window se ignora; default ALL trips son "FCFS" | Cuando shippers reporten ≥10% de cancelaciones por timing |
| **Auction / market clearing** | Latencia &gt;200ms inaceptable; carriers PYME no harán bidding activo | Re-evaluar si el modelo de marketplace cambia a "marketplace líquido" (>1k carriers/región) |
| **Batch async (Pub/Sub)** | Latencia round-trip extra (>30s) sin retorno claro | Si `runMatching` síncrono pasa P95 > 1s sostenidamente |

Cualquiera de estas dimensiones sólo entra al algoritmo vía un nuevo ADR que supersede este, o un cambio menor que NO afecte la fórmula core (ej. un tiebreak adicional documentado).

### 6. Test contract garantizado

Los 18 tests del PR #31 (`packages/matching-algorithm/test/scoring.test.ts`) + 18 tests del PR de factor-matching (`test/factor-matching.test.ts`) constituyen el **contrato verificable** del algoritmo. Cualquier cambio futuro que rompa esos tests requiere ADR superseding; cualquier feature nueva debe agregar tests cubriendo:

- Fórmula del scoring (`scoreCandidate`)
- Determinismo de la selección (`selectTopNCandidates`)
- Conversión a entero (`scoreToInt`) — usado para persistir en `offers.score` sin floats
- Casos no-match enumerados (`NoCandidatesReason`)
- Constantes (snapshot test contra `MATCHING_CONFIG`)

---

## Consecuencias

### Positivas

- **Latencia P50 ≤ 150ms** para `POST /trip-requests-v2` (medido en dev, escalable a prod por ser O(C log C) en candidates con C típicamente <100 por región).
- **Auditable**: dado el snapshot del DB, la salida es reproducible bit-identical. Compatible con GLEC v3.0 §"reproducibility of allocation".
- **Sin gaming**: no hay variable que el carrier pueda manipular para subir su score (capacidad del vehículo está validada contra `vehicles` tabla, no autoreportada por request).
- **Roadmap explícito**: cada dimensión futura tiene su criterio de activación, evitando feature creep ad-hoc.
- **Best-fit preserva inventario**: vehículos grandes quedan disponibles para cargas que realmente los necesitan (mejor utilización de flota agregada).

### Negativas / costos

- **Sin sensibilidad geográfica intra-región**: un carrier en Antofagasta capital puede recibir oferta de un origin en Calama (misma región II). Hasta integración con Routes API o lat/lng del origin. Mitigación: zonas se pueden subdividir si se requiere (workaround operacional).
- **Sin priority boost por tier**: un Premium carrier no recibe trato preferente en v1. Esto reduce el atractivo del tier Premium hasta ADR-026 implemente las tablas. Mitigación: ADR-026 §110 ya documenta el plan; v1.1 lo agrega.
- **Best-fit puede dejar fleet desbalanceada**: si el algoritmo siempre elige el camión más chico que sirve, los camiones grandes quedan sub-utilizados. Mitigación monitorear distribución de `slack_ratio` post-entrega; si >30% de cargas usan vehículo grande disponible mientras chico está libre, replantear el sentido del slack penalty.
- **Greedy puede subóptimo localmente**: ante 2 trips simultáneos y 3 carriers comunes, online elige carrier A para trip 1 sin saber que A era óptimo para trip 2. Aceptado por simplicidad MVP.

### Acciones derivadas

1. **Métricas a instrumentar (post-merge)** — sin estas no se puede evaluar si v1 funciona:
   - `matching.candidates_evaluated` (histograma por trip)
   - `matching.offers_created` (counter)
   - `matching.no_match_reason` (counter por enum value)
   - `matching.acceptance_rate` (1d/7d/30d, % de offers aceptadas vs enviadas)
   - `matching.time_to_first_acceptance_sec` (P50/P95)
   - `matching.fairness_gini_carrier` (mensual; gini de offers por carrier en una región)
2. **Snapshot test de `MATCHING_CONFIG`** ya cubierto en `scoring.test.ts` (suite 4) — mantener.
3. **Documentar criterios de activación de v2+** (esto está en este ADR, sección 5; cualquier propuesta futura DEBE citar la fila correspondiente).
4. **Escribir runbook `docs/runbooks/matching-no-match-investigation.md`** con queries SQL para diagnosticar cada `NoCandidatesReason` (zona faltante, carrier sin vehículos, etc.).
5. **Re-evaluar este ADR** cuando se den dos condiciones simultáneas:
   - ≥3 meses de tráfico productivo continuo
   - ≥1000 trips matched (volumen suficiente para extraer signal)

---

## Validación

- [x] 18 tests scoring.test.ts pasan (PR #31, commit `ce85fb8`)
- [x] 18 tests factor-matching.test.ts pasan
- [x] `packages/matching-algorithm/` no tiene `any`, `console.*` ni TODOs colgados
- [ ] Métricas listadas en "Acciones derivadas §1" emitidas a Cloud Monitoring (pending P1)
- [ ] Runbook `matching-no-match-investigation.md` creado (pending P2)
- [ ] Dashboards de matching en Cloud Monitoring (pending P2)

---

## Notas de implementación

- El servicio `apps/matching-engine/` (Cloud Run) es **placeholder** a 2026-05-10. Cuando se necesite mover el matching a async (criterio: `runMatching` P95 > 1s), este ADR debe ser superseded por uno que documente el bus de eventos, el SLA del consumer y la consistencia eventual (offers eventually-created).
- `score` se persiste como entero `[0, 1000]` (`scoreToInt(score)`) — evita errores de precisión en queries que ordenen por score y permite `index` BTREE eficiente.
- El best-fit a nivel SQL (`ORDER BY capacityKg ASC LIMIT 1` por empresa) es importante: cambiar a `LIMIT N` y dejar que `scoreCandidate` haga el ranking explícito sería técnicamente equivalente pero N× más caro en queries.
