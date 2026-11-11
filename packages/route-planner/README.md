# @booster-ai/route-planner

La ruta de un camión como datos y funciones puras ([ADR-088](../../docs/adr/088-ruta-parada-servicio.md), spec `.specs/ruta-parada-servicio/`).

- `calcularTramos`: un tramo por cada par de paradas consecutivas, con su masa y volumen a bordo.
- `validarRuta`: invariantes de §4.4 de la spec. Devuelve todas las violaciones.
- `serviciosEnMasDeUnaRuta`: el invariante entre rutas.
- `TRANSICIONES_RUTA`, `puedeTransicionarRuta`, `estadoQueCorresponde`: estados de la ruta.
- `agregarServicio`, `quitarServicio`, `reordenarParadas`, `declararConfiguracion`: devuelven la ruta nueva o los motivos del rechazo. No modifican la ruta recibida.

No accede a base ni a red. Los services de `apps/api` cargan la ruta, llaman acá y persisten.
