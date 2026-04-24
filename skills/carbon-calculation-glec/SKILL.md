# Skill: Carbon Footprint Calculation (GLEC v3.0)

**Categoría**: core-engineering + compliance
**Relacionado**: ADR-004 modelo Uber-like, ADR-005 telemetría, ADR-007 documentos

## Overview

Booster AI calcula huella de carbono por trip según **Global Logistics Emissions Council Framework v3.0** (GLEC v3.0) y GHG Protocol. La implementación vive en `packages/carbon-calculator` como librería pura, determinística, exhaustivamente testeada. El cálculo es **auditable**: dados los mismos inputs, siempre produce el mismo output; y dada una emisión reportada, se puede re-derivar desde los inputs originales.

## When to Use

- Al escribir nuevos cálculos de emisión
- Al ajustar factores de emisión (nuevos combustibles, nuevos vehicle classes)
- Al debuggear una discrepancia entre certificado ESG emitido y la medición que ve el cliente
- Al actualizar a una nueva versión del GLEC Framework

## Core Process

### 1. Identificar el tipo de cálculo

GLEC v3.0 define emisiones en dos dimensiones:

| Scope GHG | Qué cubre | Método |
|-----------|-----------|--------|
| Scope 1 | Emisiones directas del vehículo (combustible que quema) | **Combustible real** (vía CAN bus Teltonika) si disponible; si no, **distancia × intensity factor** |
| Scope 3 | Emisiones aguas arriba/abajo (producción del combustible, disposición del vehículo, etc.) | Factor GLEC "well-to-tank" multiplicado por consumo |

**Total carbon footprint** = Scope 1 + Scope 3 (GLEC v3.0 los combina).

### 2. Seleccionar método de medición

Orden de prioridad (GLEC recomienda siempre el más preciso disponible):

1. **Actual energy consumption** (preferido): consumo de combustible medido vía CAN bus del Teltonika. Precisión ~95%.
2. **Modelled energy consumption**: consumo estimado con factores de emisión específicos del vehículo (tipo, carga, topografía). Precisión ~80%.
3. **Default energy consumption**: promedio industria por vehicle class GLEC. Precisión ~60%. Usar solo cuando no hay CAN bus ni perfil del vehículo.

Para cada trip, registrar **qué método se usó**. Esto se refleja en el certificado ESG con atributo `precision_method`.

### 3. Identificar factores de emisión

Los factores GLEC v3.0 son tablas publicadas que multiplican consumo/distancia por kg CO2e. Se actualizan periódicamente. Viven en `packages/carbon-calculator/data/`:

```
packages/carbon-calculator/data/
├── glec-v3.0-fuel-factors.json       # kg CO2e / litro por tipo de combustible
├── glec-v3.0-vehicle-intensity.json  # kg CO2e / tonne-km por vehicle class
└── glec-v3.0-well-to-tank.json       # Scope 3 factors
```

**Nunca hard-codear factors en código**. Deben vivir en JSON versionado con fuente+fecha.

### 4. Calcular con función pura

```typescript
// packages/carbon-calculator/src/calculate.ts
export function calculateTripEmissions(input: TripEmissionInput): TripEmissionResult {
  const method = selectMethod(input);
  const scope1 = calculateScope1(input, method);
  const scope3 = calculateScope3(input, method);

  return {
    scope1_kgco2e: scope1,
    scope3_kgco2e: scope3,
    total_kgco2e: scope1 + scope3,
    intensity_kgco2e_per_tonne_km: (scope1 + scope3) / (input.cargo_weight_t * input.distance_km),
    precision_method: method,
    factors_used: {
      fuel_factor: ...,
      vehicle_intensity: ...,
    },
    glec_version: "3.0",
    calculated_at: new Date().toISOString(),
  };
}
```

**Propiedades no negociables**:
- **Pura**: sin side effects, sin I/O, sin `Date.now()` oculto. Recibe timestamp como input si lo necesita.
- **Determinística**: mismo input → mismo output exacto (hasta precisión IEEE 754).
- **Unit-safe**: usar tipos nominales (`Kilograms`, `Kilometers`, etc.) para prevenir errores de unidades.
- **Retorna factores usados**: el output incluye qué factors numéricos se multiplicaron, para auditabilidad.

### 5. Tests deterministas

```typescript
// packages/carbon-calculator/test/calculate.test.ts
import fixtures from './fixtures/reference-trips.json';

describe('calculateTripEmissions', () => {
  test.each(fixtures)('GLEC reference case: $name', (fixture) => {
    const result = calculateTripEmissions(fixture.input);
    expect(result.scope1_kgco2e).toBeCloseTo(fixture.expected.scope1, 2);
    expect(result.scope3_kgco2e).toBeCloseTo(fixture.expected.scope3, 2);
    expect(result.total_kgco2e).toBeCloseTo(fixture.expected.total, 2);
  });
});
```

`fixtures/reference-trips.json` contiene casos publicados por el GLEC Framework (anexos técnicos) + casos propios. **Si un test falla después de cambiar la tabla de factores, NO cambiar el test — abrir conversación con Product Owner y Auditor ESG**.

### 6. Rastreo en BigQuery

Cada cálculo persiste en `bigquery: booster_esg.emissions_calculated`:

```sql
CREATE TABLE emissions_calculated (
  trip_id STRING NOT NULL,
  calculated_at TIMESTAMP NOT NULL,
  glec_version STRING NOT NULL,
  precision_method STRING NOT NULL,
  scope1_kgco2e FLOAT64 NOT NULL,
  scope3_kgco2e FLOAT64 NOT NULL,
  total_kgco2e FLOAT64 NOT NULL,
  intensity FLOAT64,
  inputs_json JSON NOT NULL,
  factors_json JSON NOT NULL
)
PARTITION BY DATE(calculated_at)
CLUSTER BY trip_id;
```

Para auditar: `SELECT * FROM emissions_calculated WHERE trip_id = '<id>'` devuelve el cálculo exacto + todos los factores que se usaron.

### 7. Certificado ESG

Al cerrar el trip, `apps/document-service` genera PDF con:
- Resumen de emisiones
- Método usado (EXACT_CANBUS vs MODELED vs DEFAULT)
- Factores usados (transparencia)
- Hash SHA-256 del cálculo — incluido en el PDF
- Firma digital del PDF con KMS

El hash permite validar meses después que el certificado NO fue alterado.

## Common Rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Uso el promedio de combustible estimado aunque haya CAN bus" | Pierde precisión certificable. Siempre usar el método más preciso disponible. |
| "Factores en código para ir más rápido" | Rompe auditabilidad. Siempre en JSON versionado. |
| "Skippeo el hash en el certificado" | Sin hash, el PDF puede ser alterado sin detección. El auditor ESG exige esto. |
| "Redondeo a entero kg CO2e para que se vea bonito" | Pérdida de precisión. Mantener decimales internos; redondeo solo en display. |

## Red Flags

- Test fixture editado para "que pase" después de cambio de factors
- Cálculo con `Math.random()` o `Date.now()` directo
- Commit que cambia factors JSON sin referenciar fuente GLEC
- Certificado sin `glec_version` o `precision_method`
- Intensidad (kgCO2e/tonne-km) fuera de rango razonable (típico camión pesado: 0.05-0.15)

## Exit Criteria

- [ ] Cálculo vive en `packages/carbon-calculator` como función pura
- [ ] Factors en JSON versionado con fuente GLEC + fecha
- [ ] Test coverage ≥95% (es compliance crítico)
- [ ] Tests usan fixtures con casos de referencia GLEC
- [ ] Cálculo persiste en BigQuery con inputs + factors
- [ ] Certificado PDF incluye hash SHA-256 + glec_version + precision_method
- [ ] Cambios a factors revisados por Sustainability Stakeholder tipo auditor

## Referencias

- GLEC Framework v3.0: https://www.smartfreightcentre.org/en/our-programs/global-logistics-emissions-council/
- GHG Protocol Scope 3 Standard: https://ghgprotocol.org/standards/scope-3-standard
- ISO 14064-2: https://www.iso.org/standard/66454.html
- [ADR-004 Modelo Uber-like](../../docs/adr/004-uber-like-model-and-roles.md) — sección Sustainability Stakeholder
- [ADR-005 Telemetría](../../docs/adr/005-telemetry-iot.md) — CAN bus data
