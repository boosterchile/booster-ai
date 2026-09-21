# Plan — gestor documental del viaje (UI)

Orden: spec primero, luego cliente tipado, panel, wiring, evidencia.

1. **Spec** — este directorio (`spec` / `plan` / `verify`).
2. **Cliente** — `apps/web/src/lib/transport-documents-api.ts`: Zod sobre las 4 respuestas; `api.postForm` multipart (sin `Content-Type` JSON); mapper de errores (503 `storage_unavailable` → copy fiel).
3. **Panel** — `TransportDocumentsPanel` (`tripId` + `canWrite`): lista, input file, status vos, descarga via `download_url`, formulario mínimo de ingreso manual.
4. **Wiring oficina** — `/app/asignaciones/$id`: resolver `tripId` desde `trip_request.id`.
5. **Wiring generador** — `/app/cargas/$id/track`: `tripId` = param de ruta; compacto en el bottom card.
6. **Tests** — RTL del panel (lista, upload 202, 503, manual-entry, descarga) + asserts de wiring en las dos rutas.
7. **Evidencia** — vitest web, typecheck, biome. Sin tocar API ni document-service.
