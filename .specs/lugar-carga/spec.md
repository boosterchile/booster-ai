# Lugar de la carga — dirección, comuna y punto en el mapa

## Problema

En `/app/cargas/nueva` el generador escribe origen y destino a mano. No hay sugerencias de direcciones reales de Chile, no existe el campo comuna y no se puede marcar un punto sin dirección formal (pin o link de Google Maps). Felipe, en Prueba Generador SpA, tenía solo `https://maps.app.goo.gl/cFmSSGQDfS2tzWex7` y no pudo usarlo.

## Qué rechaza hoy la dirección

`tripRequestCreateInputSchema` no geocodifica: acepta cualquier texto de 5 a 500 caracteres. «Compañía 4425» y «Concepción centro» pasan. Lo que se ve como «no válida» es otra cosa:

1. Si la región queda en «Seleccionar», Zod responde en inglés con el enum completo (`Invalid enum value. Expected 'I' | 'II' | …`).
2. `validateTripForm` corta en las fechas vacías y no muestra el error de dirección ni de región en el mismo envío.
3. Un link o unas coordenadas pegados en el texto se guardan como calle. Routes API no los geocodifica y el viaje queda sin lat/lng. El ancla del lugar no existe.

## Entradas

- Texto de dirección (libre o elegido de una sugerencia).
- Región (código I–XVI) y comuna (código CUT/INE de 5 dígitos, opcional).
- Punto opcional: sugerencia de Places, pin en el mapa, coordenadas o link de Google Maps (incluido `maps.app.goo.gl`).

## Salidas

- `POST /trip-requests-v2` sigue aceptando el body actual. Suma, opcionales y retrocompatibles: `origin.comuna_code`, `origin.latitude`, `origin.longitude` y los mismos campos en `destination`.
- Si el cliente manda lat/lng del origen, se persisten y no se pisan con Routes API. Si no los manda, se mantiene la geocodificación degradable actual.
- Destino gana `destination_latitude` / `destination_longitude` (numeric 10,7, NULL, sin default). Migración solo `ADD COLUMN`, numerada `0064` (la `0063` es la auditoría de email del conductor, #793).
- `POST /trip-requests-v2/resolver-enlace` (sesión de generador) sigue redirects de hosts de Google Maps y devuelve lat/lng. El body cabe en 500 caracteres. No abre hosts arbitrarios ni `goo.gl` genérico.

## Éxito

- Al escribir aparecen sugerencias de Chile cuando la key de Maps responde. Al elegir una se completan dirección, región, comuna y lat/lng.
- La comuna se puede cambiar con el selector de la región.
- El mapa se abre con «Elige el punto en el mapa» (y solo, si ya hay un punto). Tocar o arrastrar el pin rellena dirección, comuna y región. Cerrado, no entra en el tab order: el iframe de Google atrapa el foco.
- La dirección es un combobox (`aria-controls` al listbox, `aria-activedescendant` en la opción activa). El teclado vive en el input.
- La comuna, si viene, pertenece a la región. El punto, si viene, cae en Chile (lat −56…−17, lng −110…−66).
- Pegar coordenadas o un link (corto o largo) deja el punto. Si el link no trae punto, el mensaje lo dice y el texto libre sigue sirviendo.
- Sin `VITE_GOOGLE_MAPS_API_KEY`, o si Places/Geocoding responden denegado, el formulario no se rompe: texto libre, región y comuna.
- «Compañía 4425» se puede publicar. La región vacía dice «Selecciona una región».
- Mobile y desktop. Tests unitarios. Sin secretos ni archivos protegidos nuevos.

## Proveedor

El mismo que flota y tracking: `@vis.gl/react-google-maps` y `VITE_GOOGLE_MAPS_API_KEY` (ADR-014). Places y Geocoding salen por esa key del browser. Si en GCP no están habilitadas para la key, Ops las activa; la UI ya degrada.
