# Spec — Temperatura ambiente en vivo (Google Weather API)

## Objetivo

Mostrar la temperatura **ambiente** donde está el camión, junto a los stats CAN del live view.
Proveedor decidido (goal): **Google Weather API** (Maps Platform, misma auth ADC que Routes, ADR-038).

## Constraint NO negociable (ToS Maps Platform — Weather API)

"Current condition" se puede cachear **≤ 1 hora**, después se borra. **NO** se persiste junto a la
telemetría, **NO** se guarda histórico. → Caché **in-memory** (Map efímero por proceso), TTL 30 min.
Cero columnas nuevas en BD, cero escritura de clima a disco.

## Estado de la credencial (gate de Felipe)

`weather.googleapis.com` está **DISABLED** en `booster-ai-494222` (verificado por serviceusage;
Routes está ENABLED). Habilitarla es **acción de Felipe** (constraint 6):
`gcloud services enable weather.googleapis.com --project booster-ai-494222`. El código usa ADC (igual
que Routes, sin API key nueva). Los tests **mockean** la API → no dependen de la habilitación. Sin la
API habilitada, el endpoint degrada a `temperatura_ambiente_c: null` (mismo null-safe de #612).

## Diseño

1. **Cliente** `weather-api.ts` (espejo de `routes-api.ts`): `GET
   weather.googleapis.com/v1/currentConditions:lookup?location.latitude&location.longitude`, ADC
   Bearer + `X-Goog-User-Project`, `fetch`/token inyectables, timeout duro (5s), errores tipados.
   Devuelve `temperature.degrees` (°C).
2. **Caché por celda** `clima-ambiente-cache.ts`: `celdaKey(lat,lng)` = redondeo a **0.1°** (~10 km);
   Map `celda → {temperaturaC, fetchedAtMs}`; `obtenerTemperaturaAmbiente({lat,lng,now,fetchClima})`:
   hot (age < TTL) → sirve del caché sin llamar; cold → `fetchClima` (1 llamada), cachea; error →
   `null` (degrada, no rompe). TTL = **30 min** (≤ 1h ToS; Google refresca cada 15-30 min).
3. **Endpoint** `GET /vehiculos/:id/ubicacion` suma `temperatura_ambiente_c` (Teltonika + browser-GPS,
   desde el lat/lng del último punto). NO llama a Weather en cada refetch de 15s → la celda cachea.
4. **DTO ambos lados**: response + espejo `UbicacionResponse` en `vehiculo-live.tsx`.
5. **UI**: stat "Temp. ambiente" en el `bottomExtra`, **distinta** de "Temp. carga" (Dallas, IO 72) —
   se relabela la de carga para no confundir. + **atribución obligatoria** Google.
6. **Atribución** (requisito Google): "Powered by Google" + "Source: Includes weather data from
   Google" donde se muestra el dato.

## Criterios de éxito (tests)

1. Caché **caliente** → NO llama a la API (fetchClima no invocado).
2. Caché **frío** → llama (fetchClima invocado 1 vez) y cachea.
3. **TTL expira** → tras `now > fetchedAt + TTL`, vuelve a llamar.
4. **Fallo de la API** (fetchClima throw) → `null`, no rompe la vista.
5. Cliente `weather-api`: parsea `temperature.degrees`; error HTTP/timeout → error tipado.
6. Endpoint: con clima → `temperatura_ambiente_c` presente; sin proyecto/clima → `null` (feature off).
7. UI: stat ambiente distinta de la de carga + atribución visible.

## Conteo estimado de llamadas/mes

Solo se llama cuando alguien **ve un vehículo en vivo** y su celda está fría. Con TTL 30 min:
≤ 2 llamadas por celda activa por hora, por instancia de Cloud Run. Flota ~5 vehículos con telemetría
→ pocas celdas simultáneas. Estimación en el PR (holgado bajo el free tier 10k/mes).

## Fuera de alcance

Histórico de clima, clima en la traza (capa 2), forecast. Solo "current condition" efímero.
