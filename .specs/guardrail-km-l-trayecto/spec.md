# Spec — Guardrail de km/L por trayecto

**Slug:** `guardrail-km-l-trayecto`
**Brief:** cierre del frente que [#719](https://github.com/boosterchile/booster-ai/pull/719) dejó explícito («el guardrail de km/L no se implementa en este frente») y del diagnóstico JLKT54 del 2026-09-23.

**Frentes vivos:** `docs/frentes-vivos.md` no lista este frente. El PO pidió cerrar el pendiente del mismo brief de trayectos. No reabre un ADR ni la spec de `#719`.

## Entrada

Trayecto ya segmentado, con litros y distancia que pasan las compuertas vigentes (cobertura ≥ 90 %, litros ≥ 5, km ≥ 10). El km/L es `cubiertaKm / litros`, redondeado a 2 decimales, igual que hoy.

Baseline diésel del diagnóstico: **32 L/100 km** → `100 / 32 = 3,125 km/L`.

## Salida

Si el km/L redondeado es **mayor que** `2 × (100 / 32)` = **6,25**:

- `kmPorLitro` queda `null`.
- `litrosConsumidos` se conserva (el operador sigue viendo los litros leídos).
- `notaCombustible` = «El km/L supera el doble de lo esperable para un diésel (32 L/100 km). No lo mostramos.»

En el tope exacto 6,25 el número se muestra. Por debajo también. Las otras compuertas (cobertura, 5 L, 10 km) no cambian y corren antes.

El caso JLKT54 del 2026-09-22 21:11 → 2026-09-23 01:07 (294,9 km GPS / 24,0 L = 12,29) cae en el guardrail, en el camino legado (AVL 84 × 0,1) y también con fuente `89` y estanque de 200 L.

## Fuera de alcance

- Escribir en producción `capacidad_estanque_l` o `fuente_combustible_can` de JLKT54. 200 L es la escala del firmware (`raw 84 = 20 × raw 89`); con esa capacidad, `89 × 200` coincide con el 84 deprimido y el 12,29 se repite. La capacidad real del MACK no está confirmada. No se inventa un estanque (~780 L) para forzar 3,13 km/L.
- Recalibrar el AVL 84 en el equipo.
- Disparar `release.yml` o promover el canary. El release de `#718` (`a42c04ca`, run `35861781658`) murió en el paso `canary-verify` y no hay credenciales de Cloud Build en este entorno para leer el motivo. Promover a producción sigue siendo decisión humana.
