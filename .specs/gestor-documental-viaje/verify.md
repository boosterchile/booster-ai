# Verify / smoke — gestor documental del viaje

## Automático (CI / local)

```bash
pnpm --filter @booster-ai/web exec vitest run \
  src/lib/transport-documents-api.test.ts \
  src/lib/api-client.test.ts \
  src/components/transport-documents/TransportDocumentsPanel.test.tsx \
  src/routes/asignacion-detalle.test.tsx \
  src/routes/carga-track.test.tsx
pnpm --filter @booster-ai/web typecheck
pnpm exec biome check \
  apps/web/src/lib/api-client.ts \
  apps/web/src/lib/transport-documents-api.ts \
  apps/web/src/components/transport-documents/TransportDocumentsPanel.tsx \
  apps/web/src/routes/asignacion-detalle.tsx \
  apps/web/src/routes/carga-track.tsx
```

## Smoke manual (tras deploy; no bloquea el PR)

1. Oficina transportista (`despachador+`) abre `/app/asignaciones/:id` de un viaje vigente → panel «Documentos de transporte».
2. Subí un PDF (Guía 52 / Factura 33) ≤15 MB → aparece en la lista como **Pendiente** (202). Si el entorno no tiene bucket: *«El archivo no se pudo guardar (storage). Reintentá más tarde.»* — no crash.
3. Descargá → abre la signed URL (o mensaje honesto si `download_url` es null).
4. Generador abre `/app/cargas/$id/track` del mismo viaje → ve el mismo doc; puede subir otro.
5. Doc en **Falló la lectura** (o Pendiente eterno): Completar a mano (tipo, folio, RUTs, fecha, monto) → Guardá → status **Ingreso manual**.
6. Rol `conductor`/`visualizador`: ve la lista, no ve «Subí» ni el form manual (API 403 `write_role_required` si se fuerza).
