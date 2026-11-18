# ADR-091 — El sello «Estimado» va solo cuando la distancia no la midió un Teltonika

**Estado**: Vigente. Decisión del PO en el chat del 2026-11-12.
**Fecha**: 2026-11-12
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-028 Modelo dual de fuente de datos](./028-dual-source-data-model-teltonika-vs-maps.md), enmienda del 2026-11-02 (HC-004 T2). Deja de regir la frase «Solo `primario_verificable` es primario; un nivel ausente se trata como estimado» en lo que toca al sello, el pie y el disclaimer. La matriz de niveles (sección 2) y el factor de incertidumbre (sección 3) siguen vigentes.
- [ADR-077 Nivel de certificación por fuente de posición](./077-nivel-certificacion-por-fuente-de-posicion.md), sección 4 (rotulado al cliente). La matriz de la sección 2 y la línea de método siguen vigentes.

No supersede a ninguno. [ADR-089](./089-reparto-huella-cargas-consolidadas.md) sigue igual: el nivel se determina por ruta y lo heredan sus servicios, y con él la presentación de este ADR.

**Spec**: por escribir (`.specs/sello-estimado-por-fuente/spec.md`). Dominio crítico (GLEC): TDD con rojo exhibido.

---

## Contexto

Desde la enmienda del 2026-11-02 al ADR-028, el certificado lleva el sello «Estimado» junto al título, la palabra «Estimado» en el pie de cada página y un disclaimer destacado siempre que el nivel no sea `primario_verificable`. Ese nivel exige tres cosas a la vez: combustible medido por CAN (`exacto_canbus`), ruta del Teltonika (`teltonika_gps`) y cobertura de 95 % o más.

La consecuencia es que un viaje con Teltonika que no lee CAN sale con la misma presentación que un viaje sin ningún equipo, cuya distancia viene de Google Maps. El certificado ya distingue los dos casos en la línea de método (ADR-077, sección 4), pero el sello, el pie y el disclaimer son idénticos.

El PO objetó esa regla el 2026-11-11: «Estimado es cuando el certificado se emite con los datos de Google Maps y es lo que hace la diferencia con el uso del dispositivo Teltonika. Si no hay diferencia no tiene sentido el uso de Teltonika».

Hay además un error de hecho en la presentación actual. El disclaimer dice «Cálculo basado en datos secundarios modelados (Google Routes API + factores…)». En un viaje cuya distancia midió el Teltonika, Google Routes no participa en el cálculo: el texto afirma algo que no ocurrió.

Estado de la flota al 2026-11-11 (consulta de solo lectura a producción): cuatro vehículos envían el consumo por CAN y dos de ellos están configurados para usarlo. Ningún certificado ha salido todavía como `primario_verificable`. Con la regla anterior, todos los certificados emitidos llevan el sello, tengan Teltonika o no.

## Decisión

### 1. El sello depende de quién midió la distancia

El sello «Estimado», la palabra «Estimado» en el pie y el disclaimer destacado van **solo** cuando la distancia del certificado no la midió un Teltonika. La presentación sale de `nivel_certificacion` y `fuente_dato_ruta`, los dos datos guardados en la emisión:

| `nivel_certificacion` | `fuente_dato_ruta` | Presentación | Sello «Estimado» |
|---|---|---|---|
| `primario_verificable` | `teltonika_gps` | Primario | No |
| `secundario_modeled` | `teltonika_gps` | **Medido con Teltonika** (nueva) | **No** |
| `secundario_modeled` | `maps_directions` | Estimado | Sí |
| `secundario_modeled` | `movil_gps` | Estimado | Sí |
| `secundario_default` | cualquiera | Estimado | Sí |
| ausente | cualquiera | Estimado | Sí |
| cualquiera | ausente | Estimado, salvo `primario_verificable` | Sí |

`fuente_dato_ruta` solo queda en `teltonika_gps` cuando la cobertura es de 80 % o más (ADR-077, sección 2). Bajo ese umbral la distancia se estima con Google Routes, la fuente pasa a `maps_directions` y el certificado lleva el sello. No hace falta un umbral nuevo.

### 2. La presentación «Medido con Teltonika» dice qué se midió y qué no

Un certificado sin sello no puede dar a entender que el combustible fue medido. La presentación nueva queda así:

- **Sin** sello junto al título y **sin** «Estimado» en el pie.
- **Badge**: «Distancia medida con Teltonika · consumo modelado · N % telemetría». El porcentaje sigue la regla vigente: cobertura con piso, nunca sube a 100.
- **Línea de método**: la de ADR-077, sin cambio: «Distancia medida por GPS del vehículo (cobertura N %) · Consumo modelado según GLEC v3.0».
- **Nota de método** en lugar del disclaimer destacado, después de Resultados y con el peso visual de un párrafo normal: «La distancia fue medida por el dispositivo Teltonika instalado en el vehículo. El consumo de combustible se modeló con factores {fuente} y GLEC Framework {versión}; no proviene de una medición del vehículo.» No menciona Google Routes.
- **Incertidumbre**: sin cambio. El `±` del número principal usa el factor de `secundario_modeled` (ADR-028, sección 3).

### 3. El nivel de datos no cambia

`nivel_certificacion` sigue derivándose con la matriz de ADR-028 y ADR-077. Un viaje con Teltonika sin CAN sigue guardado como `secundario_modeled`: lo que cambia es cómo se presenta, no cómo se clasifica. No hay valor nuevo en el enum ni migración.

El vocabulario cerrado de ADR-077 se mantiene con este ajuste:

- «Verificable» y «dato primario» aplican solo a `primario_verificable`.
- «Medida» aplica solo a la distancia. Las emisiones de la presentación nueva son «modeladas».
- «Estimado» aplica solo a las presentaciones con sello.

### 4. El GPS del móvil conserva el sello

Un viaje medido con el teléfono del conductor (`movil_gps`) sigue saliendo «Estimado». El teléfono no está fijo al vehículo (ADR-077, sección 1) y la objeción del PO es precisamente que el Teltonika debe notarse en el certificado. La línea de método ya declara que la distancia vino del móvil.

Este punto lo resolvió el agente al redactar. Si el PO prefiere otro trato para el móvil, se cambia con una enmienda a este ADR antes de implementar.

### 5. Certificados ya emitidos

La regla rige para los certificados que se emitan desde el despliegue que la contenga. Los ya emitidos no cambian: el PDF firmado es el que se entregó. Reemitir certificados anteriores para quitarles el sello es una decisión aparte del PO y pasa por el flujo de reemisión (`.specs/reemision-certificado/`).

### 6. Dónde aterriza

| Cambio | Dónde |
|---|---|
| `presentacionNivel` recibe `routeDataSource` y devuelve tres presentaciones en vez de dos | `packages/certificate-generator/src/render-helpers.ts` |
| Nota de método y badge de la presentación nueva; sello, pie y disclaimer solo en «Estimado» | `packages/certificate-generator/src/generar-pdf-base.ts` |
| La misma regla en la interfaz donde hoy se muestra «Estimado» | `apps/web`, se identifica en la spec |
| Plantilla de carga consolidada (huella parte 5) | hereda la presentación de la ruta |

## Consecuencias

**Positivas.** El certificado de un camión con Teltonika se distingue a primera vista del de un camión sin equipo. El texto deja de atribuir a Google Routes una distancia que midió el dispositivo. La clasificación guardada no cambia, así que auditoría, reportes y reemisión siguen leyendo los mismos datos.

**Negativas.** Hay tres presentaciones en vez de dos, y por tanto más casos que probar en el certificado y en la interfaz. Quien lea el certificado deprisa puede tomar la ausencia de sello como «todo medido»; el badge y la nota de método existen para que eso no ocurra.

**Riesgos y mitigaciones.**
- *Un tercero (SBTi, CDP, verificación de CSRD) puede seguir tratando el certificado «Medido con Teltonika» como dato secundario*, porque la energía es modelada. El certificado no afirma lo contrario: no usa «verificable» ni «dato primario», y la nota de método lo dice en una frase. La vía a dato primario sigue siendo Teltonika con CAN.
- *Un cambio futuro podría quitar el sello a un caso que no corresponde.* La presentación sale de una sola función, y sus pruebas deben cubrir todas las filas de la tabla de la sección 1, incluidos nivel o fuente ausentes.
- *Este ADR no fue contrastado con el texto de GLEC Framework v3 ni de ISO 14083.* La distinción entre dato primario de actividad (distancia) y de energía (combustible) está escrita de memoria, igual que en ADR-089. La spec debe citarla contra el texto y el cambio entra en la verificación externa de `docs/compliance/glec-rfp.md`.

## Verificación (al implementar)

```bash
# 1. Las tres presentaciones salen de una sola función y están probadas fila por fila
pnpm --filter @booster-ai/certificate-generator exec vitest run test/render-helpers.test.ts

# 2. Un certificado con Teltonika sin CAN no lleva «Estimado» ni menciona Google Routes,
#    y no contiene «verificable» ni «dato primario»
pnpm --filter @booster-ai/certificate-generator exec vitest run
```

Mientras esas pruebas no existan, este ADR rige como criterio de aceptación de la spec que las crea.
