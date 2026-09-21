# El seguimiento en vivo no se queda con el primer ping

**Estado**: aceptada como bugfix de producción (QA 2026-09-21, carga BOO-83ND2C).
**Slot**: no abre frente. Endurece el tracking que `.specs/tracking-live-unificado/`
ya dejó en `main` (excepción del PO, 2026-09-20, ligada al Slot 3).

## Qué se vio

En app.boosterchile.com, con la carga `en_proceso` / «En camino» y la posición
venida del teléfono del conductor, dos capturas (~16:05 y ~16:11, America/Santiago)
muestran la misma velocidad (29.02 km/h), las mismas coordenadas
(-33.39729, -70.79487) y el mismo ETA («en 1 h 54 min»). «Actualizado hace»
pasó de 5 min a 11 min. Antes (~16:03) el track autenticado decía «hace 2 min»
con las mismas coordenadas.

## Causa (leída del código, no supuesta)

«Actualizado hace N min» en `/tracking/$token` es
`formatAge(progress.last_position_age_seconds)`. Ese número lo calcula el API
en cada request: `now - timestamp` del último ping (`computeProgress`). No hay
reloj en el cliente. Que la edad pase de ~2 a 5 a 11 min en el reloj de pared,
con coordenadas idénticas al 5º decimal, significa que **las dos pantallas
pintaron una lectura nueva del mismo ping**. El origen no tenía un ping más
nuevo. El primer pintado funciona; el snapshot de datos no avanza.

Ese ping sale de `posiciones_movil_conductor` (`position_source: mobile`).
`resolverPosicionEnVivo` no cachea la fila entre requests.

Por qué el teléfono deja de aportar pings nuevos mientras la página del
conductor sigue abierta:

1. `onFix` ponía `ultimoFixWallMs = Date.now()` en **cada** callback de
   `watchPosition`, también cuando el browser repite el mismo
   `GeolocationPosition` (mismo `timestamp`). `decidirReporte` los descarta
   (`dt < 10 s`) y `latido()` no llama a `getCurrentPosition` porque el reloj
   de pared parece fresco. El único POST es el primero.
2. Al volver a `visible` solo se drenaba la cola. No se pedía un fix nuevo.
   Con la pantalla apagada iOS suspende la PWA: eso sigue fuera de alcance
   (un sitio web no reporta en background).

El visor tenía además dos huecos que congelan la **pantalla** aunque el API
ya tenga un ping nuevo (no explican solos los 6 min de BOO-83ND2C, porque ahí
la edad sí cambió y eso exige un body nuevo):

- `GET /public/tracking/:token` respondía `Cache-Control: public, max-age=30`
  y `api.get` usa el caché por defecto de `fetch`. El poll y Refrescar podían
  repetir el JSON cacheado.
- El `QueryClient` global pone `refetchOnWindowFocus: false`. TanStack Query
  no dispara el `refetchInterval` mientras `document.hidden`, y escucha
  `visibilitychange` en `window` (el evento no burbujea: lo dispara
  `document`). En Safari móvil, al volver de segundo plano, no había refetch.

## Hecho cuando

- Con el viaje `asignado` o `en_proceso`, `/tracking/$token` y
  `/app/cargas/$id/track` vuelven a pedir la posición en ≤30 s sin recargar,
  también con la pestaña oculta, y al volver a primer plano. El fetch va con
  `cache: 'no-store'` y el público responde `private, no-store`. Refrescar
  pega al origen.
- Un `watchPosition` que repite el mismo timestamp no impide el latido (25 s,
  `maximumAge: 0`). Al volver a `visible`, el conductor pide un fix fresco.
- Tests de poll y de latido. Lint y typecheck limpios en lo tocado.
- Viaje ya cerrado: el público no pollea cada 30 s (sigue en 5 min).

## Fuera de alcance

Traza Teltonika «sin telemetría» en la asignación del transportista, link de
compartir (#697), `es_demo` (#698), deploy. Reportar GPS con la app cerrada.
