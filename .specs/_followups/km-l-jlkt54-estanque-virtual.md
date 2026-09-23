# Follow-up: km/L de JLKT54 — estanque de firmware ~200 L

**Cerrado en código** el 2026-09-23 con el SELECT de Data Ops. No se agregó columna de estanque.

## Hecho (no es un promedio de la UI)

Trayecto JLKT54, 2026-09-22 21:11 → 2026-09-23 01:07 SCL:

- distancia = haversine GPS = 294,93 km (coincide con el odómetro AVL 87)
- litros = Δ del AVL 84 × 0,1 = 24,0 L
- km/L = 294,93 / 24,0 = 12,29

El 84 informa un estanque de firmware ~200 L (`raw 84 ≈ 20 × raw 89`) y deprime los litros ~4×. La base del vehículo es 32 L/100 km: en ese tramo se esperaban ~94 L. En 7 días, Σkm/ΣL ≈ 5,26; el máximo por trayecto era 12,29 y el mínimo 0,76. #713 no entra en este cálculo.

## Qué hace el código

1. Si el punto trae `capacidadEstanqueL` y hay AVL 89, los litros son Δ% × capacidad. `listar-trayectos-teltonika` sigue pasando `null`: no hay columna.
2. Si no hay capacidad y el vehículo tiene `consumo_l_por_100km_base`, un km/L mayor que `2 × (100 / base)` no se publica. Con base 32 el tope es 6,25. Se conservan los 24,0 L medidos; no se escriben los ~94 L del modelo. `economiaConfiable = false`.
3. El km/L del hub es Σkm/ΣL de los trayectos de la ventana con litros confiables. El 12,29 no entra a esa suma.
