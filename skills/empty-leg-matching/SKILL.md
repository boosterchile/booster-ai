# Skill: Empty-Leg Matching Algorithm

**Categoría**: core-engineering + iot-telemetry (dominio)
**Relacionado**: ADR-004 modelo Uber-like, ADR-005 telemetría

## Overview

El corazón del producto: dado un `CargoRequest` abierto, identificar los carriers candidatos y puntuarlos para enviarles la oferta. El algoritmo debe ser transparente, testeable y auditable — un shipper o carrier que pregunta "por qué X carrier recibió la oferta antes que Y" debe poder recibir respuesta basada en factores objetivos.

## When to Use

- Al implementar inicialmente `packages/matching-algorithm`
- Al ajustar los pesos del scoring (requiere ADR)
- Al añadir nuevos factores al modelo
- Al debuggear por qué un carrier específico no recibió oferta que creía merecer

## Core Process

### 1. Definir señales de input

El algoritmo recibe:

```typescript
interface MatchingInput {
  cargoRequest: CargoRequest;  // qué carga, de dónde a dónde, cuándo, tipo de vehículo
  candidateCarriers: Carrier[]; // universo de carriers elegibles (filtro pre-algoritmo)
  vehicleAvailability: Map<carrier_id, Vehicle[]>; // vehículos disponibles por carrier
  lastKnownPositions: Map<vehicle_id, Position>;  // del Firestore hot
  carrierRatings: Map<carrier_id, number>;        // promedio últimos 6 meses
  carrierCapacity: Map<carrier_id, { open_trips: number, max_parallel: number }>;
  now: Date;  // pasado explícito para determinismo
}
```

### 2. Filtros previos (hard constraints)

Antes de puntuar, eliminar carriers que **no pueden** tomar la carga:

- Sin vehículo con `capacity_kg >= cargoRequest.weight_kg`
- Sin vehículo del tipo requerido (`cargoRequest.required_vehicle_type`)
- Carrier con `capacity.open_trips >= max_parallel` (saturado)
- Carrier `status` ≠ `active`
- Carrier con rating < umbral global (ej. 3.0/5.0)
- Carrier con vehículos cuya `last_inspection` expiró
- Carrier sin documentación completa (cert digital SII, seguros, etc.)

**Si después de filtros < 3 candidatos → ampliar búsqueda geográfica o relajar umbrales según config**. Nunca dejar una oferta sin candidatos.

### 3. Scoring multifactor

Cada carrier candidato recibe un score compuesto. Los pesos se calibrarán empíricamente — empezar con:

| Factor | Peso inicial | Cómo se mide |
|--------|-------------|--------------|
| `proximity` | 0.35 | Distancia de la posición actual del vehículo al punto de pickup. Cuanto menor, mejor. |
| `empty_leg_opportunity` | 0.25 | Si el vehículo está en un "leg de retorno vacío" (acaba de delivery, vuelve a origen sin carga), puntuación alta. Es **el diferenciador ESG**. |
| `rating` | 0.15 | Rating promedio del carrier. |
| `historical_success` | 0.10 | % de trips completados vs offered en últimos 90 días. |
| `vehicle_match_quality` | 0.10 | Qué tan bien calza el vehículo con la carga (sobrecapacidad genera emisiones innecesarias). |
| `price_affinity` | 0.05 | Si el carrier tiene precio histórico cercano al budget del shipper. |

Normalizar cada factor a [0, 1] antes de ponderar.

### 4. Empty-leg detection

La lógica más delicada. Un empty-leg se detecta cuando:

- El vehículo completó un trip hace <6 horas
- La posición actual está alejada de la base del carrier (>50 km)
- El vehículo no tiene trip activo ni aceptado
- La dirección hacia la base (o hacia la nueva carga) coincide con el corredor del cargo request

Score empty-leg = `1 - (distancia_extra_desvío_km / distancia_base_km)`, acotado en [0, 1].

Este factor es lo que Booster AI ofrece al mundo: **si tu viaje completa un empty-leg, tanto el carrier ahorra combustible como el shipper reduce emisiones**. Ambos ganan.

### 5. Generar ofertas

Dado el ranking:

1. Tomar los **top N** carriers (N configurable, default 3)
2. Enviar oferta simultánea a los top N con ventana de aceptación de 3-10 min
3. **First acceptance wins**: el primero en aceptar obtiene el trip; a los otros se notifica "ya asignado"
4. Si ninguno acepta en la ventana → tomar siguientes N
5. Si la lista se agota → fallback a búsqueda ampliada o notificar al shipper

### 6. Auditabilidad obligatoria

Cada ejecución del matching guarda en `matching_decisions`:

```json
{
  "cargo_request_id": "...",
  "executed_at": "2026-04-23T10:00:00Z",
  "carriers_evaluated": 47,
  "carriers_filtered_out": 42,
  "filter_reasons": {
    "capacity_mismatch": 25,
    "type_mismatch": 12,
    "rating_below_threshold": 5
  },
  "top_candidates": [
    {
      "carrier_id": "...",
      "score": 0.87,
      "breakdown": {
        "proximity": 0.9,
        "empty_leg": 1.0,
        "rating": 0.8,
        "historical_success": 0.95,
        "vehicle_match_quality": 0.7,
        "price_affinity": 0.5
      },
      "offered_at": "2026-04-23T10:00:05Z"
    }
  ],
  "algorithm_version": "v1.0.0"
}
```

Si un carrier pregunta "¿por qué no recibí esa oferta?" → consulta esta tabla → respuesta con evidencia.

### 7. Determinismo bajo tie-breaking

Si dos carriers tienen score idéntico hasta epsilon, el tiebreaker es:
1. Carrier con menos `open_trips` activos
2. Carrier con rating más alto
3. Carrier con menor UUID (último recurso — consistente pero arbitrario)

Nunca tiebreak con `Math.random()` — pierde determinismo y auditabilidad.

### 8. Versionado del algoritmo

Cada PR que cambia scoring o filtros debe:
- Bump de `algorithm_version` (semver)
- ADR corto explicando el cambio
- A/B test en shadow mode antes del rollout (correr ambas versiones en paralelo, comparar decisiones)

## Common Rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Uso random para diversificar ofertas" | Rompe determinismo, auditoría, A/B tests. Usar shuffle determinístico con seed por cargo_request_id. |
| "Hard-codeo umbrales de filtrado" | Config en `packages/config` con env vars. Cambios requieren deploy pero quedan versionados. |
| "No guardo breakdown del score, solo el winner" | Sin breakdown no hay explicabilidad. El log es MÁS importante que la decisión. |
| "Skippeo fallback si no hay candidatos" | Deja al shipper sin respuesta. Siempre hay camino: relajar filtros, ampliar geo, notificar admin. |

## Red Flags

- Algoritmo que produce resultados distintos con mismos inputs (fuente no-determinística dentro)
- Factor de scoring sin peso explícito en config
- Cambio de pesos sin ADR
- Tests de unidad < 95% coverage en `packages/matching-algorithm`
- Decisión sin registro en `matching_decisions`

## Exit Criteria

- [ ] Algoritmo vive en `packages/matching-algorithm` como funciones puras
- [ ] Filtros duros antes del scoring
- [ ] Scoring multifactor normalizado y ponderado
- [ ] Empty-leg detection implementada y testeada con casos reales
- [ ] Cada ejecución persiste en BigQuery `matching_decisions`
- [ ] Tests con coverage ≥95% + fixtures de casos edge
- [ ] Algorithm version bumped en cada cambio
- [ ] Shadow A/B documentado antes de rollout

## Referencias

- [ADR-004 Modelo Uber-like](../../docs/adr/004-uber-like-model-and-roles.md) — matching carrier-based
- [ADR-005 Telemetría IoT](../../docs/adr/005-telemetry-iot.md) — vehicle-availability-events
- Uber's dispatch system (public overview): https://eng.uber.com/matching/
