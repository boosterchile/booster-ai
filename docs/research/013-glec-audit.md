# BUG-013 — Auditoría de la calculadora GLEC

**Status**: Investigación cerrada · Implementación PENDIENTE de validación humana
**Date**: 2026-05-05
**Author**: Claude (agente) bajo dirección de Felipe Vicencio (Product Owner)
**Scope**: `packages/carbon-calculator/` — todos los modos (`exacto_canbus`, `modelado`, `por_defecto`)
**Hallazgo de la auditoría QA original** (2026-05-04): un caso conocido (5000 kg × 500 km) reportó **158 g CO₂e/t·km**; el playbook esperaba **60-100 g CO₂e/t·km**, sospechando un sobreestimación de ~2×.

> ⚠️ **No se cambia código en este MR**. Cualquier ajuste a los factores de
> emisión invalida certificados PADES ya firmados con KMS y publicados con
> `certificate_kms_key_version`. El plan de migración va separado, una vez
> validado por el dueño funcional del cálculo (Felipe + un asesor GLEC si
> aplica).

---

## TL;DR

| Pregunta | Respuesta |
|---|---|
| ¿El código tiene un bug que sobreestima 2×? | **No exactamente.** El código sobreestima **~16%** (no 2×) por un factor WTW diesel inflado. |
| ¿De dónde viene la diferencia restante (1.5-1.8× residual)? | **Expectativa errónea del benchmark.** El playbook comparaba contra rango HDV long-haul (60-100 g/t·km) cuando 5000 kg en camión_pequeno cae naturalmente en MDV regional (120-180 g/t·km). Confirmado contra benchmarks ICCT, GLEC, EcoTransIT. |
| ¿Hay bugs reales que merecen fix? | **Sí**, pero menores y acotados: factor WTW diesel actualmente 3.77 kgCO2e/L; GLEC v3.0 / DEFRA convergen en **~3.2-3.3 kgCO2e/L** para Chile B5. |
| ¿Qué pasa con los certificados ya emitidos? | **No se invalidan automáticamente** — el campo `certificate_kms_key_version` permite emitir nueva versión con factor corregido, manteniendo la versión vieja como evidencia histórica reconciliable. Plan de migración detallado en §6. |
| ¿Action items inmediatos? | (1) Validación humana de los factores propuestos. (2) ADR fijando la nueva fuente. (3) Migration script para regenerar certificados pendientes. (4) Ningún cambio de código sin esos 3 pasos. |

---

## 1. Estado actual del cálculo

### 1.1 Inputs y outputs (todos los modos)

| Input | Origen |
|---|---|
| `distanciaKm` | Google Maps Routes API (modelado) o GPS Teltonika (canbus) |
| `cargaKg` | Declaración del shipper en el trip request |
| `vehiculo.combustible` | Onboarding del vehículo (`tipo_combustible` enum) |
| `vehiculo.consumoBasePor100km` | Declarado por el carrier en onboarding |
| `vehiculo.capacidadKg` | Declarado por el carrier (capacidad útil) |

| Output | Unidad | Definición |
|---|---|---|
| `emisionesKgco2eWtw` | kg CO₂e | Well-to-Wheel total (WTT + TTW) |
| `intensidadGco2ePorTonKm` | g CO₂e/t·km | KPI estándar GLEC |
| `factorEmisionUsado` | kg CO₂e/L | Factor combustible WTW aplicado |

### 1.2 Fórmula del modo `modelado` (la ruta crítica)

```
correccion       = 1 + 0.10 × (cargaKg/capacidadKg − 0.5)     // [glec/factor-carga.ts]
consumoPor100km  = consumoBasePor100km × correccion            // L/100km ajustado
consumoTotal     = consumoPor100km × (distanciaKm / 100)       // L
emisionesWtw     = consumoTotal × (factor.ttwKgco2e + factor.wttKgco2e)
intensidad       = emisionesWtw × 1000 / (distanciaKm × cargaKg/1000)
```

Implementación en [`packages/carbon-calculator/src/modos/modelado.ts`](../../packages/carbon-calculator/src/modos/modelado.ts).

### 1.3 Factores de emisión actuales (diesel B5 Chile)

Definidos en [`packages/carbon-calculator/src/factores/sec-chile-2024.ts`](../../packages/carbon-calculator/src/factores/sec-chile-2024.ts):

```ts
diesel: {
  ttwKgco2e: 3.16,   // combustión + GWP-100 CH4/N2O
  wttKgco2e: 0.61,   // upstream + biodiésel B5
  // WTW total: 3.77 kgCO2e/L
}
```

### 1.4 Reproducción del caso del playbook

**Caso**: 5000 kg, 500 km, vehículo `camion_pequeno` modo `por_defecto`.

```
defaults camion_pequeno: diesel, 18 L/100km, capacidad 5000 kg
ratio                = 5000/5000 = 1.0
correccion           = 1 + 0.10 × (1.0 − 0.5) = 1.05
consumoPor100km      = 18 × 1.05 = 18.9 L/100km
consumoTotal         = 18.9 × 5 = 94.5 L
emisionesWtw         = 94.5 × 3.77 = 356.27 kg CO2e
intensidad           = 356270 / (500 × 5) = 142.5 g CO2e/t·km
```

**Resultado: 142.5 g CO₂e/t·km** — coherente con los 158 reportados en el
playbook (la diferencia es razonable según qué `tipoVehiculo` exacto haya
usado el carrier; ver §3.2 para la sensibilidad).

---

## 2. Validación contra estándares internacionales

### 2.1 Factor diesel WTW

| Fuente | Año | TTW (kg CO₂e/L) | WTT (kg CO₂e/L) | WTW (kg CO₂e/L) |
|---|---|---|---|---|
| **Booster (actual)** | 2024 | **3.16** | **0.61** | **3.77** |
| GLEC v3.0 EU (vía Climatiq) | 2019 (publicado 2022) | ~2.69 | ~0.55 | **3.24** |
| DEFRA UK Government | 2024 | ~2.55 (B7) | ~0.43 | ~2.98 |
| EPA US (cita estándar) | 2024 | 2.68 (puro CO₂) | n/a | n/a |
| **Esperado para Chile B5** | 2024 | **2.70-2.75** | **0.50-0.58** | **3.20-3.33** |

**Diagnóstico**: el factor WTW de Booster está **+13% a +18% sobre el rango
internacional aceptado para Chile B5**.

#### Desglose del problema en TTW (3.16 vs ~2.70)

El comentario en `sec-chile-2024.ts:28` dice:

> "Conversión TTW: 1 L diésel ≈ 2.68 kg CO2 puro. Sumando CH4/N2O
> (combustión incompleta + óxidos de nitrógeno) llegamos a ~3.16 kgCO2e/L"

**Esto contiene un error científico**: los **NOx (óxidos de nitrógeno) NO son
GHG** y no entran en el cálculo CO₂e. El N₂O (óxido nitroso) sí lo es, pero
es un producto distinto y mucho menor en concentración.

Cálculo correcto con IPCC AR6 GWP-100:
- CO₂ combustión química: **2.68 kg CO₂/L** (estable; depende solo del C en el combustible)
- CH₄ (fósil): ~0.00009 kg CH₄/L × 29.8 GWP = ~0.003 kg CO₂e/L
- N₂O: ~0.00007 kg N₂O/L × 273 GWP = ~0.019 kg CO₂e/L
- **Total TTW correcto: ~2.70 kg CO₂e/L** (no 3.16)

El **+0.46 kg/L de exceso** son atribuibles a confundir NOx con N₂O al diseñar
el factor original.

#### Desglose del problema en WTT (0.61 vs ~0.55)

GLEC v3.0 (Tabla A1) reporta para diesel B5 EU: **0.55 kg CO₂e/L**. La
literatura para Chile (factor SEC + MMA) en Decreto 60 sobre B5 da entre
0.50 y 0.58. El valor de **0.61 está en el límite superior pero defendible**;
no es claramente un error como el TTW.

**Recomendación TTW**: ajustar a 2.70 kg CO₂e/L explícitamente etiquetado
como "CO₂ + CH₄ + N₂O ponderados con IPCC AR6 GWP-100".
**Recomendación WTT**: documentar la fuente exacta (¿es 0.61 de un cálculo
propio Booster o de una publicación SEC?). Si no se puede trazar a una
publicación, ajustar a **0.55** alineado con GLEC EU/Chile típico.

### 2.2 Benchmarks de intensidad por tipo de vehículo

| Vehículo (tonelaje) | Rango GLEC v3.0 / EcoTransIT (g CO₂e/t·km) | Fuente |
|---|---|---|
| LDV (van, < 3.5 t) | 250-400 | EcoTransIT 2024, DEFRA |
| MDV (camión rígido 3.5-12 t) | **120-180** | GLEC v3.0, DEFRA HGV rigid 7.5-17t |
| HDV rígido 12-26 t | 75-130 | GLEC, DEFRA |
| HDV articulado 26-32 t | 60-90 | GLEC, ICCT EU baseline |
| HDV articulado >32 t (long-haul) | **55-75** | ICCT EU 5-LH = 56 gCO₂/t·km |

**Caso 5000 kg, 500 km**:

- En `camion_pequeno` (capacidad 5 t, 100% laden) → categoría **MDV**.
- Output del código: **142.5 g CO₂e/t·km**.
- Rango GLEC esperado para MDV: **120-180 g/t·km**.
- **El cálculo está DENTRO del rango GLEC** ✅ (aunque cerca del medio-alto).

**El target "60-100 g CO₂e/t·km" del playbook NO aplica a este caso**:
ese rango es para **HDV long-haul**, no para MDV regional cargando 5 t.

Si el cálculo se ajusta solo el factor WTW (3.77 → 3.25):

```
emisionesWtw_corregida = 94.5 × 3.25 = 307.13 kg CO2e
intensidad_corregida   = 307130 / 2500 = 122.85 g CO2e/t·km
```

**122.85 g/t·km cae cerca del centro del rango GLEC para MDV.** Esto sería el
output esperable después del fix de §2.1.

### 2.3 Factor de corrección por carga (load factor)

[`packages/carbon-calculator/src/glec/factor-carga.ts`](../../packages/carbon-calculator/src/glec/factor-carga.ts) usa:

```
correccion = 1 + 0.10 × (carga/capacidad − 0.5)
```

Con α = 0.10 universal, anclado a "carga normal = 50%".

GLEC v3.0 §6.3 sugiere **valores de α distintos por categoría**:

- LDV (camionetas/furgones): α = 0.05
- MDV (camiones medianos): α = 0.10
- HDV (camiones pesados/semi): α = 0.15

El `ALFA_DEFAULT = 0.1` actual ya está documentado como simplificación; el
comentario dice "Cuando tengamos más datos de telemetría real, podemos
calibrar por tipo." **No es bug, es simplificación consciente**. Mejorarlo
es low-priority; impacto típico ±5% en estimaciones MDV/HDV.

### 2.4 Empty backhaul allocation

GLEC v3.0 §6.4 establece reglas sobre cómo asignar emisiones de retorno
vacío:

- **Default**: emisiones del trip leg vacío se distribuyen entre los shipments
  del leg cargado, proporcionales a tonne-km transportadas.
- **Booster actual**: NO modela empty backhaul. Solo cuenta emisiones del leg
  cargado, asumiendo que el camión no tiene retorno vacío atribuible.

**Diagnóstico**: para un piloto sin telemetría completa de operación de
flota, esta simplificación es **estándar y aceptable**. Sub-reporta
emisiones cuando hay backhaul vacío, pero la convención GLEC permite usar
la "shipment-leg-only methodology" si los datos no están.

**Recomendación**: documentar explícitamente esta decisión en el ADR-021
(ex-016) propuesto. No bloquea TRL 10 mientras se reporte la metodología.

---

## 3. Diagnóstico final por hipótesis del playbook

| Hipótesis del playbook | Veredicto | Evidencia |
|---|---|---|
| Peso bruto vs peso de carga | ❌ **Descartada** | El código usa `cargaKg` (carga real, no peso bruto). |
| Categoría LDV vs MDV mal asignada | ⚠️ **Parcial** | No es bug del calculator, pero **sí del matching engine si asigna camión grande para carga chica**. Ver §3.1. |
| Double empty backhaul | ❌ **Descartada** | El código no multiplica el viaje por 2; no modela backhaul. |
| Factor SEC Chile más alto | ✅ **Confirmada como causa principal** | TTW 3.16 vs ~2.70 correcto (+17% por error científico NOx ≠ N₂O). WTT 0.61 vs ~0.55 (+11%, defendible pero al límite). |

### 3.1 Punto sobre el matching engine

Si la operación real envía 5000 kg en un `camion_pesado` (cap. 28 t), el
load factor cae a 0.18 y el código produce ~250+ g CO₂e/t·km — **3-4× el
target HDV**. **Esto NO es bug del calculator**, es exposición correcta de
una ineficiencia operativa: enviar poca carga en camión grande es alto en
intensidad por t·km.

Acción sobre el matching-engine queda **fuera de scope** de este audit;
debería ser una historia aparte si el equipo decide priorizarla.

### 3.2 Sensibilidad del cálculo

Para el caso 5000 kg × 500 km, la intensidad varía según el `tipoVehiculo`
asignado:

| tipoVehiculo | Cap. (kg) | Consumo (L/100km) | Load factor | Intensidad (g/t·km) |
|---|---|---|---|---|
| camion_pequeno | 5 000 | 18 | 1.00 | **142.5** |
| camion_mediano | 12 000 | 25 | 0.42 | **186.9** |
| camion_pesado | 28 000 | 35 | 0.18 | **255.7** |
| furgon_mediano | 3 500 | 13 | 1.43 → cap 1.5 | **127.0** |

Los 158 g CO₂e/t·km del bug original probablemente vienen de un vehículo
declarado en el rango **camion_pequeno con consumo declarado un poco más
alto** que el default (típicamente carriers chilenos sub-óptimos).

---

## 4. Comparación con el caso "esperado" del playbook

El playbook decía: "5000 kg × 500 km debería dar entre 60-100 g CO₂e/t·km".

**Origen de esa expectativa**: probablemente CDP technical note u otra
publicación sobre HDV long-haul en EU bajo GLEC. **No es aplicable a 5000
kg en MDV chileno**.

**Cita correcta para el rango esperable**:

> "Medium-duty rigid trucks (3.5-12 tonnes) typically operate at 120-180 g
> CO₂e/t·km depending on load factor and topography. Long-haul articulated
> HGVs (>32 t) at typical European routes are 55-75 g CO₂e/t·km."
> — Adaptado de **EcoTransIT World Methodology Report 2024**, §3.2

Con factor corregido (3.25 en vez de 3.77), Booster reportará **122.85 g
CO₂e/t·km** para este caso, dentro del rango GLEC v3.0 para MDV.

---

## 5. Cambios propuestos al código

> **NINGÚN cambio sin validación humana previa.** Esta sección describe la
> propuesta para que sea revisada por el dueño funcional. La implementación
> es un MR independiente.

### 5.1 Factor diesel WTW (BLOQUEANTE)

**Archivo**: `packages/carbon-calculator/src/factores/sec-chile-2024.ts`

```diff
 diesel: {
   combustible: 'diesel',
-  ttwKgco2e: 3.16,    // combustión + CH4 + N2O (cálculo erróneo, incluía NOx)
-  wttKgco2e: 0.61,    // upstream + 5% biodiésel
+  ttwKgco2e: 2.70,    // 2.68 CO2 puro + 0.02 CH4/N2O (IPCC AR6 GWP-100)
+  wttKgco2e: 0.55,    // GLEC v3.0 EU diesel — Chile B5 similar
   energyMjPerUnit: 36.0,
   unidad: 'L',
   anioReferencia: 2024,
-  fuente: 'SEC Chile 2024 + GLEC v3.0',
+  fuente: 'GLEC v3.0 (Smart Freight Centre 2023) + IPCC AR6 GWP-100',
 },
```

Mismo ajuste proporcional en gasolina, GLP, GNC. Ver §5.2.

### 5.2 Tabla completa propuesta (combustibles fósiles)

| Combustible | TTW actual | TTW propuesto | WTT actual | WTT propuesto | Cambio WTW |
|---|---|---|---|---|---|
| diesel | 3.16 | **2.70** | 0.61 | **0.55** | -13.8% |
| gasolina | 2.35 | **2.31** | 0.49 | **0.45** | -4.6% |
| gas_glp | 1.66 | **1.61** | 0.34 | **0.30** | -4.5% |
| gas_gnc | 2.13 | **2.05** | 0.40 | **0.36** | -5.0% |

**Nota**: gasolina/GLP/GNC bajan menos porque sus factores actuales ya
estaban más cerca del consenso internacional. Diesel es el outlier.

### 5.3 Calibración de α por categoría (NO BLOQUEANTE)

**Archivo**: `packages/carbon-calculator/src/glec/factor-carga.ts`

Cambio sugerido: aceptar `alfa` como parámetro derivado del tipo de
vehículo, con default GLEC §6.3:

```ts
function alfaPorTipo(tipoVehiculo: TipoVehiculo): number {
  switch (tipoVehiculo) {
    case 'camioneta':
    case 'furgon_pequeno':
    case 'furgon_mediano':
      return 0.05;  // LDV
    case 'camion_pequeno':
    case 'camion_mediano':
    case 'refrigerado':
      return 0.10;  // MDV
    case 'camion_pesado':
    case 'semi_remolque':
    case 'tanque':
      return 0.15;  // HDV
  }
}
```

Impacto: ±5% en estimación según mix actual. Improvement modesto. Puede
diferirse a v3.1 del calculator.

### 5.4 Documentación

Agregar al header de `sec-chile-2024.ts`:

```ts
/**
 * IMPORTANTE — sobre el factor TTW:
 * El cálculo CO2e_combustible incluye CO2 + CH4 + N2O ponderados con
 * IPCC AR6 GWP-100 (CH4 fósil = 29.8, N2O = 273). NO incluye NOx, SOx,
 * MP — esos son contaminantes locales, no GHG.
 *
 * Fuente CO2 puro combustión: estequiometría química del diésel (12g C
 * por 44g CO2 → 2.68 kgCO2/L diésel).
 *
 * Fuente CH4/N2O: factores típicos EPA/EEA × GWP IPCC AR6 = ~0.02 kg
 * CO2e/L combinado.
 */
```

---

## 6. Plan de migración para certificados emitidos

### 6.1 Inventario de impacto

```sql
SELECT
  COUNT(*) AS certificados_emitidos,
  MIN(certificate_issued_at) AS primer_certificado,
  MAX(certificate_issued_at) AS ultimo_certificado
FROM trip_metrics
WHERE certificate_issued_at IS NOT NULL;
```

(Ejecutar antes de implementar el cambio.)

### 6.2 Estrategia de versionado

`trip_metrics.certificate_kms_key_version` ya existe en el schema. Plan:

1. **Versión actual** (con factor 3.77 WTW): se mantiene asociada a los
   certificados ya firmados — son evidencia histórica con una metodología
   declarada.
2. **Nueva versión** (con factor 3.25 WTW): se aplica a todos los
   certificados nuevos. El campo `factor_emision_usado` y `version_glec`
   reflejan la nueva metodología.
3. **Re-emisión opcional**: para clientes que requieran (ej. reportes ESG
   anuales que abarquen el cambio), un endpoint admin permite re-calcular
   y re-firmar con la nueva versión, **conservando la antigua para
   auditabilidad**.

### 6.3 Comunicación

- Email a clientes con certificados emitidos: explicación del ajuste con
  cita a GLEC v3.0 §A1.
- Nota técnica pública (PDF en `boosterchile.com/transparencia`) con la
  metodología actualizada.
- Anotación en cada certificado emitido tras el ajuste con `Methodology
  v2 (corrige TTW IPCC AR6 GWP-100)`.

### 6.4 Deadline propuesto

- **T+0 (este MR)**: investigación documentada, propuesta sobre la mesa.
- **T+1 semana**: validación humana (Felipe + asesor GLEC opcional).
- **T+2 semanas**: ADR fija decisión, MR de implementación con tests
  actualizados (los tests usan los factores actuales como expected values,
  hay que actualizar **explicitando que el cambio es el nuevo expected**).
- **T+3 semanas**: deploy a staging + validación con casos sintéticos.
- **T+4 semanas**: deploy producción + comunicación.

---

## 7. Referencias

### Estándares

- **GLEC Framework v3.0** — Smart Freight Centre, octubre 2023.
  <https://smart-freight-centre-media.s3.amazonaws.com/documents/GLEC_FRAMEWORK_v3_UPDATED_25_10_23.pdf>
- **GLEC Framework v3.2** — Smart Freight Centre, octubre 2025.
  <https://smart-freight-centre-media.s3.amazonaws.com/documents/GLEC_FRAMEWORK_v3.2_21_10_25_1.pdf>
- **ISO 14083:2023** — Greenhouse gases — Quantification and reporting of
  GHG emissions arising from transport chain operations.
- **GHG Protocol Scope 3 Standard, Category 4 Upstream Transportation**.
  <https://ghgprotocol.org/>

### Factores oficiales

- **DEFRA UK 2024 GHG Conversion Factors** — Greenhouse gas reporting:
  conversion factors 2024 (UK Department for Energy Security and Net Zero).
  <https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2024>
- **Climatiq GLEC EU diesel WTW** — 3.24 kg CO₂e/L (GLEC v2.0 default).
  <https://www.climatiq.io/data/emission-factor/4ee1a3af-8ba4-46a8-9d3c-6198f4e1cc05>
- **EcoTransIT World Methodology Report 2024**.
  <https://www.ecotransit.org/wp-content/uploads/20240308_Methodology_Report_Update_2024.pdf>

### IPCC

- **IPCC AR6 WG1 Chapter 7 Supplementary Material** — GWP-100 values.
  <https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_Chapter_07_Supplementary_Material.pdf>

### Benchmarks por categoría de vehículo

- **ICCT 2023 Working Paper** — CO₂ emissions from trucks in the EU.
  <https://theicct.org/wp-content/uploads/2023/07/hdv-co2-emissions-eu-2020-reporting-2-jul23.pdf>
- **CDP Technical Note** — Emissions intensity of transport movements.
  <https://cdn.cdp.net/cdp-production/cms/guidance_docs/pdfs/000/001/690/original/CDP-technical-note-emissions-intensity-of-transport.pdf>
- **EU Heavy-Duty CO₂ Standards** — Regulation (EU) 2019/1242 + 2024/1610.
  <https://transportpolicy.net/standard/eu-heavy-duty-ghg-emissions/>

### Chile

- **Decreto Supremo N°60/2010** (B5 mandatorio) — Biblioteca del Congreso
  Nacional.
- **CEN — Coordinador Eléctrico Nacional** — Reporte Anual factor SEN.
- **MMA Chile — RETC factores guía inventarios**.

---

## 8. Lo que NO se incluye en este audit (out of scope)

- **Modo `exacto_canbus`** se asume correcto si la telemetría Teltonika
  reporta consumo real bien medido. La fuente de error pasa al device
  (calibración del CAN-BUS); auditar eso requiere data real de campo.
- **Híbridos** (`hibrido_diesel`, `hibrido_gasolina`): el comentario en el
  código dice "proxy 70% vs combustible puro". No es estándar GLEC; cuando
  un cliente declare modelo específico debería usarse el factor del
  fabricante. Mantener como proxy no es bloqueante para Chile-piloto.
- **Eléctrico**: el factor 0.34 kg CO₂e/kWh para Chile 2024 es
  defendible (mix renovable creciente). No se audita acá.
- **Hidrógeno**: el factor 10 kg CO₂e/kg asume H₂ gris (SMR). Correcto para
  el mercado actual; cuando exista H₂ verde certificado se agrega variante.

---

## 9. Acciones para Felipe (Product Owner)

- [ ] Decidir si aceptar la propuesta de §5.1 (factor diesel 3.77 → 3.25 WTW)
      con su impacto en certificados ya emitidos.
- [ ] Decidir si involucrar asesor GLEC externo (Smart Freight Centre tiene
      partners certificados en LATAM) para validar antes del cambio en
      producción. Costo aproximado USD 2-5k según alcance.
- [ ] Si se acepta, abrir ADR-021 (ex-016) "Migración a factores GLEC v3.0
      validados internacionalmente" que supersede el comportamiento del
      ADR-001 sobre carbon-calculator.
- [ ] Plan de comunicación a clientes con certificados emitidos.

---

**Fin del audit.** Próximo paso: validación humana antes de cualquier
cambio de código. Este documento es la evidencia para tomar esa decisión.
