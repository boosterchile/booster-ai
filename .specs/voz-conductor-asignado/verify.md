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
