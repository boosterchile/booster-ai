# Sello «Estimado» según quién midió la distancia

Fuente: [ADR-091](../../docs/adr/091-sello-estimado-por-fuente-de-distancia.md) (decisión del PO del 2026-11-12). Dominio crítico (GLEC): pruebas primero, con el rojo en la Evidencia del PR.

## Entradas

`DatosMetricasCertificado`, tal como lo arma hoy la emisión. Se leen tres campos, los tres ya guardados:

- `certificationLevel` (`nivel_certificacion`),
- `routeDataSource` (`fuente_dato_ruta`),
- `coveragePct`.

No cambia ningún dato guardado, ningún enum ni la API.

## Salidas

El PDF del certificado pasa de dos presentaciones a tres. La presentación sale de una sola función, `presentacionNivel`, en `packages/certificate-generator/src/render-helpers.ts`.

| Nivel | Fuente de la ruta | Cobertura | Presentación |
|---|---|---|---|
| `primario_verificable` | cualquiera | cualquiera | Primario (sin cambio) |
| `secundario_modeled` | `teltonika_gps` | ≥ 80 % | **Medido con Teltonika** |
| `secundario_modeled` | `teltonika_gps` | < 80 % o ausente | Estimado |
| `secundario_modeled` | `maps_directions`, `movil_gps`, `manual_declared` o ausente | cualquiera | Estimado |
| `secundario_default` | cualquiera | cualquiera | Estimado |
| ausente | cualquiera | cualquiera | Estimado |

La fila de cobertura bajo 80 % es una defensa. Según ADR-077, sección 2, bajo ese umbral la fuente guardada pasa a `maps_directions`, así que la combinación no debería existir. Si aparece (dato anterior a esa regla o un error), el certificado conserva el sello: ante la duda, avisa de más.

Presentación «Medido con Teltonika»:

- sin sello junto al título y sin «Estimado» en el pie;
- badge «Distancia medida con Teltonika · consumo modelado · N% telemetría», con N con piso;
- en lugar del disclaimer destacado, una nota de método en párrafo normal después de Resultados: «La distancia fue medida por el dispositivo Teltonika instalado en el vehículo. El consumo de combustible se modeló con factores {fuente} y GLEC Framework {versión}; no proviene de una medición del vehículo.»;
- el número principal y su `±` no cambian.

Las presentaciones Primario y Estimado quedan como están.

## Criterios de éxito

1. `presentacionNivel` devuelve la presentación de cada fila de la tabla, incluidos nivel, fuente y cobertura ausentes.
2. Certificado «Medido con Teltonika»: el texto del PDF no contiene el sello, ni «Estimado», ni «IMPORTANTE», ni «Google Routes», ni «verificable», ni «dato primario».
   La línea de distancia de Resultados conserva su desglose («medido 92%, estimado 8%»): es la parte del recorrido sin telemetría y se sigue declarando.
3. Ese certificado sí contiene el badge nuevo, la nota de método completa y la línea de método de ADR-077.
4. El pie de cada página de ese certificado es «BOO-X · vN», sin «Estimado».
5. La nota de método queda en la página 1, junto al número.
6. Un certificado con Teltonika y cobertura bajo 80 % conserva las tres señales de «Estimado».
7. Los certificados Primario y Estimado no cambian: sus pruebas actuales siguen en verde sin editarlas.

## Fuera de alcance

- Reemitir certificados ya emitidos (ADR-091, sección 5).
- El GPS del móvil conserva el sello (ADR-091, sección 4).
- La interfaz web: hoy no muestra el sello ni el badge del certificado; la página Flota cuenta «Certificados estimados» por nivel guardado y queda igual en este cambio.
