# La huella lee el consumo del CAN cuando el equipo lo envía

- Fecha: 2026-11-12
- Estado: decisión del PO en el chat del 2026-11-12 («Sí, hazlo»). Dominio crítico (GLEC): pruebas primero, con el rojo en la Evidencia del PR.
- Revierte: el punto 1 de «fix0» de HC-005 (#871, decisión de Orquestador del 2026-11-02): «la config es solo el interruptor de lectura». El punto 2 (mínimo de muestra) sigue vigente.
- Enmienda: `.specs/huella-exacto-canbus-t10-05/spec.md`, secciones 2 y 6, donde exigen `fuente_combustible_can = '83'` para leer el contador.
- No cambia: ADR-077 §2 y ADR-091. `primario_verificable` sigue exigiendo `exacto_canbus` + `teltonika_gps` + cobertura ≥ 95 %.

## Problema

Cinco camiones envían el consumo acumulado por CAN (IO 83). La huella lo lee solo en los dos que alguien marcó a mano con `fuente_combustible_can = '83'`. En los otros tres el dato llega y se ignora, y sus certificados no pueden salir como primarios. Que el dato se use o no depende de un campo que nadie tiene motivo para recordar.

## Entradas

Las mismas del cierre de un viaje o de una ruta (`medirVentanaDelVehiculo`): vehículo, ventana y distancia reconstruida. No hay campos nuevos.

## Salidas

1. **La huella lee el 83 por datos.** Con fuente de posición `teltonika_gps` y distancia reconstruida, el cierre carga las lecturas del 83 de la ventana sea cual sea `fuente_combustible_can`. Si el equipo no envió el 83, la decisión cae en `can_sin_lecturas`, igual que hoy.
2. **La validación no cambia.** `guardrail83` sigue siendo el único camino a `exacto_canbus`: contador monótono, muestra mínima (5 L y 10 km), banda de consumo, y ventana de hasta 7 días. Un 83 que no pasa deja la huella en `modelado` con su motivo.
3. **`fuente_combustible_can` deja de gobernar la huella.** Sigue gobernando lo que ya gobernaba fuera de ella: qué lectura de combustible muestran los trayectos y, con eso, los avisos de nivel. Nada de eso cambia; marcar o no un camión ya no enciende ni apaga avisos por efecto de la huella.
4. **El contador `huella_canbus_no_usado_total` cuenta descartes, no ausencias.** Sube cuando había lecturas del 83 y la validación las descartó. Con `can_sin_lecturas` sube solo si el vehículo está marcado `'83'`: ahí la ausencia es una señal de que el CAN dejó de llegar, igual que hoy.
5. **Página Flota.** El aviso `envia_83_sin_configurar` desaparece: ya no describe un problema. El aviso `configurado_83_sin_lecturas` se mantiene.

## Criterios de éxito

1. Vehículo con `sin_sensor`, `89`, `84` o sin valor, y 83 limpio en la ventana → se lee el contador, `exacto_canbus`, `fuenteEnergia = can_83`, con los mismos litros que con config `'83'`.
2. Mismo vehículo con cobertura ≥ 95 % → `primario_verificable`.
3. Vehículo sin lecturas del 83 → `can_sin_lecturas` y `modelado`. El contador de descartes no sube, salvo con el vehículo marcado `'83'`.
4. Vehículo con `sin_sensor` y ventana sobre el tope de 7 días → `ventana_excede_tope`, no `can_sin_lecturas`.
5. 83 no monótono, muestra chica o fuera de banda → `modelado` con su motivo, con cualquier config. El contador sube.
6. Vehículo eléctrico o con GPS del móvil → sin cambios.
7. Los trayectos siguen sin inventar litros con `sin_sensor` (pruebas actuales, sin editar).
8. La ficha de Flota no devuelve `envia_83_sin_configurar`.

## Fuera de alcance

- Recalcular o reemitir certificados ya emitidos.
- Retirar el valor `'83'` del campo o del formulario del vehículo.
- Los avisos de robo de combustible y la lectura de los IO 84 y 89.

## Riesgo

Tres camiones pasan a poder emitir `exacto_canbus` sin que nadie haya revisado su contador a mano, como se hizo con KZXB64 y LFGR63 en HC-001. La protección es `guardrail83`. Según las pruebas de #871, cubre los dos casos raros conocidos: PLFL57 y el contador en 0 de RCPC20.
