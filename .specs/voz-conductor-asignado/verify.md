# Verificación

Corrido en `apps/web` con Vitest (jsdom), sin sesión de producción.

```
Test Files  6 passed (6)
Tests  83 passed (83)
```

Archivos: `es-conductor-del-viaje`, `use-voice-command`, `voice-commands`, `VoiceAcceptOfferControl`, `IncidentReportCard`, `asignacion-detalle`.

Coverage de ese conjunto (v8): líneas 95.83 %, ramas 89.36 %, funciones 96.66 %.

`tsc --noEmit` en `apps/web` sin errores. Biome check de los archivos tocados sin errores.

No se abrió `app.boosterchile.com`: la captura trae datos reales y esta sesión no tiene login de esa empresa. La visibilidad y el flujo de voz quedaron cubiertos por los tests de render y el mock de `SpeechRecognition`.

## Tarjeta de voz solo para el dueño con ficha (2026-10-20)

`GET /me` no traía la ficha. `GET /conductores` sí lista `user_id`, pero devuelve licencia, RUT y teléfono de toda la empresa. Se agregó `tiene_ficha_conductor` en el `GET /me` ya autenticado. `POST /offers/:id/accept` no se tocó.

```
apps/web: vitest ofertas-voz-dueno.test.tsx + ofertas.test.tsx
Test Files  2 passed (2)
Tests  13 passed (13)

apps/api: vitest me-ficha-conductor + me-onboarding-google-path + me-platform-admin + me-profile
Test Files  4 passed (4)
Tests  22 passed (22)
```

`tsc --noEmit` en `apps/web` y `apps/api` sin errores. Biome check de los archivos tocados sin errores. `lint-rls`: 0 queries sin filtro `empresaId`.
