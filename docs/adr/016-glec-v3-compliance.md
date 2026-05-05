# ADR-016 — GLEC v3.0 compliance + empty backhaul como diferenciador comercial

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes (parcialmente)**: factores y metodología del calculator definidos
implícitamente en ADR-001 (sección "Tooling y testing"). El stack queda
intacto; lo que cambia es cómo aplicamos GLEC en `packages/carbon-calculator/`.
**Related**: [docs/research/013-glec-audit.md](../research/013-glec-audit.md)
(audit que motivó la decisión).

## Contexto

La auditoría QA del 2026-05-04 detectó que un caso conocido (5000 kg × 500
km) reportaba **158 g CO₂e/t·km**, presumiblemente sobreestimado. El
research/013-glec-audit.md verificó esa hipótesis contra estándares
internacionales y encontró:

1. **Bug científico real** en el factor TTW diesel (3.16 kg CO₂e/L) — el
   comentario del código mezclaba **NOx (no es GHG)** con **N₂O (sí es
   GHG)** al sumar al CO₂ puro. Valor correcto según IPCC AR6 GWP-100:
   2.70 kg CO₂e/L.
2. **Factor WTT diesel inflado** (0.61 vs ~0.55 GLEC EU/Chile B5).
3. **Hipótesis del playbook parcialmente errada**: el "60-100 g CO₂e/t·km"
   esperado aplica a HDV long-haul; 5000 kg en camion_pequeno cae
   naturalmente en MDV (120-180 g/t·km según GLEC v3.0, DEFRA UK 2024,
   EcoTransIT 2024).
4. **Empty backhaul allocation NO modelada**, perdiendo el diferenciador
   comercial central de Booster: "marketplace que optimiza retornos vacíos".

El Product Owner confirmó (2026-05-05) que **los certificados emitidos
hasta esta fecha NO tienen validez comercial**, por lo que cualquier cambio
de metodología puede aplicarse sin migración retro-emisiva.

## Decisión

Migrar `packages/carbon-calculator/` a **GLEC Framework v3.0** completo,
con tres ejes:

### 1. Factores de emisión corregidos (compliance)

| Combustible | TTW antes | TTW después | WTT antes | WTT después | WTW antes | WTW después |
|---|---|---|---|---|---|---|
| diesel | 3.16 | **2.70** | 0.61 | **0.55** | 3.77 | **3.25** |
| gasolina | 2.35 | 2.31 | 0.49 | 0.45 | 2.84 | 2.76 |
| gas_glp | 1.66 | 1.61 | 0.34 | 0.30 | 2.00 | 1.91 |
| gas_gnc | 2.13 | 2.05 | 0.40 | 0.36 | 2.53 | 2.41 |
| eléctrico | 0.00 | 0.00 | 0.34 | 0.34 | 0.34 | 0.34 |
| hidrógeno | 0.00 | 0.00 | 10.0 | 10.0 | 10.0 | 10.0 |

Los híbridos siguen como proxy 70% del puro (estándar interno mientras no
haya tracking por modelo).

**Fuentes citadas en el código**:
- GLEC Framework v3.0 (Smart Freight Centre, 2023) Annex A1/A2.
- IPCC AR6 GWP-100 (Tabla 7.SM.7): CH₄ fósil = 29.8, N₂O = 273.
- DEFRA UK 2024 GHG Conversion Factors (cross-check WTW EU).
- Decreto Supremo N°60/2010 Chile (B5 mandatorio).

### 2. Calibración α por categoría LDV/MDV/HDV (precisión, GLEC §6.3)

```
LDV (camioneta, furgón pequeño)            α = 0.05
MDV (furgón mediano, camión pequeño)       α = 0.10
HDV (camión mediano/pesado, semi, etc.)    α = 0.15
```

El helper `categoriaVehiculo(tipoVehiculo)` mapea automáticamente. Backward
compatible: si no se pasa categoría, default `'MDV'` (= comportamiento
legacy con α=0.10).

### 3. Empty Backhaul Allocation (diferenciador comercial, GLEC §6.4)

Nuevo módulo `glec/empty-backhaul.ts` con función pura
`calcularEmptyBackhaul()`. Inputs:

```ts
{
  distanciaRetornoKm: number,    // del leg de retorno
  factorMatching: number,         // [0, 1] — qué fracción Booster cubrió
  consumoBasePor100km: number,
  combustible: TipoCombustible,
  capacidadKg: number,
  categoria?: 'LDV' | 'MDV' | 'HDV',
}
```

Outputs:
- `emisionesKgco2eWtw`: kg CO₂e atribuibles al shipment del leg vacío
  (descontando lo que el matching cubrió).
- `ahorroVsSinMatchingKgco2e`: cuánto se ahorró vs el caso "camión vuelve
  100% vacío". **Esta métrica es el storytelling comercial de Booster**:
  se puede comunicar al shipper como el ahorro CO₂e que Booster aporta a
  su Scope 3.

`ResultadoEmisiones.backhaul` (opcional) se popula automáticamente cuando
el caller pasa `params.backhaul`. Si no, queda `undefined` (compat).

## Por qué esto > "solo arreglar factores"

Reparar los factores resuelve un bug (-13.8% en lo reportado). Lo
verdaderamente diferencial es:

> **Booster es el único marketplace de logística sostenible en Chile que
> reporta el ahorro de CO₂e generado por el matching de retorno, alineado
> con GLEC Framework v3.0 §6.4 e ISO 14083:2023.**

El cliente shipper recibe en su certificado:

| Métrica | Antes (sin Booster) | Con Booster |
|---|---|---|
| Emisiones loaded leg | X kg CO₂e | X kg CO₂e |
| Empty backhaul atribuible | ~95% × X | (1 − factorMatching) × ~95% × X |
| **Total atribuible** | ~1.95 X | ~1.0 X − 1.7 X según matching |
| **Ahorro CO₂e via Booster** | — | **mostrar valor concreto** |

Esto materializa la promesa "marketplace de logística sostenible" en una
métrica auditable. Es la base para vender Booster a empresas con
compromisos Scope 3 públicos (CDP, SBTi, GRI 305).

## Alternativas consideradas y rechazadas

### A. Mantener factores actuales, solo fix de TTW

**Rechazada**: corrige el bug científico pero no avanza el diferenciador
comercial. Booster sigue indistinguible de cualquier calculator GLEC
genérico. Pierde la ventaja del marketplace.

### B. Implementar GLEC + ISO 14083 completo

**Rechazada por scope**: ISO 14083 incluye intermodal (rail, sea, air)
que Booster no opera todavía. Implementarlo agrega complejidad sin
beneficio piloto (Chile es 99% road freight). Diferimos a TRL 10 con
expansión multi-modal.

### C. Importar EcoTransIT World API en lugar de calcular en casa

**Rechazada**: sería un servicio externo paid, dependencia operativa,
costo recurrente, y los datos sensibles (cargas reales, rutas) saldrían
del perímetro Booster. Manteniendo cálculo in-house preservamos data
locality y control sobre certificados firmados.

### D. Solo factor WTW como un único campo (sin TTW/WTT desglose)

**Rechazada**: GLEC v3.0 y CDP requieren separar TTW/WTT en certificados
ESG. El desglose es necesario para auditoría externa.

## Out of scope (otros MRs)

Este ADR fija la **decisión técnica**. Quedan tareas de integración:

1. **Servicio orquestador**: `apps/api/src/services/calcular-metricas-viaje.ts`
   debe pasar el objeto `backhaul` al calculator cuando el matching engine
   provea el factorMatching real del viaje. MR aparte.
2. **Schema DB**: agregar campos a `metricas_viaje`:
   - `factor_matching_aplicado` (decimal 0-1)
   - `emisiones_empty_backhaul_kgco2e_wtw` (decimal)
   - `ahorro_co2e_vs_sin_matching_kgco2e` (decimal)
   MR aparte con migration Drizzle.
3. **Matching engine**: instrumentar para reportar el factorMatching real
   por trip leg. Hoy retorna 0 si no hay matching de retorno; en el
   futuro reporta el porcentaje cubierto. MR aparte.
4. **Certificado PDF**: agregar la sección "Ahorro CO₂e via matching de
   retorno" en `packages/certificate-generator/`. MR aparte.
5. **UI shipper**: mostrar el ahorro CO₂e en `/app/certificados`. MR aparte.

## Plan de despliegue

| Fase | Ventana | Acción |
|---|---|---|
| **T+0** (este MR) | hoy | Cambios al calculator, tests verdes, ADR mergeado. |
| **T+1 sem** | post-merge | MR con schema migration + servicio orquestador. |
| **T+2 sem** | | MR matching engine reportando factorMatching real. |
| **T+3 sem** | | MR certificado PDF + UI shipper. |
| **T+4 sem** | | Comunicación pública: nota técnica en `boosterchile.com/transparencia` con cita a GLEC v3.0 §6.4 e ISO 14083. |

## Métricas de éxito a 90 días

A los 90 días de mergeado, validar:

- **Compliance**: ¿algún cliente/auditor cuestionó la metodología? Target = 0.
- **Storytelling**: ¿cuántos certificados emitidos reportan ahorro
  CO₂e > 0? Target ≥ 50% de los viajes (es decir, en al menos la mitad
  de los viajes el matching de retorno fue > 0).
- **Métrica comercial**: ¿podemos publicar un agregado "Booster ha
  evitado N toneladas de CO₂e via matching de retorno" mensualmente?
  Target = sí.

Si alguna falla, re-evaluar α por categoría, default values por
tipoVehiculo, o enfoque de empty backhaul.

## Versionado del calculator

`ResultadoEmisiones.versionGlec` queda en `'v3.0'`. Si en el futuro
adoptamos GLEC v3.2 (publicado oct 2025) o ISO 14083, abrir nuevo ADR.

`fuenteFactores` ahora dice `"GLEC v3.0 (Smart Freight Centre 2023) +
IPCC AR6 GWP-100"` para que sea auditable desde el certificado mismo.

## Riesgo

**Bajo**. Mitigaciones:

- Los certificados emitidos previos no tienen validez comercial (per Felipe
  2026-05-05) → no hay invalidación de evidencia firmada.
- Tests verdes (44/44 en carbon-calculator).
- Backward compat: API existente sigue funcionando sin pasar `backhaul`;
  solo se activa el nuevo flow cuando el caller lo pasa explícitamente.
- ADR + research/013 + commit message tienen citas a las fuentes
  internacionales para defensa ante auditoría.
