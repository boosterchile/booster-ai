# BUG-013 — Cifra de emisiones ESG ~2× la referencia GLEC

| | |
|---|---|
| **Severidad** | 🟡 Investigar (impacto regulatorio si se publica) |
| **Componente** | cálculo de `carbon_emissions_kgco2e_estimated` |
| **Detectado** | 2026-05-04 |

## Datos observados

Carga `BOO-4XZH2K` (GET `/trip-requests-v2/<id>`):

```json
{
  "cargo_weight_kg": 5000,
  "vehicle_type": "camion_pequeno",
  "metrics": {
    "distance_km_estimated": "500.00",
    "carbon_emissions_kgco2e_estimated": "395.850",
    "precision_method": "modelado",
    "glec_version": "v3.0"
  }
}
```

## Cálculo

```
395.85 kg CO₂e / (500 km × 5 t) = 0.158 kg CO₂e/t·km = 158 g CO₂e/t·km
```

## Referencia GLEC v3.0 (factores default)

| Categoría | g CO₂e/t·km |
|---|---|
| LDV (Light Duty < 3.5t) | 90–180 |
| MDV (Medium Duty 3.5–12t) | 60–100 |
| HDV (Heavy Duty > 12t) | 50–80 |

Un "camión pequeño" con 5.000 kg de capacidad y combustible diésel suele
caer en MDV (peso bruto típico 6–7 t). El valor esperado debería estar en
**60–100 g/t·km**, no en 158.

## Hipótesis no probadas

1. **Peso bruto en lugar de peso de carga**: si el cálculo divide por
   (peso_carga + peso_vacío_vehículo), el denominador se infla pero el
   numerador (que mira combustible) no cambia → resultado más alto. Eso
   sería **incorrecto** en GLEC: la unidad es `g CO₂e por t·km de carga
   transportada`.
2. **Empty backhaul incluido**: GLEC permite un factor para vuelta vacía,
   pero 158 g/t·km parece muy alto incluso así.
3. **Factor SEC Chile 2024 más alto**: el mix energético chileno o el
   factor específico para diésel B5 podría inflar la cifra. Vale verificar
   contra el documento oficial del SEC.
4. **Categoría wrong**: si se está aplicando factor LDV (camionetas) a un
   MDV, sale ~150 g/t·km, que coincide.

## Impacto

Los certificados se firman criptográficamente y son verificables
públicamente. Si se publican cifras inconsistentes, hay riesgo:
- **Regulatorio**: SEC Chile pide fidelidad GLEC.
- **Reputacional**: clientes con compromisos ESG (Pacto Global, SBTi)
  comparan con benchmarks; valor 2× los hace dudar.

## Acción sugerida

1. Auditar la fórmula con un caso conocido (Excel con SEC Chile 2024).
2. Validar contra la herramienta oficial GLEC tool si aplica.
3. Si se confirma error, regenerar certificados ya emitidos.
4. Agregar un test que genere una carga sintética y valide que la cifra
   queda dentro del rango GLEC para esa categoría.
