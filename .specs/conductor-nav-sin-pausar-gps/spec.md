# Navegar sin soltar el reporte GPS del teléfono

**Estado**: criterios de aceptación cerrados (OK de producto, 2026-09-21). No se reabren.
**Slot**: 3 «Conductor operativo». Endurece la tarjeta de `.specs/conductor-tarjeta-guiada/`
y deja intacta la honestidad de pausa/rearme de `.specs/fix-tracking-snapshot-congelado/` (#699).

## Qué se vio

En BOO-83ND2C el conductor abrió Google Maps desde «Ir al destino»
(`target=_blank`, `dir_action=navigate`). La pestaña de Conductor pasó a
`hidden`, el browser dejó de entregar `watchPosition` y la traza se congeló.
#699 ya dice la verdad («Si abres Maps…») y rearma el watch al volver. Si el
teléfono es la fuente de la traza, el camino principal no puede ser salir de
esta pantalla.

## Entradas y salidas

Solo `apps/web/src/routes/conductor.tsx` (tarjeta del servicio) y sus tests.
Sin API, sin schema, sin app nativa.

- Acción principal «Ir al origen» / «Ir al destino»: botón. Abre la ruta eco
  ya resuelta (`EcoRouteMapPreview`) dentro de la tarjeta. El documento sigue
  visible; no hay `window.open` ni enlace a Maps en ese control.
- Sin polyline: el mismo panel muestra la dirección en texto. No sale a Maps.
- Acción secundaria, enlace aparte: «Abrir en Maps (pausa el reporte GPS)»
  cuando el teléfono reporta (`has_teltonika !== true`). Conserva las
  coordenadas de la polyline (o el texto de la dirección si no hay ruta) y
  `travelmode=driving`.
- Con Teltonika el camión sigue reportando: el enlace secundario dice
  «Abrir en Maps», sin atribuirle una pausa al teléfono.
- El aviso previo de #699 (`aviso-maps-pausa`) y la frase de rearme
  («El reporte se pausó… Ya volvió a enviar») se conservan. Esa frase ya no
  va en el verde de «al frente»: es el estado degradado.

## Fuera de alcance

- SDK nativo (Capacitor u otro) y geolocalización con Maps en primer plano.
- Instalar o exigir Teltonika.
- Descongelar flota (Slot 2) ni ningún frente que no sea este.
- Split de Android, cobertura %, Slot 1.

## Criterios de aceptación (cerrados)

OK de producto, 2026-09-21. Un cambio que no cumpla uno de estos no cierra.

1. **Primario.** El conductor navega sin salir del flujo de Conductor y la
   traza del teléfono sigue actualizándose. «Ir al origen» / «Ir al destino»
   son botones: abren la ruta en la tarjeta, no llaman a `window.open` ni
   `stop()` del reportero. Mientras el documento está al frente, el estado
   sigue siendo «Reportando mientras esta pantalla está al frente».
2. **Maps solo secundario.** El deep link no es la acción principal. El
   único enlace a Google Maps dice «Abrir en Maps (pausa el reporte GPS)»
   cuando el teléfono es la fuente. El default es seguir reportando.
3. **Si elige Maps, el degradado es explícito.** Ve el aviso de pausa antes
   de salir. Al ocultarse la pantalla, el estado deja de ser el reporte sano
   (`posicion-degradada`: pausado, última posición). Al volver, el texto de
   #699 («El reporte se pausó… Ya volvió a enviar») sigue, en el mismo estado
   degradado, no en el verde de «al frente».

**Terminado cuando:** Conductor navega en el flujo y la traza sigue; si elige
Maps ve el aviso de pausa y el estado degradado es explícito.

Con Teltonika el camión reporta solo: el enlace secundario dice «Abrir en
Maps» y no se atribuye una pausa al teléfono.
