# Plan — Guardrail de km/L y KPI de la ventana

1. Test rojo que reproduce JLKT54: 294,93 km / 24,0 L no publica `kmPorLitro` y la nota es `dato no confiable`. Los 24,0 L se conservan.
2. Tests del guardrail: fuente `89` con `capacidad_estanque_l` = 200 (la capacidad declarada, no una escala a corregir) deja 24,0 L y oculta el 12,29; 6,23 se muestra; 6,25 exacto se muestra. El tope y las exclusiones no reescriben IO 89 × capacidad.
3. En `consumoCubierto`, después de las compuertas de cobertura y de muestra mínima, anular `kmPorLitro` si el redondeo a 2 decimales supera `kmPorLitroMaxConfiable()`.
4. Test del KPI: 100 km/20 L y 10 km/10 L dan 3,67 (Σkm/ΣL), no 3 (promedio de ratios) ni el km/L del trayecto más nuevo. Una ventana cuyo cociente supera 6,25 deja el KPI en null.
5. `resumirHubVehiculo` calcula ese cociente sobre la ventana. La tarjeta del hub muestra `dato no confiable` cuando hay litros y el KPI quedó null.
6. Cobertura: si los puntos traen `coberturaPct` (la de `metricas_viaje`), esa manda. Si no, `calcularCoberturaPura` sobre los pings del segmento. Bajo 80 % y con litros medidos, el km/L queda null, la nota dice `cobertura baja` y el segmento no entra al Σ. 80 % entra.
7. `sin_sensor` deja la nota `sin sensor de combustible` y tampoco entra al Σ, aunque el fixture traiga litros. Una ventana mezclada suma solo los segmentos que pasan las dos compuertas y el tope de 6,25.
