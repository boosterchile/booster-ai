# FIX-013 — Auditoría del cálculo de emisiones GLEC

> **Severidad**: 🟡 (puede ser 🔴 si se publican certificados con cifras incorrectas)
> **Issue**: [../issues/013-emisiones-glec.md](../issues/013-emisiones-glec.md)
> **Test**: tests funcionales sobre el cálculo (ver §5)

## 1. Resumen

Datos de la carga `BOO-4XZH2K`:
- Carga: 5.000 kg
- Distancia estimada: 500 km
- Emisiones estimadas: 395.85 kg CO₂e
- Cálculo: **158 g CO₂e/t·km**

GLEC v3.0 referencia para MDV diesel cargado: **60–100 g/t·km**.
La cifra observada es ~2× el rango esperado.

Este playbook es de **investigación + corrección**. Antes de tocar nada,
hay que entender la fórmula actual.

## 2. Localización

```bash
# Buscar el cálculo de emisiones
grep -rn "carbon_emissions\|kgco2e\|co2e\|emission_factor\|tco2e" \
  apps/ src/ packages/ --include="*.ts"

# Buscar factores GLEC
grep -rn "GLEC\|SEC.*Chile\|emission_factor.*diesel\|g_per_tkm" \
  apps/ src/ packages/ --include="*.ts" --include="*.json"

# Endpoints de cálculo
grep -rn "/metrics\|calculateEmissions\|computeFootprint" \
  apps/ src/ packages/ --include="*.ts"
```

## 3. Plan de auditoría

### Paso 1: documentar la fórmula actual

Revisar el código y escribir en plain text qué hace exactamente:
- ¿Toma peso de carga o peso bruto?
- ¿Qué factor de emisión aplica para `camion_pequeno`?
- ¿Considera empty backhaul? ¿Con qué factor?
- ¿Usa SEC Chile 2024 o IPCC default?
- ¿En qué punto del lifecycle hace el cálculo?

Anotar en `docs/glec-implementation.md`.

### Paso 2: comparar con la spec GLEC v3.0

Documento oficial: <https://www.smartfreightcentre.org/en/glec-framework/>

Para MDV (3.5–12 t) diesel cargado:
- WTW (well-to-wheel): ~60–100 g CO₂e/t·km a carga típica.
- TTW (tank-to-wheel) solo: ~50–80.

Si el cálculo da 158 g/t·km, hipótesis:
- a) **División por peso de carga vs peso bruto**: error de 2× típico.
- b) **Categoría LDV en lugar de MDV**: factores LDV son ~150 g/t·km.
- c) **Empty return doblado**: si se aplica un factor de retorno vacío
  agregado al WTW que ya lo incluye, queda 2×.
- d) **kg vs tonelada**: si el peso se ingresa en kg y el factor espera
  toneladas, el resultado puede salir por orden de magnitud (más probable
  10× o 1000×, no 2×).

### Paso 3: caso de prueba conocido

Crear un test de fórmula con un caso de la herramienta oficial de GLEC:

```ts
// packages/emissions/src/calculate.test.ts
import { calculateEmissions } from './calculate';

describe('calculateEmissions — GLEC v3.0', () => {
  // Caso de la spec: MDV diesel, 1000 km, 10 t carga, 60% load factor.
  test('MDV diesel cargado al 60%, 1000km × 10t → ~80 g/tkm', () => {
    const result = calculateEmissions({
      vehicle_type: 'camion_mediano',
      fuel_type: 'diesel',
      distance_km: 1000,
      cargo_weight_kg: 10000,
      load_factor: 0.6,
    });
    const gPerTkm = (result.kgCo2e * 1000) / (result.distance_km * result.cargo_weight_t);
    expect(gPerTkm).toBeGreaterThan(60);
    expect(gPerTkm).toBeLessThan(100);
  });

  // Caso reportado: camion_pequeno, 500km × 5t.
  test('camion_pequeno 500km × 5t debe dar entre 60-100 g/tkm', () => {
    const result = calculateEmissions({
      vehicle_type: 'camion_pequeno',
      fuel_type: 'diesel',
      distance_km: 500,
      cargo_weight_kg: 5000,
    });
    const gPerTkm = (result.kgCo2e * 1000) / (500 * 5);
    expect(gPerTkm).toBeGreaterThanOrEqual(60);
    expect(gPerTkm).toBeLessThanOrEqual(120);  // 120 con margen para Chile
  });
});
```

### Paso 4: corregir según hallazgo

Tras identificar la causa:
- (a) si era peso bruto: dividir por peso de carga, no bruto.
- (b) si era categoría: mapear `camion_pequeno` a MDV en la tabla.
- (c) si era doble empty return: revisar el modelo y aplicar solo una vez.
- (d) si era unidad: corregir conversión.

### Paso 5: regenerar certificados ya emitidos (si hubo)

Si ya se firmaron certificados con cifras inflated:
1. Identificar todos los que fueron afectados.
2. Re-calcular con la fórmula corregida.
3. Notificar a los emisores.
4. Re-emitir con nueva versión, link en el certificado a una "errata page"
   con la metodología corregida.

> **Cuidado regulatorio**: si se reportó al SEC con cifras incorrectas,
> consultar con el área legal antes de re-emitir.

## 4. Implementación recomendada

### 4.1 Tabla de factores explícita

```ts
// packages/emissions/src/factors.ts
/**
 * Factores de emisión WTW (well-to-wheel) en g CO₂e por tonelada-kilómetro.
 * Fuente: GLEC Framework v3.0 + ajustes SEC Chile 2024.
 *
 * Estos números son referencias por defecto. Si el vehículo declaró
 * `consumption_l_per_100km_baseline`, se usa el cálculo bottom-up con
 * factor de combustible.
 */
export const GLEC_DEFAULT_FACTORS: Record<VehicleType, Record<FuelType, number>> = {
  camioneta:        { diesel: 180, gasolina: 220, electrico: 50,  hibrido_diesel: 130 },
  furgon_pequeno:   { diesel: 150, gasolina: 190, electrico: 40,  hibrido_diesel: 110 },
  furgon_mediano:   { diesel: 110, gasolina: 140, electrico: 35,  hibrido_diesel: 85  },
  camion_pequeno:   { diesel: 90,  gasolina: 110, electrico: 30,  hibrido_diesel: 70  },
  camion_mediano:   { diesel: 75,  gasolina: 95,  electrico: 25,  hibrido_diesel: 58  },
  camion_pesado:    { diesel: 55,  gasolina: 70,  electrico: 18,  hibrido_diesel: 42  },
  // …
};
```

### 4.2 Función pura testable

```ts
// packages/emissions/src/calculate.ts
import { GLEC_DEFAULT_FACTORS } from './factors';

interface CalculateInput {
  vehicle_type: VehicleType;
  fuel_type: FuelType;
  distance_km: number;
  cargo_weight_kg: number;
  consumption_l_per_100km_baseline?: number; // opcional override bottom-up
  load_factor?: number; // 0-1, default 0.6
}

interface CalculateOutput {
  kgCo2e: number;
  method: 'top_down_glec' | 'bottom_up_consumption';
  factor_g_per_tkm: number;
  cargo_weight_t: number;
  distance_km: number;
}

export function calculateEmissions(input: CalculateInput): CalculateOutput {
  const cargo_weight_t = input.cargo_weight_kg / 1000;

  // Bottom-up si tenemos consumo baseline y combustible
  if (input.consumption_l_per_100km_baseline) {
    const liters = input.consumption_l_per_100km_baseline * (input.distance_km / 100);
    const FUEL_CO2_KG_PER_LITER = { diesel: 2.68, gasolina: 2.31, /* … */ };
    const kgCo2e = liters * FUEL_CO2_KG_PER_LITER[input.fuel_type];
    return {
      kgCo2e,
      method: 'bottom_up_consumption',
      factor_g_per_tkm: (kgCo2e * 1000) / (input.distance_km * cargo_weight_t),
      cargo_weight_t,
      distance_km: input.distance_km,
    };
  }

  // Top-down con factor GLEC
  const factor = GLEC_DEFAULT_FACTORS[input.vehicle_type]?.[input.fuel_type];
  if (factor == null) {
    throw new Error(`No hay factor para ${input.vehicle_type} + ${input.fuel_type}`);
  }
  const kgCo2e = (factor * cargo_weight_t * input.distance_km) / 1000;
  return {
    kgCo2e,
    method: 'top_down_glec',
    factor_g_per_tkm: factor,
    cargo_weight_t,
    distance_km: input.distance_km,
  };
}
```

## 5. Verificación

```bash
npm run test -- emissions/calculate
```

### Validación cruzada

Tomar 3 cargas históricas, recalcular manualmente con calculadora del SEC,
comparar con el output del nuevo `calculateEmissions`. Tolerar ±5% por
redondeo.

### Frontend

En `/app/cargas/<id>` la sección "Métricas ESG" debería:
- Mostrar `factor_g_per_tkm` (transparencia).
- Indicar `method` ("Modelo GLEC" o "Consumo declarado del vehículo").
- Linkear a `docs/glec-implementation.md` desde "Métricas ESG ⓘ".

## 6. Riesgos

- **Cambio de cifras**: si los certificados se re-emiten, los clientes ESG
  notarán que las cifras bajaron. Comunicación clave: nota técnica
  explicando la corrección, alineación con GLEC v3.0.
- **Alineación regulatoria**: validar con SEC Chile 2024 si su factor
  específico es distinto al GLEC base.

## 7. Definition of Done

- [ ] `docs/glec-implementation.md` documenta la fórmula actual y la nueva.
- [ ] `packages/emissions/` con función pura + tests + tabla de factores.
- [ ] Tests cubren al menos 5 casos conocidos de GLEC.
- [ ] Audit query: cantidad de cargas con `precision_method='modelado'`.
- [ ] Plan de re-emisión de certificados (si aplica).
- [ ] PR linkea a la nota técnica para clientes.
- [ ] Commit `fix(emissions): alinea factores GLEC v3.0 + SEC Chile (BUG-013)`.
