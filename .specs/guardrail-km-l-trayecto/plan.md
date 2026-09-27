# Plan — Guardrail de km/L y KPI de la ventana

1. Test rojo que reproduce JLKT54: 294,93 km / 24,0 L no publica `kmPorLitro` y la nota es `dato no confiable`. Los 24,0 L se conservan.
2. Tests del guardrail: fuente `89` con 200 L repite el 12,29 y también se oculta; 6,23 se muestra; 6,25 exacto se muestra.
3. En `consumoCubierto`, después de las compuertas de cobertura y de muestra mínima, anular `kmPorLitro` si el redondeo a 2 decimales supera `kmPorLitroMaxConfiable()`.
4. Test del KPI: 100 km/20 L y 10 km/10 L dan 3,67 (Σkm/ΣL), no 3 (promedio de ratios) ni el km/L del trayecto más nuevo. Una ventana cuyo cociente supera 6,25 deja el KPI en null.
5. `resumirHubVehiculo` calcula ese cociente sobre la ventana. La tarjeta del hub muestra `dato no confiable` cuando hay litros y el KPI quedó null.
