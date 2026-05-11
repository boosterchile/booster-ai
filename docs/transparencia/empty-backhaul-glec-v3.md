# Empty Backhaul Allocation — metodología pública de Booster AI

**Versión**: 1.0
**Vigente desde**: 2026-05-11
**Estándar de referencia**: [GLEC Framework v3.0](https://www.smartfreightcentre.org/en/our-programs/global-logistics-emissions-council/calculate-report-the-glec-way/) §6.4 + [ISO 14083:2023](https://www.iso.org/standard/78864.html)

> Este documento explica **cómo Booster AI calcula y reporta el ahorro
> de CO₂e generado por el matching de retorno** en sus certificados de
> huella de carbono. Está orientado a generadores de carga, auditores
> ambientales y reguladores que necesiten validar nuestros números.

---

## ¿Qué es el empty backhaul?

En transporte de carga, cuando un camión entrega su carga en un destino
lejano del origen, debe **volver vacío** al punto de partida (o seguir
vacío hasta la próxima carga). Ese trayecto sin carga sigue emitiendo
CO₂ — el motor funciona, el combustible se consume — pero no transporta
mercadería de nadie.

**El problema**: ¿a qué shipment le imputamos esas emisiones del leg
vacío?

GLEC v3.0 §6.4.2 lo deja claro:

> *"All empty trip emissions associated with a freight movement shall
> be allocated to the loaded leg(s) that they support, on a tonne-km
> weighted basis."*

Traducido: las emisiones del retorno vacío se atribuyen a la carga que
generó ese viaje. Es la regla más conservadora — el shipper paga por su
"impacto total", incluyendo el costo ambiental de que su carga obligó a
un camión a ir hasta su destino.

## ¿Por qué importa para Booster?

La promesa central de Booster AI es ser un **marketplace que optimiza
retornos vacíos**. Cuando nuestro matching engine encuentra una carga de
retorno para un camión que ya entregó, el viaje de vuelta deja de ser
vacío — esa misma distancia ahora transporta mercadería de otro shipper.

Para nuestros clientes generadores de carga, esto se traduce en **menos
empty backhaul atribuido a su shipment**, lo que reduce su huella de
carbono total reportada.

Ese ahorro **es real, auditable y atribuible exclusivamente al
matching** — sin Booster, el camión habría vuelto vacío.

## Cómo lo medimos

### Paso 1 — factor de matching

Para cada viaje entregado, Booster calcula un **factor de matching**:

```
factorMatching ∈ [0, 1]
```

- `0` = el matching no encontró carga de retorno (peor caso, el camión
  vuelve 100% vacío). Toda la emisión del leg vacío se atribuye al
  shipment original.
- `1` = matching perfecto (mejor caso). El camión sale loaded, entrega,
  toma otra carga en retorno, vuelve loaded. **Cero empty backhaul
  atribuible al shipment original**.
- Valores intermedios reflejan matches parciales.

### Paso 2 — heurística geo (v2)

Hoy calculamos el factor con una heurística geográfica basada en
centroides regionales chilenos (CUT INE):

```
dist_retorno = haversine(destino_actual, origen_actual) × 1.3
dist_gap    = haversine(destino_actual, origen_next)   × 1.3

if dist_gap ≤ 10% × dist_retorno → factorMatching = 1   (match pleno)
if dist_gap ≥ dist_retorno       → factorMatching = 0   (next trip lejos)
else                             → factorMatching =
                                     round(1 − dist_gap / dist_retorno, 2)
```

Donde:

- `destino_actual` es el centroide regional del destino del viaje
  entregado.
- `origen_actual` es el centroide regional del origen del viaje
  entregado.
- `origen_next` es el centroide regional del origen del **próximo viaje
  del mismo vehículo** dentro de los 7 días corridos.
- `1.3` es el factor de ajuste haversine→ruta vial (red chilena
  agrega ~30% sobre great-circle).
- El threshold del 10% tolera ruido de precisión de centroides.

**Conservadora por diseño**: si el próximo trip no existe o arranca
lejos, asumimos `factorMatching = 0`. Nunca inventamos ahorro.

### Paso 3 — emisiones del leg vacío

Usamos la función pura `calcularEmptyBackhaul()` de nuestro package
abierto [`packages/carbon-calculator/src/glec/empty-backhaul.ts`](https://github.com/boosterchile/booster-ai/tree/main/packages/carbon-calculator/src/glec/empty-backhaul.ts):

```typescript
export function calcularEmptyBackhaul(opts: {
  distanciaRetornoKm: number;          // km del leg vuelta
  factorMatching: number;              // [0, 1]
  consumoBasePor100km: number;         // L/100km nominal del vehículo
  combustible: TipoCombustible;        // diesel | gasolina | etc
  capacidadKg: number;                 // capacidad útil del vehículo
}): ResultadoEmptyBackhaul {
  // ratioVacio = 1 − factorMatching
  // distanciaVacia = distanciaRetornoKm × ratioVacio
  // emisionesEmpty = consumoVacio × factorWtw
  // ahorroVsSinMatching = emisionesSinMatching − emisionesEmpty
}
```

El consumo del leg vacío usa el **factor de corrección por carga = 0%**
(camión sin carga), típicamente entre 0.85 y 0.95 del consumo a 50%
de carga nominal según la categoría del vehículo (LDV/MDV/HDV).

### Paso 4 — factores de emisión

Usamos los factores oficiales **SEC Chile 2024** publicados por la
Superintendencia de Electricidad y Combustibles, complementados con
factores GHG Protocol para los rubros que SEC no cubre. Para detalles,
ver [ADR-022 — Emissions methodology and WTW factor](https://github.com/boosterchile/booster-ai/blob/main/docs/adr/022-emissions-methodology-and-wtw-factor.md).

## Qué reportamos en el certificado

Cada certificado de viaje entregado por Booster muestra (cuando aplica):

| Campo | Significado |
|---|---|
| **Emisiones WTW totales** | kg CO₂e del viaje cargado, calculado GLEC §6 |
| **Factor matching aplicado** | El `factorMatching` ∈ [0, 1] usado en el cálculo |
| **Ahorro CO₂e via matching de retorno** | Diferencia vs el escenario "sin Booster" (`factorMatching=0`) |

El **ahorro nunca incluye el shipment de otro cliente** — solo el
diferencial atribuible al matching de retorno. Es estrictamente
incremental respecto del peor caso GLEC §6.4.2.

## Limitaciones conocidas

1. **Heurística por región** (no por punto exacto): usamos centroides
   regionales chilenos. Un viaje que llega a Concepción y matchea con
   uno que sale de Talcahuano queda con `factorMatching=1` aunque
   geográficamente esté a ~10km. Conservador → favorable al shipper.
   Versiones futuras pueden usar Google Routes API para distancia
   exacta.

2. **Ventana de 7 días**: solo consideramos matches dentro de una
   semana post-entrega. Matches más tardíos no se cuentan (el camión
   pudo haber hecho otros viajes en el medio).

3. **Sin reciprocidad cross-shipper**: cada certificado refleja el
   ahorro atribuido al shipper que lo emitió. No reasignamos el
   "crédito" al otro shipper cuyo viaje también fue parte del match.
   Esto es coherente con GLEC §6.4.2 — que asigna al loaded leg.

4. **Vehículos sin perfil energético**: si el carrier no registró
   consumo base + capacidad de su vehículo, no calculamos empty
   backhaul. El certificado se emite igual con las emisiones del leg
   cargado, pero sin la sección de ahorro. Esto evita inventar números
   por defaults.

## Versionado y no-retroactividad

Cada certificado captura el **`factoring-methodology-version`** vigente
al momento del cierre del viaje. Cambios futuros a la metodología (más
precisión geo, nuevos factores de emisión SEC, threshold del
proximity match) **no se aplican retroactivamente** a certificados ya
emitidos.

Versiones publicadas hasta hoy:

| Versión | Vigencia | Cambios |
|---|---|---|
| `factoring-v1.0-cl-2026.06` | 2026-04-23 → presente | Heurística geo binaria por región code (sin haversine) |
| `factoring-v1.0-cl-2026.06` (rev. wire) | 2026-05-11 → presente | **Misma versión metodológica**. Refinamiento en el orchestrator que llena el campo: pasa de binaria a haversine linear. La fórmula GLEC del calculator NO cambió. |

## Auditoría

Cualquier certificado de Booster puede verificarse contra esta
metodología:

1. El folio del certificado contiene `methodology_version`.
2. El código del calculator es **open source** y reproducible:
   - [`packages/carbon-calculator/src/glec/empty-backhaul.ts`](https://github.com/boosterchile/booster-ai/tree/main/packages/carbon-calculator/src/glec/empty-backhaul.ts)
   - Tests deterministas con vectores fijos: [`packages/carbon-calculator/test/`](https://github.com/boosterchile/booster-ai/tree/main/packages/carbon-calculator/test)
3. La heurística geo del orchestrator también es open: [`apps/api/src/services/actualizar-factor-matching.ts`](https://github.com/boosterchile/booster-ai/tree/main/apps/api/src/services/actualizar-factor-matching.ts).
4. Factores de emisión SEC Chile 2024 publicados por la
   Superintendencia están disponibles en [`packages/carbon-calculator/src/factores/sec-chile-2024.ts`](https://github.com/boosterchile/booster-ai/tree/main/packages/carbon-calculator/src/factores/sec-chile-2024.ts).

Para consultas sobre la metodología o solicitar verificación de un
certificado específico, contactar a
[auditoria@boosterchile.com](mailto:auditoria@boosterchile.com).

## Compliance

- **GLEC Framework v3.0** §6 (cálculo de emisiones) + §6.4 (allocation
  empty backhaul) + §6.5 (granularidad por leg).
- **ISO 14083:2023** — Greenhouse gases — Quantification and reporting
  of greenhouse gas emissions arising from transport chain operations.
- **GHG Protocol** Scope 3 Category 4 (upstream transportation).
- **SEC Chile 2024** factores de emisión locales.

## Referencias

- ADR-021 (interno, public via GitHub): [GLEC v3.0 compliance + empty
  backhaul como diferenciador comercial](https://github.com/boosterchile/booster-ai/blob/main/docs/adr/021-glec-v3-compliance.md).
- ADR-022 (interno, public via GitHub): [Emissions methodology and WTW
  factor](https://github.com/boosterchile/booster-ai/blob/main/docs/adr/022-emissions-methodology-and-wtw-factor.md).
- ADR-028 (interno, public via GitHub): [Dual-source data model
  (Teltonika vs Maps)](https://github.com/boosterchile/booster-ai/blob/main/docs/adr/028-dual-source-data-model-teltonika-vs-maps.md).

---

*Booster Chile SpA — Marketplace digital B2B de logística sostenible.*
*Esta página vive en
[`docs/transparencia/empty-backhaul-glec-v3.md`](https://github.com/boosterchile/booster-ai/blob/main/docs/transparencia/empty-backhaul-glec-v3.md)
del repositorio público.*
