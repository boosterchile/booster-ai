# Gestor documental del viaje (UI oficina + generador)

**Estado**: aceptada (brief #4 del PO, 2026-09-21) · **Rama**: `cursor/gestor-documental-viaje-b169` · **Base**: `origin/main` @ `07675b7` (#691)

**Slot**: paso 2 del Slot 3 «Conductor operativo» (`docs/frentes-vivos.md`): *«Subida del documento de transporte por la oficina en `/app/asignaciones/:id` (el endpoint `POST /transport-orders/:id/documents` existe; falta la pantalla)»*.

**Excepción explícita del PO** (Felipe Vicencio, `dev@boosterchile.com`, 2026-09-21, mandato noche «todas»): excepción al freeze de máximo 3 slots **solo** porque este trabajo **ya es** el paso 2 del Slot 3; no abre frente nuevo. **No se modifica** `docs/frentes-vivos.md`. Patrón PR: igual que #689/#690/#691.

## 1. El problema

La API F4-4a ya está en `main` (`apps/api/src/routes/transport-documents.ts`):

- `POST /transport-orders/:id/documents` (multipart `file`, PDF/JPEG/PNG ≤15 MB, magic bytes) → 202 `{ document_id, extraction_status }`
- `GET /transport-orders/:id/documents` → lista metadatos
- `GET /documents/:id` → detalle + `download_url` signed
- `POST /documents/:id/manual-entry` → corrige campos → `ingreso_manual`

Authz: generador dueño del viaje **o** transportista con assignment vigente (`asignado|recogido|entregado`); escrituras `dueno|admin|despachador`.

**Falta la UI.** Sin pantalla, ops no puede adjuntar Guía 52 / Factura 33 y el gate `REQUIRE_DOCUMENT_TO_CLOSE` no se puede reactivar sobre cohorte real.

## 2. Regla de producto

- Oficina transportista y generador de carga ven **la misma superficie** (un componente reutilizado) sobre el **viaje** (`tripId`), no sobre el assignment id.
- Subida multipart al endpoint existente. MIME allowlist: `application/pdf`, `image/jpeg`, `image/png`.
- Status de extracción en español humano, **vos** rioplatense (Empezá / Subí / Guardá). Zero «tú».
- Si `TRANSPORT_DOCUMENTS_BUCKET` ausente, API 503 `storage_unavailable` → mensaje honesto, no crash: *«El archivo no se pudo guardar (storage). Reintentá más tarde.»*
- Ingreso manual cuando el status es `fallido`, o `pendiente`/`procesando` (pendiente eterno: el worker TED es F4-4b, fuera de alcance; en local/prod sin 4b el doc queda `pendiente`).
- Lectura abierta a cualquier rol del tenant autorizado; escritura solo `dueno|admin|despachador` (el API ya lo exige).

## 3. Entradas y salidas

**Reuso (no se reinventan endpoints):** los 4 de F4-4a. Cliente tipado con Zod porque las respuestas mezclan snake/camel:

| Endpoint | Shape |
|---|---|
| GET lista | camelCase Drizzle (`docType`, `extractionStatus`, `createdAt`) |
| GET detalle | snake_case (`doc_type`, `extraction_status`, `download_url`) |
| POST upload | snake_case (`document_id`, `extraction_status`) |
| POST manual-entry | snake_case + `ok` |

**Web:**

- `/app/asignaciones/$id` (`asignacion-detalle`): panel «Documentos de transporte». El `tripId` sale de `GET /assignments/:id` → `trip_request.id` (el param de ruta es assignment id).
- `/app/cargas/$id/track` (`carga-track`): mismo componente. El param de ruta **es** el trip id; se monta aunque todavía no haya assignment (el generador dueño está autorizado).

**Copy (vos):**

- Título: Documentos de transporte
- CTA subida: Subí un PDF o una foto
- Vacío: Todavía no hay documentos. Empezá subiendo la guía o la factura.
- Descargar: Descargá
- Manual: Completar a mano → Guardá
- Status: Pendiente / Procesando / Decodificado / Ingreso manual / Falló la lectura

## 4. Criterios de salida

- [ ] Oficina (despachador+) en `/app/asignaciones/:id` sube un PDF y ve el doc en la lista con status `pendiente` (o mensaje 503 honesto sin bucket).
- [ ] Generador ve/sube lo mismo desde `/app/cargas/$id/track`.
- [ ] Manual-entry funciona cuando el status es `fallido` (y también en `pendiente`/`procesando`).
- [ ] Tests RTL del componente + wiring en las dos rutas. Typecheck + biome + harness existentes verdes.
- [ ] PR draft a `main` con `## Evidencia`, excepción PO, fuera de alcance explícito. Spec en `.specs/gestor-documental-viaje/`.

## 5. Fuera de alcance

- Worker TED / `apps/document-service` / Pub/Sub / packages TED (F4-4b).
- Flags `REQUIRE_DOCUMENT_TO_CLOSE` / `REQUIRE_TED_DECODE` / fecha de corte en prod.
- `docs/frentes-vivos.md`, `es_demo`, chat, tracking, zonas, Fleet, certificados PDF carbono, Sovos/SII emisión.
- Docs de cumplimiento vehículo/conductor (`/documentos/vehiculo|conductor`).
- Endpoints nuevos.
