# Hueco con el vehículo detenido: tolerancia de 25 m a la deriva del GPS

**Estado**: aceptada · **Fecha**: 2026-10-29 · **Frente**: Slot 1 «Huella de carbono punta a punta» (T10-01 y T10-05 de `.specs/trl10/spec.md`) · **Decisión**: PO, 2026-10-29 · **Dominio crítico (huella/GLEC)**: TDD con rojo exhibido.

Enmienda la regla del hueco detenido de `.specs/distancia-real-hibrida/spec.md` (enmienda 2026-09-22, #708), que exigía extremos con coordenadas idénticas.

## 1. Problema (medido en producción)

BOO-HC7DJX (2026-10-20, camión con Teltonika, 4.688 pings en el segmento) cerró con `fuente_dato_ruta = maps_directions`, `cobertura_pct = 0` y sin `distancia_km_real` ni `emisiones_kgco2e_reales`. El log del cierre trae `abortReason = routes_error` y «Routes: sin ruta para el hueco».

Cadena observada:

1. El camión estuvo detenido 183 s sin reportar. Los dos pings que bordean el hueco están a **6,94 m** uno del otro: es la deriva normal del GPS con el vehículo quieto.
2. `esHuecoDetenido` (`apps/api/src/services/calcular-distancia-real.ts`) compara las coordenadas con igualdad exacta. Como no son idénticas, el hueco se manda a Routes.
3. Routes responde 200 sin distancia utilizable. El resolver de `calcular-metricas-viaje.ts` lanza con `distanceKm <= 0`.
4. La reconstrucción es todo o nada (spec original, criterio 5), así que se descartan los 468 km medidos por un hueco de 3 minutos.

Con ese hueco en 0 km, la misma traza da 468,65 km y una cobertura de 99,998 %.

No es un caso aislado. En 14 días de telemetría Teltonika (10 vehículos, al 2026-10-29) hay 4.211 huecos ≥ 60 s. 4.192 (99,5 %) tienen extremos a 25 m o menos, y la mayoría son paradas con deriva que la regla exacta no reconoce.

## 2. Decisión del PO (2026-10-29)

Un hueco (gap ≥ 60 s) cuenta como **vehículo detenido** cuando la distancia en línea recta (haversine) entre sus dos pings es **≤ 25 m**. Vale 0 km, se registra como segmento `estimado` y no llama a Routes.

El PO había elegido además el odómetro: «detenido si el odómetro no avanzó». Se descartó con datos antes de implementar. En 14 días el IO 16 no sirve como señal de parada:

- en RCPC20 está congelado (no cambió en 3 días con el camión en movimiento);
- en KFKW23 entrega valores basura y retrocede 5.699 veces;
- en PLFL57 y JWTH77 se queda igual en tramos de menos de 60 s en que el camión avanzó más de 200 m.

Con esa regla, un hueco en movimiento (túnel, zona sin señal) valdría 0 km y subestimaría la huella. El PO confirmó «solo 25 m».

## 3. Entradas y salidas

- **Entrada**: la traza del segmento (`PingGps[]`: `tMs`, `lat`, `lng`) y el resolver `estimarHuecoKm`. No cambia.
- **Salida**: `DistanciaHibridaResultado` y `EscrituraDistanciaReal`. No cambian de forma. Cambia qué huecos valen 0 km sin llamar a Routes.
- La regla vive en una sola función, así que aplica igual al cierre del viaje (`recalcularNivelPostEntrega`) y al backfill de distancia, y para las dos fuentes (`teltonika_gps` y `movil_gps`).

## 4. Criterios de éxito (verificables por test)

1. Un hueco con extremos a ≤ 25 m vale 0 km, queda como segmento `estimado` con `km = 0` y no llama al resolver. Incluye el caso con extremos idénticos (0 m).
2. Borde: un hueco a 24,9 m es detenido; uno a 25,1 m llama al resolver.
3. Un hueco con extremos a > 25 m se resuelve igual que antes: se llama al resolver con sus dos extremos y su distancia suma a `kmEstimado`.
4. Los huecos detenidos no cuentan para `MAX_HUECOS_ROUTES`.
5. Caso HC7DJX, con la misma geometría: un hueco de 183 s con extremos a 6,94 m y Routes respondiendo sin distancia. `recalcularNivelPostEntrega` no aborta con `routes_error`, no llama a Routes y persiste la distancia real.
6. Si Routes falla en un hueco a > 25 m, la reconstrucción sigue abortando (sin cambio del criterio 5 original).

No cambia ningún contrato público, el schema ni las fórmulas GLEC.

## 5. Fuera de alcance

- El odómetro como señal de parada (ver §2).
- Aceptar como 0 km una respuesta 2xx de Routes sin distancia (opción (b) de #708). El resolver sigue lanzando en ese caso, para huecos a > 25 m.
- Volver a emitir el certificado de HC7DJX o recalcular viajes ya cerrados. No existe un camino de re-emisión (`emitir-certificado-viaje.ts`), y escribir en prod lo decide el PO.
- Un umbral distinto por fuente de posición. El GPS del móvil puede derivar más; si aparecen abortos `routes_error` en viajes `movil_gps`, se mide y se decide aparte.

**Limitación conocida.** Si durante un hueco el vehículo se mueve y vuelve a quedar a ≤ 25 m de donde empezó, el tramo vale 0 km. Con la regla exacta pasaba lo mismo si volvía al mismo punto exacto. En 14 días ningún hueco ≥ 60 s tuvo extremos a más de 200 m, así que los huecos de la flota actual son paradas.

## 6. Plan TDD

1. Rojo: tests nuevos en `calcular-distancia-real.test.ts` (criterios 1–4) y en `test/unit/calcular-metricas-viaje.test.ts` (criterio 5), corridos contra el código actual. El output del rojo va en la Evidencia del PR.
2. Verde: `esHuecoDetenido` pasa de igualdad exacta a `haversine ≤ 25 m`, con la constante exportada `DERIVA_MAX_HUECO_DETENIDO_M = 25`.
3. Tests, lint, typecheck y build del monorepo en verde.

## 7. Evidencia

Se completa en el PR.
