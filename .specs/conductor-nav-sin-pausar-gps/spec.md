# Navegar sin soltar el reporte GPS del teléfono

**Estado**: aceptada como bugfix de producción (BOO-83ND2C, mandato de Felipe, 2026-09-21).
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
- El aviso de #699 (`aviso-maps-pausa`) y el texto de rearme al volver
  (`avisoPausa`) no se tocan.

## Fuera de alcance

App nativa / Capacitor, geolocalización con Maps en primer plano, split de
Android, cobertura %, Slot 1.

## Criterios de salida

- El control `navegar-destino` / `navegar-origen` no es un enlace externo.
- Tocarlo muestra `ruta-en-app` y no llama a `window.open`.
- El único enlace a Google Maps de esa fase lleva el aviso de pausa cuando
  el teléfono es la fuente, y sigue yendo a las coordenadas de la ruta eco.
- Tests de la tarjeta, typecheck y biome del archivo tocado.
