# Plan — chat in-app del viaje

Orden TDD (dominio crítico: escritura del chat).

1. **Rojo** — `POST /messages` con `assignmentStatus=recogido` debe ser 201; hoy es 409.
2. **Fix API** — allowlist `{asignado, recogido}` en POST mensaje y photo-upload-url.
3. **SSE/UI** — polling ~4 s cuando `!isLive`; label «Actualizando»; reconnect pide ticket nuevo.
4. **Conductor** — montar `ChatPanel` en la tarjeta activa (`readOnly` si `entregada`).
5. **Deep-link** — ruta `/app/chat/$id` (WA/push ya la emiten).
6. **Contrato WA** — comentarios en fallback + config: notify-only, in-app SoR.
7. **Evidencia** — tests api/web, biome, typecheck, build.
