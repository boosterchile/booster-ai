# ADR-033 — Matching algorithm v2: multi-factor con awareness de empty-backhaul

**Status**: Accepted
**Date**: 2026-05-11
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (agente) como arquitecto de software
**Supersedes**: [ADR-023](./023-matching-algorithm-v1-greedy-capacity-scoring.md) parcialmente — la fórmula v1 sigue activa como fallback y como rama default mientras el flag `MATCHING_ALGORITHM_V2_ACTIVATED=false`. La superseption es del scoring, NO del flow online + greedy + top-N.
**Related**:
- [ADR-021 GLEC v3.0 compliance](./021-glec-v3-compliance.md) — el factor de matching de retorno medido post-entrega.
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) — tier priority boost.
- [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md) — matching carrier-based.

---

## Contexto

El algoritmo v1 (ADR-023) es **capacity-only**: el score depende exclusivamente del ajuste capacidad↔carga. Esto sirvió para el MVP, pero deja en la mesa una oportunidad estratégica clave de Booster.

La promesa central del marketplace es **optimizar empty backhaul** — encontrar cargas de retorno para los camiones que ya van a estar en una ruta. Hoy esa optimización se mide **post-hoc** (`packages/matching-algorithm/factor-matching.ts` calcula el factor cuando dos trips consecutivos del mismo carrier ya pasaron). El matching engine **no usa esa señal** al elegir a quién ofertar.

La consecuencia: el algoritmo v1 ofrece igual a un carrier que **ya está cerca del origen** (porque acaba de entregar a 20km) que a uno **que tendría que viajar 800km vacío** para tomar el viaje. Pierde valor diferencial:

- Para el shipper: menor probabilidad de aceptación rápida (carrier remoto puede rechazar).
- Para el carrier: pierde la oportunidad de monetizar un retorno que iba a hacer igual.
- Para el marketplace: factor matching efectivo bajo → menos ahorro CO₂e reportado → menor diferenciación ESG.

ADR-023 §5 ya documenta esta dimensión como **diferida a v2**, con dos criterios de activación:
- Routes API + lat/lng del vehículo (la primera ya está, la segunda parcialmente).
- ≥6 meses de historial con N≥30 trips por carrier (a 2026-05 todavía no está).

Aun sin lat/lng vivo del vehículo y con historial sparse, **podemos derivar la señal del histórico de trips del carrier en la DB**: si un carrier acaba de entregar (o tiene un trip activo cuyo destino está) cerca del origen del nuevo trip, su probabilidad de hacer un match real es alta.

Este ADR formaliza esa decisión.

---

## Decisión

Adoptar **`matching-algorithm/v2`** como una capa adicional sobre v1, activable por flag y operable end-to-end:

### 1. Scoring multi-factor con pesos calibrables

El score del candidato es una combinación lineal de **4 componentes**, cada uno ∈ [0, 1]:

```
score_v2 = (w_capacidad × s_capacidad)
        + (w_backhaul    × s_backhaul)
        + (w_reputacion  × s_reputacion)
        + (w_tier        × s_tier)
```

Pesos default (calibrados para favorecer backhaul como diferenciador):

| Componente | Peso | Racional |
|---|---:|---|
| `s_capacidad` | `0.40` | Mismo best-fit de v1. Penalizar slack evita desperdicio de flota. |
| `s_backhaul` | `0.35` | **Nuevo**. Premia carriers con presencia geográfica reciente cerca del origen. |
| `s_reputacion` | `0.15` | Histórico de aceptación del carrier (proxy de "probabilidad de aceptar"). |
| `s_tier` | `0.10` | Priority boost del tier (Free 0%, Standard 30%, Pro 60%, Premium 100%). |

Suma de pesos = `1.0` invariante. Si todos los componentes son `1.0`, el score final es `1.0`.

**Por qué estos pesos**:
- Capacidad sigue siendo el filtro físico fundamental (camión chico no transporta carga grande). Default 0.40.
- Backhaul tiene 0.35 porque es la diferenciación comercial — sin ello, somos un marketplace genérico.
- Reputación 0.15 — relevante pero secundaria cuando hay poco historial.
- Tier 0.10 — incentivo a upgradear sin distorsionar el matching para Free.

Estos pesos son **configurables vía env** (`MATCHING_V2_WEIGHTS_JSON`) para permitir A/B testing post-launch sin redeploy.

### 2. Componente `s_capacidad` (mismo modelo v1)

```
si cargoWeightKg ≤ 0:
    s_capacidad = 1.0
sino:
    slackRatio   = (vehicleCapacityKg − cargoWeightKg) / vehicleCapacityKg
    s_capacidad  = max(0, 1 − slackRatio × CAPACITY_SLACK_PENALTY)
```

Constante `CAPACITY_SLACK_PENALTY = 0.5` (más severa que v1 que era 0.1, porque ahora el peso del componente es 0.40 — sin endurecer la penalidad, el camión sobredimensionado quedaría con score muy alto en el agregado).

### 3. Componente `s_backhaul` (señal nueva)

Para cada carrier candidato, evaluamos su **proximidad geográfica reciente** al origen del trip nuevo:

```
si carrier tiene trip ACTIVO con destino en la misma región del origen:
    s_backhaul = 1.0       # match perfecto — vehículo ya va para allá
sino si carrier entregó en últimos N_DAYS_BACKHAUL_WINDOW (=7):
    let trips_recientes = trips del carrier (entregados últimos 7d)
    let match_regional  = count(trips con destino == region_origen del nuevo trip)
    let total           = count(trips_recientes)
    s_backhaul = match_regional / max(1, total)
sino:
    s_backhaul = 0
```

**Por qué no es gameable**: la señal viene de la DB de trips **reales** (entregados, con evidencia, persistidos por el sistema). El carrier no controla el destino — lo elige el shipper. No puede "marcar" tener backhaul; solo lo tiene si efectivamente lo tiene.

**Defendible ante GLEC**: §6.4 del Framework no prohíbe usar histórico para optimizar matching ex-ante; sólo exige que la atribución post-hoc de empty backhaul al certificado sea reproducible. v2 mejora la calidad del match sin afectar el cálculo del factor reportado.

### 4. Componente `s_reputacion` (rate de aceptación histórico)

```
si carrier tiene <N_MIN_OFFERS_FOR_REPUTATION (=10) ofertas en últimos 90d:
    s_reputacion = 0.5        # neutro — no penalizar carriers nuevos
sino:
    accepted   = count(offers status='aceptada' últimos 90d)
    total      = count(offers totales últimos 90d)
    s_reputacion = accepted / total       # ∈ [0, 1]
```

**Floor de 0.5 para carriers nuevos**: evita que un carrier sin historial sea sistemáticamente bypassed. Onboarding-friendly.

### 5. Componente `s_tier` (priority boost por tier)

```
s_tier = tierBoost[carrier.tierSlug]
```

| Tier | Boost |
|---|---:|
| `free` | `0.0` |
| `standard` | `0.30` |
| `pro` | `0.60` |
| `premium` | `1.0` |

Estos valores corresponden al campo `matching_priority_boost` ya existente en la tabla `membership_tiers` (ADR-026). v2 lo lee directamente de DB; los valores arriba son el **default si no hay tier** (ej. carrier sin membership activa).

### 6. Función pura: `scoreCandidateV2`

Toda la lógica está en `packages/matching-algorithm/src/v2/score-candidate.ts`, sin dependencias de DB ni servicios. La firma:

```typescript
export function scoreCandidateV2(
  candidate: CarrierCandidateV2,
  trip: TripScoringContextV2,
  weights: WeightsV2 = DEFAULT_WEIGHTS_V2,
): ScoredCandidateV2;
```

Donde `CarrierCandidateV2` incluye:
- Mismos campos que v1 (`empresaId`, `vehicleId`, `vehicleCapacityKg`).
- Nuevos: `tripsActivosDestinoRegionMatch: boolean`, `tripsRecientes: { totalUltimos7d: number; matchRegionalUltimos7d: number }`, `ofertasUltimos90d: { totales: number; aceptadas: number }`, `tierBoost: number`.

El orquestador (`apps/api/src/services/matching.ts` en PR #2) hace los lookups SQL para llenar estos campos y luego invoca la función pura.

### 7. Selección top-N con tiebreaks deterministas

```
ordenar candidatos por:
    1. score_v2 desc
    2. vehicleId.localeCompare asc      # mismo tiebreak que v1
slice(0, MAX_OFFERS_PER_REQUEST)         # mismo límite (5)
```

Mantenemos `MAX_OFFERS_PER_REQUEST = 5` y `OFFER_TTL_MINUTES = 60` de v1.

### 8. Feature flag y rollout

```
MATCHING_ALGORITHM_V2_ACTIVATED ∈ { true, false }
    default false en todos los entornos durante rollout inicial.
    Encender por entorno cuando los tests + backtest validen mejora.
```

Cuando `false`, el orquestador usa v1 sin cambios (`scoreCandidate` legacy). Cuando `true`, hace los lookups adicionales y usa `scoreCandidateV2`.

**Reversibilidad**: ambos algoritmos coexisten en el repo indefinidamente. Si v2 muestra regresión en producción (medido por el backtest del PR #3), revertir es flip del flag.

### 9. Backtest framework

PR #3 agrega `services/backtest-matching.ts` que:
- Toma una ventana de trips ya cerrados (típicamente 30d).
- Re-corre el matching v1 y v2 para cada uno con el snapshot de DB de ese momento.
- Mide para cada algoritmo:
  - `factor_matching_promedio` post-entrega (señal proxy real GLEC §6.4).
  - `tiempo_a_primera_aceptacion_p50/p95` (segundos).
  - `tasa_aceptacion` (offers aceptadas / offers totales).
  - `concentracion_carriers` (Gini de offers por carrier en la región).
- Reporta deltas v2 vs v1.

El endpoint admin `POST /admin/matching/backtest` lo dispara manualmente; resultados quedan persistidos en una tabla `matching_backtest_runs` para auditoría.

### 10. Métricas observables (instrumentar al wire)

| Métrica | Tipo | Cuándo se emite |
|---|---|---|
| `matching.algorithm_version` | counter | Por cada run, etiquetado `v1`/`v2` |
| `matching.score_component.{capacidad,backhaul,reputacion,tier}` | histogram | Por cada candidato evaluado |
| `matching.backhaul_signal_distribution` | counter | Por cada candidato: `active_trip_match`/`recent_history_match`/`no_signal` |
| `matching.acceptance_rate_v2_30d` | gauge | Refrescado cada hora; tasa de aceptación de offers v2 |
| `matching.fairness_gini_carrier` | gauge | Mensual; gini de offers por carrier |

---

## Consecuencias

### Positivas

- **Aumento esperado del factor matching efectivo del marketplace** (medible post-launch con backtest). Estimación inicial: +25-40% en factor promedio si el matching favorece a carriers con presencia regional reciente.
- **Reducción del empty backhaul absoluto**: kg CO₂e ahorrados a nivel de marketplace, no solo per-trip.
- **Mayor probabilidad de aceptación**: carriers cerca aceptan más; tiempo a primera aceptación baja.
- **Diferenciación ESG**: certificados de Booster reportan más ahorro real, no estimado.
- **Tier monetiza correctamente**: Premium carriers reciben priority real, no solo en docs.
- **Auditable**: cada componente del score se loggea; un auditor puede reconstruir por qué carrier X recibió oferta en lugar de carrier Y.

### Negativas / costos

- **Más queries SQL por trip**: lookup de trips activos, histórico 30d, histórico ofertas. Latencia del matching sube de O(C log C) a O(C × queries_lookup). Mitigación: cache + indexes específicos. Target P95 < 500ms (vs 200ms de v1).
- **Cold-start para carriers nuevos**: sin historial, `s_backhaul=0` y `s_reputacion=0.5`. Pueden quedar desfavorecidos. Mitigación: floor de 0.5 en reputación; el tier boost también ayuda.
- **Pesos arbitrarios al lanzamiento**: 0.40/0.35/0.15/0.10 son una hipótesis razonada. El backtest validará si los valores son los correctos antes de prender el flag en prod.
- **Complejidad del código**: el orquestador crece (más lookups, más cache). Mitigación: separar `services/matching-v2-lookups.ts` para que el agregador siga siendo legible.

### Acciones derivadas

1. **PR #1 (este)**: ADR + función pura + tipos + tests. Bloquea PR #2.
2. **PR #2**: orquestador wire en `matching.ts` con feature flag. Lookup helpers.
3. **PR #3**: backtest service + endpoint admin + tabla `matching_backtest_runs`.
4. **PR #4**: UI platform-admin para correr backtest + ver resultados + toggle flag.
5. **Rollout**: una vez PRs 1-4 mergeados, correr backtest sobre 30d de trips de staging. Si delta v2 vs v1 muestra mejora >15% en factor matching sin degradar P95 latencia, **encender flag** en staging por 7d. Si métricas siguen bien, encender en prod.
6. **Re-evaluación a 90d**: si v2 mostró mejora estable, **deprecar v1** en ADR-033a. Si no, ajustar pesos o agregar componentes.

### Cuándo reabrir este ADR

- Si Routes API + lat/lng del vehículo se vuelven canónicos → el componente `s_backhaul` puede pasar de heurística regional a haversine exacto (similar al upgrade que hicimos al cálculo post-hoc en #143).
- Si ML scoring (LightGBM/XGBoost) sobre histórico de 12 meses muestra mejora significativa → ADR-034 supersedería esto.
- Si los pesos default (0.40/0.35/0.15/0.10) demuestran ser suboptimos → ADR-033a con justificación basada en backtest.

---

## Validación (este PR)

- [x] ADR escrito + supersede declarado.
- [x] Función pura `scoreCandidateV2` implementada en `packages/matching-algorithm/src/v2/`.
- [x] Tipos `CarrierCandidateV2`, `TripScoringContextV2`, `WeightsV2`, `ScoredCandidateV2`.
- [x] Tests con vectores fijos (≥40 tests cubriendo cada componente + agregación + edge cases).
- [x] Selección top-N + tiebreaks idénticos a v1 (compatibilidad).
- [x] Suma de pesos = 1.0 validada (Zod schema o invariante test).

## Notas

Esta ADR no se aplica retroactivamente a trips ya cerrados. El factor matching reportado en certificados existentes sigue siendo válido — esos certificados se calcularon con el factor real del trip, no con el algoritmo que originó la oferta. v2 cambia qué carrier recibe la oferta; el factor reportado en el certificado se calcula post-hoc con `factor-matching.ts`, que NO depende de v1 vs v2.
