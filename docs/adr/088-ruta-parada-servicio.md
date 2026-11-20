# ADR-088 — Ruta, parada y servicio: el recorrido del camión se separa de cada carga

**Estado**: Vigente. El PO cerró las decisiones de la sección final el 2026-11-10.
**Fecha**: 2026-11-09
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-061](./061-trip-lifecycle-tabla-transiciones-pura.md). La máquina de estados del viaje sigue vigente; este ADR agrega una entidad por encima (la ruta) y no cambia sus transiciones.
- [ADR-073](./073-tipologias-flota-configuracion-glec.md). La configuración del vehículo (motriz + arrastre) pasa a declararse en la ruta. El resto sigue vigente.

No supersede a ninguno.

**Spec**: por escribir (`.specs/ruta-parada-servicio/spec.md`). Sin spec aceptada y sin lugar en `docs/frentes-vivos.md` no se escribe código.

---

## Contexto

Hoy una carga es un viaje y un viaje es un camión:

- `asignaciones.viaje_id` es `UNIQUE`: una asignación por viaje.
- `asignaciones.vehiculo_id` es `NOT NULL` y `conductor_id`, `unidad_arrastre_id` viven en la asignación.
- `metricas_viaje` tiene `viaje_id` como llave primaria: la distancia, la huella y el certificado se calculan por viaje.
- No existe tabla de ruta ni de paradas.

Ese modelo no puede representar un camión que lleva cargas de varios generadores, que recoge en un punto y entrega en tres, o que toma una carga de retorno en el mismo recorrido. Tres pedidos del PO dependen de poder representarlo: la huella compartida en cargas consolidadas ([ADR-089](./089-reparto-huella-cargas-consolidadas.md)), la hoja de ruta consolidada y el agregar, editar o quitar servicios de un recorrido.

Si se resuelve con un parche (por ejemplo, permitir varias asignaciones con el mismo vehículo y sumar después), cada cálculo que hoy asume «un viaje, un camión» cuenta los mismos kilómetros y el mismo combustible una vez por carga.

## Decisión

1. **Tres conceptos.**
   - **Servicio**: la carga de un generador, con su origen, destino, ventana, precio, código de seguimiento y certificado. Es lo que hoy guarda `viajes`.
   - **Ruta**: el recorrido de una configuración de vehículo con un conductor, de una empresa transportista, desde que sale hasta que queda libre. Tabla nueva `rutas`.
   - **Parada**: un punto ordenado de la ruta, de tipo `recogida` o `entrega`, que referencia al servicio que se recoge o entrega ahí. Tabla nueva `paradas_ruta`.

2. **El tramo es la unidad física.** Un tramo es el trayecto entre dos paradas consecutivas. Tiene una distancia, una masa a bordo (la suma de los servicios cargados en ese tramo) y puede ser vacío. La huella se calcula por tramos y se reparte según ADR-089.

3. **Una sola forma de representar un recorrido.** Todo servicio asignado pertenece a una ruta. Un servicio que viaja solo es una ruta de dos paradas. No hay dos caminos de código, uno «simple» y otro «consolidado».

4. **Qué vive dónde.**
   - En la **ruta**: empresa transportista, vehículo motriz, unidad de arrastre, conductor, estado de la ruta, polilínea planificada.
   - En la **asignación**: el acuerdo comercial entre un servicio y un transportista (oferta aceptada, precio acordado) y la referencia a la ruta (`ruta_id`).
   - En el **servicio**: lo que hoy tiene `viajes`. No cambia.
   - El enlace de seguimiento sigue siendo por servicio.

5. **Estados.** La ruta tiene estado propio: `planificada`, `en_curso`, `cerrada`, `cancelada`. El estado de cada servicio sigue su máquina (ADR-061) y avanza con los eventos de sus paradas: la recogida confirmada en su parada de recogida, la entrega confirmada en su parada de entrega. La ruta se cierra cuando todas sus paradas están resueltas.

6. **Invariantes, con test.**
   - En ningún tramo la masa a bordo supera la capacidad útil de la configuración; lo mismo con el volumen cuando está declarado.
   - La parada de entrega de un servicio va después de su parada de recogida.
   - Un servicio está en una sola ruta no cancelada.
   - Una ruta `en_curso` tiene vehículo y conductor.

7. **Agregar, editar y quitar servicios.** Mientras la ruta está `planificada` el transportista agrega o quita servicios y reordena paradas. Con la ruta `en_curso` se puede agregar un servicio cuya recogida esté por delante y quitar uno que no se haya recogido; cada cambio valida los invariantes del punto 6 y deja evento. Los cambios a los datos de un servicio siguen la spec `editar-anular-cargas`.

8. **Seguimiento público.** El enlace de un servicio muestra la posición del vehículo solo entre la recogida y la entrega de ese servicio, y nunca las otras paradas, direcciones ni clientes de la ruta. La hora estimada de llegada considera las paradas intermedias.

9. **Hoja de ruta.** Es la vista y el documento de la ruta para el conductor y la oficina: paradas en orden, qué se recoge y qué se entrega en cada una, contacto y ventana. Se genera desde `rutas` y `paradas_ruta`; no es una entidad aparte.

10. **Migración.** `expand`: tablas nuevas, `asignaciones.ruta_id` nullable. Un backfill crea una ruta de dos paradas por cada asignación existente. Recién después se leen vehículo y conductor desde la ruta. Las columnas `vehiculo_id`, `conductor_id` y `unidad_arrastre_id` de `asignaciones` se retiran en una migración `contract` posterior. El backfill toca datos y la `contract` es irreversible: ambas necesitan el visto del PO en su PR.

## Consecuencias

- La huella, la hoja de ruta y el seguimiento leen de una sola fuente. Desaparece la posibilidad de contar dos veces un mismo kilómetro.
- Todo lo que hoy lee `asignaciones.vehiculo_id` o `asignaciones.conductor_id` cambia de fuente: posición en vivo, certificado, vista del conductor, panel del transportista. Es el costo principal.
- Los contratos de API que entregan vehículo y conductor de una asignación se mantienen durante la transición (se resuelven desde la ruta).
- El modelo de 0..N arrastres (deuda declarada en `.specs/_followups/flota-bitren-0-n-arrastres.md`) se resuelve en la ruta, no en la asignación.

## Fuera de alcance

- Transbordo: un servicio que cambia de camión a mitad de camino.
- Optimización automática del orden de paradas.
- Rutas con más de una empresa transportista.

## Alternativas descartadas

- **Varias asignaciones con el mismo vehículo, sin entidad ruta.** No hay dónde guardar el orden de paradas ni los tramos vacíos, y la huella se duplica.
- **Un «viaje padre» con viajes hijos.** Mezcla en una misma tabla dos cosas con dueños distintos (el recorrido es del transportista; la carga, del generador) y obliga a dos máquinas de estado en una.

## Decisiones del PO

El PO aceptó las cuatro recomendaciones el 2026-11-10.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Quién arma la ruta? | El transportista agrupa servicios que ya aceptó. Que Booster sugiera agrupaciones queda para después, con spec propia. |
| 2 | ¿Se renombra `viajes` a `servicios` en la base? | No. Se mantiene la tabla y los contratos; el término «servicio» se usa en la interfaz y en la documentación. |
| 3 | ¿Puede el generador ver que su carga viaja consolidada? | Sí, como dato («viaja con otras cargas»), sin identificar a los otros generadores. Lo necesita para entender su certificado. |
| 4 | ¿Se puede agregar un servicio con la ruta en curso? | Sí, con los invariantes del punto 6. La alternativa es permitirlo solo en `planificada`, más simple y menos útil para el retorno. |
