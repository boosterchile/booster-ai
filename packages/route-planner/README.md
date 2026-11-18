# @booster-ai/route-planner

La ruta de un camión como datos y funciones puras ([ADR-088](../../docs/adr/088-ruta-parada-servicio.md), spec `.specs/ruta-parada-servicio/`).

- `calcularTramos`: un tramo por cada par de paradas consecutivas, con su masa y volumen a bordo.
- `validarRuta`: invariantes de §4.4 de la spec. Devuelve todas las violaciones. El volumen no es una violación y la carrocería no se comprueba acá.
- `avisosDeRuta`: tramos donde el volumen a bordo supera el del vehículo. Avisa, no bloquea.
- `serviciosEnMasDeUnaRuta`: el invariante entre rutas.
- `TRANSICIONES_RUTA`, `puedeTransicionarRuta`, `estadoQueCorresponde`: estados de la ruta.
- `agregarServicio`, `quitarServicio`, `reordenarParadas`, `declararConfiguracion`, `declararConductor`: devuelven la ruta nueva o los motivos del rechazo. No modifican la ruta recibida.
- `moverServicio`: pasa un servicio de una ruta a otra de la misma empresa (agrupar). Devuelve las dos rutas, o en cuál está el problema.
- `separarServicio`, `rutaDeUnServicio`: sacan un servicio a una ruta propia de dos paradas, con el vehículo y el conductor de la ruta de la que sale.

La carrocería se comprueba cuando entra un servicio (`agregarServicio`, `moverServicio`) y cuando se declara un vehículo, con la tabla de `@booster-ai/matching-algorithm`. El vehículo no se cambia con carga recogida; el conductor sí.

No accede a base ni a red. Los services de `apps/api` cargan la ruta, llaman acá y persisten.
