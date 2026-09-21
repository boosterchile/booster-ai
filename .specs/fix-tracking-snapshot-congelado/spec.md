# El seguimiento en vivo no se queda con el primer ping

**Estado**: aceptada como bugfix de producción (QA 2026-09-21, carga BOO-83ND2C).
**Slot**: no abre frente. Endurece el tracking que `.specs/tracking-live-unificado/`
ya dejó en `main` (excepción del PO, 2026-09-20, ligada al Slot 3).

## Qué se vio

Carga BOO-83ND2C, asignación `8f7519c9-50ba-4a5e-ba5e-cb01dd84af2f`, viaje
`en_proceso`. Fuente «teléfono del conductor». Velocidad 29.02 km/h (numeric
del móvil: Teltonika guarda `velocidad_kmh` entero).

Rechequeo autenticado ~16:14 America/Santiago: lat/lng y velocidad congelados
~15 min en -33.397288, -70.79487 / 29.02 km/h. Refrescar manual no movió la
posición. «Actualizado hace» y el ETA sí cambiaron: el ETA pasó de «en 58 min»
a «no disponible aún». Antes, el público mostró el mismo snapshot (edad 5→11
min, mismas coords, ETA «en 1 h 54 min»).

Al mismo tiempo el teléfono del conductor navegaba en Google Maps a 89 km/h
por Autopista Vespucio Sur (ETA Maps ~16:32). El GPS del aparato funcionaba.
No hay acceso a logs de prod desde este entorno: no se pudo contar los POST
de esa asignación.

## Causa

No es un poll detenido ni un binding al campo equivocado.

El track autenticado pinta `assignment.ubicacion_actual` y
`assignment.eta_minutes` del mismo `GET /trip-requests-v2/:id`. Que el ETA
cambie y la coordenada no, demuestra que el JSON nuevo se aplicó y que la
última fila leída no se movió. `resolverPosicionEnVivo` no cachea filas entre
requests. El ETA numérico exige ≥2 velocidades en 15 min (`computeProgress`);
con el último ping todavía dentro de la ventana de 30 min y sin muestras
nuevas, el ETA pasa a null y la posición se queda. Eso es exactamente el
salto «en 58 min» → «no disponible aún».

Esa fila deja de avanzar porque el documento del conductor no sigue posteando.
«Ir al destino» abre Google Maps (`target=_blank`, `dir_action=navigate`) y
suspende esta página: `watchPosition` y los timers no corren mientras Maps
está en primer plano. Un sitio web no obtiene GPS con otra app al frente.
Este entorno no puede confirmar en logs si algún POST posterior al primer
pintado llegó a fallar; la evidencia de UI + Maps alcanza para decir que la
fila servida no cambió.

Tres defectos del código hacen que, aun con un fix nuevo en el teléfono, esa
fila tampoco avance:

1. `coords.speed = -1` (WebView, «sin velocidad») se convertía a -3.6 km/h y
   el Zod `.min(0)` respondía 400 a **todo** el body. La cola descarta esa
   cabeza, pero si el browser insiste, ninguna coordenada nueva se inserta.
   Igual con `heading = -1`.
2. El móvil no tiene UNIQUE en `timestamp_device` (migración 0025) y la
   lectura ordenaba solo por ese timestamp. Dos inserts con el mismo reloj
   GPS empatan y el índice puede seguir devolviendo el primero.
3. Tras suspender, iOS no reanuda el `watchPosition`. `isWatching` sigue en
   true, así que el efecto de la tarjeta no llama `start()` otra vez. Pedir
   `getCurrentPosition` sin `clearWatch` deja el watch muerto.

El visor, aparte, repetía un JSON cacheado (`Cache-Control: public, max-age=30`,
`refetchOnWindowFocus: false`, intervalo en pausa con la pestaña oculta). Eso
no explica BOO-83ND2C —ahí el ETA sí cambió— y queda cerrado igual.

## Hecho cuando

- Speed fuera de 0..300 y heading fuera de 0..360 se mandan y se aceptan como
  `null`. La coordenada se inserta. Vale para el body nuevo y para uno ya encolado.
- La lectura en vivo ordena `timestamp_device DESC, id DESC` (móvil y Teltonika).
- Al volver a `visible` o en `pageshow`, el conductor hace `clearWatch` y abre
  un watch nuevo (`maximumAge: 0`) más un fix fresco. `visibilitychange` y
  `pageshow` juntos no rearman dos veces.
- Con el viaje `asignado` o `en_proceso`, las dos pantallas piden la posición
  en ≤30 s con `cache: 'no-store'`. El público responde `private, no-store`.
- Un `watchPosition` que repite el mismo timestamp no apaga el latido de 25 s.
- Tests de normalización, desempate, rearme, poll y POST. Lint y typecheck
  limpios en lo tocado.

## Rechequeo del conductor (~16:33)

Felipe, en la pantalla del viaje: «Reportando posición en vivo · 17 puntos
enviados». Los puntos empezaron a contarse al abrir esa ventana. Mientras
navegaba en Google Maps el teléfono no posteaba, y el seguimiento se quedó
en el último ping de antes.

El watcher no está atado al montaje de la tarjeta: vive en el módulo y
`stop()` solo corre al confirmar la entrega o si niegan el permiso. Salir a
otra ruta de Booster no lo apaga. Lo que lo apaga es el browser: con Maps en
primer plano la página se suspende. Un service worker no puede llamar a
`geolocation`, y el wake lock se suelta al ocultar el documento. No hay forma
web de seguir posteando en ese rato (`.specs/conductor-gps-resiliente/` §3).

La pantalla lo decía al revés: «en vivo» mientras los 17 puntos eran solo los
de tener esta ventana abierta. Ahora el texto es «mientras esta pantalla está
al frente». Si el documento pasa a `hidden` ≥15 s sin un fix, al volver (o al
reabrir, si alcanzó a persistir la marca) dice que el reporte se pausó. El
watch no se corta al ocultar: si el browser igual entrega un punto, no hay
aviso. Junto a la posición, sin Teltonika: abrir Maps pausa el envío hasta
volver.

## Fuera de alcance

Geolocalización con Maps u otra app en primer plano, o con el teléfono
bloqueado: hace falta app nativa o Teltonika. Traza «sin telemetría», link de
compartir (#697), `es_demo` (#698), deploy. No se consultaron logs de prod.
