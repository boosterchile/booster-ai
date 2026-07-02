# repositorio-documental-transporte — Spec (Frente F4)

**Generado por**: skill `arquitecto-maestro` (sub-spec del programa `pivote-documental-y-cierre-legal-2026-06`)
**Fecha**: 2026-06-18
**Status**: **Draft — pendiente aprobación PO** (no ejecutar Fase Act sin firma en §13)
**PO**: Felipe Vicencio — dev@boosterchile.com
**Plan maestro**: [`.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`](../pivote-documental-y-cierre-legal-2026-06/spec.md) §7 (F4)
**ADRs vinculados**: ADR-070 (nuevo, este frente) · modifica/complementa [ADR-007](../../docs/adr/007-chile-document-management.md) (recepción/OCR) · referencia [ADR-069](../../docs/adr/069-booster-deja-de-emitir-dte-remocion-sovos.md) (Booster receptor/archivador, ya en `main`)

> Este documento es el **spec TDD-ready** del frente F4. Diseña comportamiento, contratos, datos, riesgos y la **matriz de tests primero**. No es código de producción. Su ejecución (red→green→refactor) ocurre en sub-fases 4a/4b/4c con PRs independientes, **después** de aprobado este spec.

---

## 1. Objective

Construir el **repositorio documental por orden de transporte** de Booster: el generador de carga o el transportista sube el PDF o la foto de la **Guía de Despacho (DTE tipo 52)** y/o la **Factura (tipo 33)** que ampara la carga de una orden (`viajes`), para poder **cerrar la orden**. Un worker decodifica el **TED** (Timbre Electrónico Documento, PDF417) en modo *best-effort* y extrae metadatos verificables.

Restricción de alcance del producto (decisión PO, ADR-069 ya en `main`): **Booster NO emite DTE ni se integra con el SII en esta fase**. Solo **recibe y archiva** documentos tributarios de **terceros**, con extracción best-effort del TED. No hay generación, firma, folio CAF propio, ni presentación al SII.

Comportamiento observable al cierre de F4:

- El generador o el transportista sube un PDF/foto a una orden → se persiste una fila `pendiente` en `documentos_transporte` y se publica `document.uploaded` → el endpoint responde `202`.
- Un worker Cloud Run separado descarga el archivo, rasteriza/preprocesa, decodifica el PDF417, parsea el XML del `<TED>` y persiste `decodificado` (con campos del `<DD>`) o `fallido`.
- Una foto ilegible queda `fallido`; el usuario corrige los campos vía `manual-entry` → `ingreso_manual`.
- La orden es **cerrable con ≥1 documento subido correctamente**, decodifique el TED o no (`REQUIRE_TED_DECODE=false` por defecto).
- Cada documento queda con `retention_until` calculado y archivado en GCS sin borrado automático.

## 2. Why now

- **Dependencia F3→F4 desbloqueada**: F3 (remover Sovos, ADR-069) ya está en `main`. ADR-069 §3 declara explícitamente que "la recepción y archivo documental de terceros (tabla `documentos_transporte`, worker TED, repositorio documental) **se diseña en F4**". Es el frente que da contenido al nuevo rol receptor/archivador.
- **Cierre de orden hoy no exige respaldo documental**: `confirmarEntregaViaje` transiciona a `entregado` sin ningún documento que ampare la carga. Operacionalmente el negocio necesita la Guía/Factura adjunta a la orden (prueba de la carga transportada) antes de darla por cerrada.
- **Skeletons a saldar**: `apps/document-service` y `packages/document-indexer` son skeletons (`PACKAGE_NAME` placeholder; `main.ts` solo loggea "starting (skeleton)"). F4 los convierte en el worker real (deuda day-0 eliminada, no app nueva — ver O-4).
- **Bucket `documents` ocioso**: tras la remoción de emisión DTE, el bucket `documents` (storage.tf:119, retención SII 6a `is_locked=false`) quedó sin tráfico. ADR-069 §6 lo dejó "para decisión en F4 (O-9): si F4 no los reusa para recepción, se remueven ahí". F4 lo reutiliza.

## 3. Success criteria (measurable)

**Datos + dominio (4a):**
- [ ] Migración **0044** (expand-only) crea la tabla `documentos_transporte` (FK `viaje_id` → `viajes.id`), 3 `pgEnum` nuevos (`doc_type`, `extraction_status`, `source`), índices por `viaje_id` y `extraction_status`. Guard CI expand/contract (P1-H / ADR-066) verde.
- [ ] DDL Drizzle canónico en `apps/api/src/db/schema.ts` coincide 1:1 con el schema Zod de dominio nuevo en `packages/shared-schemas/src/domain/transport-document.ts` (test de paridad si aplica, como `trip-state-machine-parity`).
- [ ] Naming bilingüe: tabla SQL `documentos_transporte`; export TS `transportDocuments` / `TransportDocumentRow`. Enum values en **español** (`pendiente`/`procesando`/`decodificado`/`ingreso_manual`/`fallido`).

**API (4a):**
- [ ] 4 endpoints Hono operativos con Zod en boundaries (`@hono/zod-validator` para JSON; validación manual MIME/size para multipart, patrón `site-settings.ts`), auth existente, `trace_id` + span OTel + log estructurado por endpoint, cero `console.*`.
- [ ] `POST /transport-orders/:id/documents` persiste fila `pendiente`, sube el binario a GCS, publica `document.uploaded`, responde `202`.
- [ ] `POST /documents/:id/manual-entry` corrige `doc_type/folio/ruts/fecha/monto` → `extraction_status=ingreso_manual`.
- [ ] `GET /transport-orders/:id/documents` lista; `GET /documents/:id` devuelve detalle + signed URL v4 de descarga (patrón `certificate-generator/storage.ts`).
- [ ] Autorización por tenant: solo el generador de carga dueño de la orden o el transportista asignado pueden subir/leer/corregir; IDOR cross-empresa → `403`.

**Worker TED (4b):**
- [ ] Servicio Cloud Run construido sobre `apps/document-service` (skeleton eliminado), consumer Pub/Sub patrón `telemetry-processor` (Zod `safeParse` + ack/nack + DLQ tras N intentos).
- [ ] Un PDF de Guía de Despacho de ejemplo (con PDF417 legible) → `decodificado` con los campos del `<DD>` correctos.
- [ ] Una foto ilegible → `fallido`; payload Pub/Sub malformado → `ack` que descarta (no reintenta); N nacks → DLQ.
- [ ] **Tags del TED validados contra `formato_dte_202602.pdf` del SII** (https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) **antes** de fijar el parser (constraint bloqueante — ver §6 C-7).
- [ ] Lógica de dominio (interface `DocumentIngestor`, `PdfTedIngestor`, parser `<DD>`) vive en `packages/transport-documents` (nuevo), **no inline** en el worker.
- [ ] `Dockerfile` WASM-only: sin `apt-get` de binarios de sistema; `sharp` solo vía binario prebuilt npm (ver R-4 / O-5).

**Cierre flexible + stub (4c):**
- [ ] Orden cerrable con ≥1 documento subido aunque el TED no decodifique (`REQUIRE_TED_DECODE=false` por defecto). Test de regresión: cierre sin documento alguno se rechaza solo si `REQUIRE_DOCUMENT_TO_CLOSE=true`; con el default acordado el cierre exige ≥1 documento subido.
- [ ] `XmlIntercambioIngestor` stub (interface + no-op), sin conexión SII.

**Programa:**
- [ ] `pnpm ci` verde (lint 0, typecheck 0, coverage ≥80% en código nuevo, build OK) en cada PR.
- [ ] ADR-070 mergeado antes de implementar; sección `## Evidencia` en cada PR.

## 4. User-visible behaviour

| Actor | Antes | Después |
|---|---|---|
| Generador de carga | No hay forma de adjuntar la guía/factura que ampara la carga | Sube PDF/foto a la orden vía `POST /transport-orders/:id/documents`; ve estado de extracción (`pendiente`→`decodificado`/`fallido`) vía `GET /documents/:id` + polling/SSE; descarga con signed URL |
| Transportista | No hay forma de respaldar la carga transportada | Igual que el generador, sobre las órdenes donde está asignado |
| Usuario tras foto ilegible | (no existía el flujo) | El doc queda `fallido`; corrige `doc_type/folio/ruts/fecha/monto` vía `POST /documents/:id/manual-entry` → `ingreso_manual` |
| Cierre de orden | `entregado` sin respaldo documental | Requiere ≥1 documento subido; el TED es enriquecimiento, no bloqueo (`REQUIRE_TED_DECODE=false`) |
| Operador GCP | Bucket `documents` ocioso, `document-service` skeleton | Bucket `documents` recibe terceros; worker `document-service` real consumiendo `document.uploaded` con DLQ |

**No visible (out of scope para esta fase)**: ningún cambio de UI en `apps/web` está en este spec salvo el consumo de los endpoints; el detalle de pantallas se dimensiona aparte. El estado realtime se sirve por **polling `GET /documents/:id`** + el **canal SSE existente** (no Firestore — ver §5).

## 5. Out of scope

- **Emisión de DTE de cualquier tipo / integración SII**: Booster no emite ni presenta. Confirmado por ADR-069. F4 solo recibe/archiva.
- **Espejo Firestore** (decisión PO 2026-06-17, plan maestro §5): Postgres es la única fuente de verdad. Estado realtime vía polling `GET /documents/:id` + canal SSE existente. Firestore queda diferido como mejora futura, no dependencia.
- **Conexión real al canal XML de Intercambio entre Contribuyentes (EnvioDTE)**: solo interfaz `DocumentIngestor` + stub `XmlIntercambioIngestor` no-op, sin conexión SII (Tarea 6 del plan maestro).
- **Purga / borrado de documentos dentro del período de retención**: PROHIBIDO. No se implementa purga en esta fase, solo el **cálculo** de `retention_until`. La purga futura quedará detrás de `ENABLE_RETENTION_PURGE=false` (no implementada acá) — ver O-3 en §6 y §11.
- **DROP o lifecycle-delete de objetos GCS / cascada al cerrar orden**: prohibido. Transición a Nearline/Coldline OK (sin eliminar).
- **OCR de texto libre / Document AI / Gemini** (ADR-007 §OCR): F4 extrae **solo del TED PDF417** (determinista, verificable). El OCR de cuerpo del documento (no-TED) queda fuera; si se necesita, es un frente posterior.
- **Validación de RUT/folio contra el SII** (¿el documento existe en el SII?): fuera. F4 archiva lo que el tercero sube; la firma del TED se valida criptográficamente offline (flag `VALIDATE_TED_SIGNATURE`), no contra el SII.
- **Cambios de pantallas en `apps/web`**: el wiring de UI se dimensiona en spec aparte.

## 6. Constraints

- **C-1 Stack Booster no-negociable** (CLAUDE.md): zero `any`, Zod en boundaries, `@booster-ai/logger` (no `console.*`), OTel + `trace_id` por endpoint, coverage ≥80%, Conventional Commits con scope, sección `## Evidencia` en cada PR.
- **C-2 Naming bilingüe** (CLAUDE.md, no-negociable): SQL español snake_case sin tildes → tabla **`documentos_transporte`** (NO `transport_documents`), FK a **`viajes`** (NO `transport_orders`). Export TS **`transportDocuments`** / `TransportDocumentRow`. Enum **values en español** snake_case sin tildes; las siglas tributarias (`33`/`52`/...) son códigos del SII y se conservan literales.
- **C-3 Domain canónico** en `packages/shared-schemas/src/domain/`; toda tabla Drizzle coincide con un schema del domain. DDL Drizzle canónico en `apps/api/src/db/schema.ts`. Nota: el bloque de imports de `schema.ts` **no importa `date` hoy** (sí `numeric`, `text`, `boolean`, `timestamp`, `pgEnum`, `uuid`); la migración debe añadir `date` al import.
- **C-4 Algoritmos en packages**: la lógica de decodificación TED (rasterizar, PDF417, parseo `<DD>`, validación firma) vive en `packages/transport-documents`, **no inline** en `apps/document-service` ni en services de `apps/api`.
- **C-5 TDD obligatorio** (`booster-skills:tdd-dominio-critico`): F4 toca **documentos tributarios + migración de BD + lógica de cierre de orden** → dominio crítico. Red→green→refactor obligatorio en: el parser del TED, el cálculo de `retention_until`, la migración, y la regla de cierre flexible. Los endpoints HTTP y el wiring del consumer Pub/Sub son TDD-recomendado (tests de integración).
- **C-6 Migración expand-only** (ADR-066 / guard CI P1-H): solo `CREATE TYPE`/`CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX`; sin `DROP`. Número **0044** (último en `main` es `0043_consent_evidencia_21719`). **Colisión potencial con PR #428** (que también reservaría un número de migración): al ejecutar 4a, re-verificar `drizzle/meta/_journal.json` y, si #428 tomó 0044, renumerar a 0045 (la migración no tiene dependencias de orden con #428).
- **C-7 (bloqueante) Validar tags del TED contra el doc oficial SII** `formato_dte_202602.pdf` (https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) **ANTES de fijar el parser**. El mapeo `<DD>` (RE/TD/F/FE/RR/RSR/MNT) y la estructura `<TED><DD>...</DD><FRMT>...</FRMT></TED>` deben confirmarse contra ese PDF; un tag mal mapeado escribe metadatos legales incorrectos (R-5). Ningún parser se da por terminado sin esta verificación documentada en la Evidencia de 4b.
- **C-8 Worker WASM-only**: `Dockerfile` sin binarios de sistema gestionados a mano (`apt-get`). Rasterización PDF con `@hyzyla/pdfium` (WASM), decodificación PDF417 con `zxing-wasm` (WASM). `sharp` permitido **solo** para preprocesamiento de **fotos** (grises/contraste/perspectiva) vía binario prebuilt npm (no compila libvips a mano). Ver R-4 / O-5.
- **C-9 Secretos**: Secret Manager vía Terraform, nunca en código. Flags de comportamiento (`REQUIRE_TED_DECODE`, `VALIDATE_TED_SIGNATURE`, `REQUIRE_DOCUMENT_TO_CLOSE`, `ENABLE_RETENTION_PURGE`) son env vars validadas con `booleanFlag()` de `@booster-ai/config` (NO `z.coerce.boolean()` — footgun, memoria Redis TLS 2026-06).
- **C-10 Pub/Sub + DLQ por Terraform** (`infrastructure/messaging.tf`): topic `document.uploaded` + subscription pull dedicada con `dead_letter_policy` (`max_delivery_attempts`, patrón existente = 5) + `retry_policy`. No crear topics/subscriptions desde código.
- **C-11 ADR antes de implementar** (ADR-070), no en retrospectiva. ADR no se edita: se supersede.

## 7. Approach

### Hosting (decisión PO ya tomada — no re-abrir)

- **Dominio** → package nuevo `packages/transport-documents`: interface `DocumentIngestor`, `PdfTedIngestor` (principal), parser del `<DD>`, validación de firma `<FRMT>`, cálculo de `retention_until`, `XmlIntercambioIngestor` (stub). Funciones puras testeables sin red.
- **API** → 4 endpoints Hono montados en `apps/api` (router nuevo, p.ej. `apps/api/src/routes/transport-documents.ts`).
- **Worker** → servicio Cloud Run **separado** suscrito a `document.uploaded`, construido **sobre `apps/document-service`** (reutiliza el skeleton, elimina esa deuda; O-4 resuelto a favor de reusar). Consume `packages/transport-documents`.
- **Firestore fuera** (diferido). Postgres única fuente; realtime por polling + SSE existente.

### Tabla `documentos_transporte` (Drizzle, español)

DDL canónico en `apps/api/src/db/schema.ts`. Columnas (SQL snake_case sin tildes → TS camelCase):

| TS (camelCase) | SQL (snake_case) | Tipo Drizzle | Notas |
|---|---|---|---|
| `id` | `id` | `uuid('id').primaryKey().defaultRandom()` | PK |
| `viajeId` | `viaje_id` | `uuid('viaje_id').notNull().references(() => trips.id, { onDelete: 'restrict' })` | FK a `viajes`. `restrict`: NO cascada al borrar/cerrar orden (O-3) |
| `filePath` | `file_path` | `text('file_path').notNull()` | objeto GCS (no URI completa; bucket viene de env) |
| `fileMime` | `file_mime` | `text('file_mime').notNull()` | MIME validado en upload |
| `docType` | `doc_type` | `docTypeEnum('doc_type').notNull()` | enum `33`/`34`/`52`/`56`/`61`/`other` |
| `folio` | `folio` | `text('folio')` | nullable hasta decodificar |
| `rutEmisor` | `rut_emisor` | `text('rut_emisor')` | nullable; `<DD><RE>` |
| `razonSocialEmisor` | `razon_social_emisor` | `text('razon_social_emisor')` | nullable |
| `rutReceptor` | `rut_receptor` | `text('rut_receptor')` | nullable; `<DD><RR>` |
| `razonSocialReceptor` | `razon_social_receptor` | `text('razon_social_receptor')` | nullable; `<DD><RSR>` |
| `fechaEmision` | `fecha_emision` | `date('fecha_emision')` | nullable; `<DD><FE>`. **Insumo de `retention_until`** |
| `montoTotal` | `monto_total` | `numeric('monto_total', { precision: 14, scale: 2 })` | nullable; `<DD><MNT>` (CLP entero, scale 2 por defensa) |
| `tedRaw` | `ted_raw` | `text('ted_raw')` | XML crudo del `<TED>` decodificado; nullable |
| `tedSignatureValid` | `ted_signature_valid` | `boolean('ted_signature_valid')` | **nullable**: NULL = no validada (flag off); true/false = validada |
| `extractionStatus` | `extraction_status` | `extractionStatusEnum('extraction_status').notNull().default('pendiente')` | `pendiente`/`procesando`/`decodificado`/`ingreso_manual`/`fallido` |
| `source` | `source` | `documentSourceEnum('source').notNull()` | `pdf_upload`/`photo_upload`/`xml_intercambio` |
| `retentionUntil` | `retention_until` | `date('retention_until')` | nullable hasta calcular (O-3) |
| `uploadedBy` | `subido_por` | `uuid('subido_por').references(() => users.id)` | quién subió |
| `createdAt` | `creado_en` | `timestamp('creado_en', { withTimezone: true }).notNull().defaultNow()` | |
| `updatedAt` | `actualizado_en` | `timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow()` | |

Índices: `idx_documentos_transporte_viaje` (sobre `viaje_id`), `idx_documentos_transporte_estado` (sobre `extraction_status`, para el worker/listados).

`pgEnum` nuevos (SQL names en español donde aplica; values de `doc_type` son códigos SII literales):
```
docTypeEnum            = pgEnum('tipo_documento_transporte', ['33','34','52','56','61','other'])
extractionStatusEnum   = pgEnum('estado_extraccion', ['pendiente','procesando','decodificado','ingreso_manual','fallido'])
documentSourceEnum     = pgEnum('origen_documento', ['pdf_upload','photo_upload','xml_intercambio'])
```

Schema Zod de dominio: `packages/shared-schemas/src/domain/transport-document.ts` (`transportDocumentSchema`, `docTypeSchema`, `extractionStatusSchema`, `documentSourceSchema`), derivando tipos con `z.infer<>`. Patrón idéntico a `domain/trip-event.ts`.

### Migración 0044 (expand-only)

`CREATE TYPE` de los 3 enums + `CREATE TABLE documentos_transporte` + `CREATE INDEX` ×2. Sin `DROP`, sin `NOT NULL` retroactivo sobre tablas existentes (es tabla nueva, así que `NOT NULL` interno es seguro). Cabecera-comentario con riesgo de despliegue, igual que `0043`. Guard CI expand/contract verde.

### 4 endpoints Hono (`apps/api`)

Auth con el helper existente (`requireShipperAuth` / equivalente carrier; ver `trip-requests-v2.ts`). Multipart con `c.req.formData()` + `instanceof File` + validación MIME allowlist (`application/pdf`, `image/jpeg`, `image/png`) + size máx (constante, p.ej. 15 MB) — patrón `site-settings.ts`. GCS upload con `getStorage()` singleton (patrón `certificate-generator/storage.ts`). Signed URL v4 `action:'read'` TTL corto.

1. **`POST /transport-orders/:id/documents`** → valida orden existe + actor autorizado (dueño generador o transportista asignado); valida MIME/size; `file_path = transport-documents/{viajeId}/{uuid}.{ext}`; `save()` a bucket `documents`; INSERT fila `extraction_status='pendiente'`, `source` según MIME (`pdf_upload`/`photo_upload`); publica `document.uploaded` `{ documentId, viajeId, filePath, fileMime }`; responde `202 { documentId, extractionStatus:'pendiente' }`.
2. **`POST /documents/:id/manual-entry`** → Zod JSON (`docType?`, `folio?`, `rutEmisor?`, `razonSocialEmisor?`, `rutReceptor?`, `razonSocialReceptor?`, `fechaEmision?`, `montoTotal?`); valida actor autorizado; UPDATE campos provistos + `extraction_status='ingreso_manual'`; **recalcula `retention_until`** (si `fechaEmision` provista → `fechaEmision + 6a`; si no, fallback `created_at + 6a` + marca de revisión). Responde `200`.
3. **`GET /transport-orders/:id/documents`** → lista las filas de la orden (actor autorizado). Sin binarios, solo metadatos + `extractionStatus`.
4. **`GET /documents/:id`** → detalle + `downloadUrl` (signed URL v4). Es el endpoint de **polling** para el estado de extracción.

### Worker TED (`apps/document-service`, Cloud Run, sub-fase 4b)

Consumer Pub/Sub `document.uploaded` (patrón `telemetry-processor/src/main.ts`): `JSON.parse` → `documentUploadedMessageSchema.safeParse` → si falla, `message.ack()` + log error (descartar, no reintentar); si OK:

1. UPDATE fila → `extraction_status='procesando'`.
2. Descarga el objeto de GCS (`file_path`).
3. **PDF** (`pdf_upload`): `@hyzyla/pdfium` rasteriza la(s) página(s) a imagen → `zxing-wasm` decodifica PDF417.
4. **Foto** (`photo_upload`): `sharp` preprocesa (escala de grises, contraste, deskew/perspectiva) → `zxing-wasm` PDF417. (R-4: si O-5 exige WASM estricto, `sharp` se reemplaza/omite; `zxing-wasm` tolera imágenes sin preprocesar a costa de tasa de acierto.)
5. Parsea el XML del `<TED>` con `fast-xml-parser`, mapeando `<DD>` → columnas (mapeo a confirmar contra C-7):
   - `RE` → `rut_emisor`
   - `TD` → `doc_type`
   - `F` → `folio`
   - `FE` → `fecha_emision`
   - `RR` → `rut_receptor`
   - `RSR` → `razon_social_receptor`
   - `MNT` → `monto_total`
   - (`razon_social_emisor` no viene en el `<DD>` — queda NULL hasta manual-entry; confirmar en C-7.)
6. **Flag `VALIDATE_TED_SIGNATURE`** (default off): valida la firma `<FRMT>` (algoritmo SHA1withRSA) con la clave pública del `<CAF>` embebido, vía `node:crypto`. Persiste `ted_signature_valid` (true/false); con flag off queda NULL.
7. Calcula `retention_until` (ver abajo) y persiste `extraction_status='decodificado'` (con `ted_raw` + campos) o `fallido` (sin campos).
8. ack. En error transitorio (GCS/DB) → `message.nack()` → reintento → DLQ tras `max_delivery_attempts` (5).

**Cálculo de `retention_until` (O-3, dominio crítico, función pura en `packages/transport-documents`):**
- Si hay `fecha_emision` (decodificado o manual con fecha): `retention_until = fecha_emision + 6 años`.
- Fallback (manual_entry sin fecha, o `fallido`): `retention_until = created_at + 6 años` **+ marca para revisión** (campo/flag de revisión — p.ej. log estructurado + bandera derivable; no hay columna dedicada en el set mínimo, evaluar en 4b si se añade `needs_retention_review`).
- Fundamento legal: Código Tributario DL 830 Art. 17/200. **PROHIBIDO borrado automático dentro del período**; sin `lifecycle delete` de GCS; sin cascada al cerrar orden. Purga solo tras `retention_until`, auditable, detrás de `ENABLE_RETENTION_PURGE=false` (NO se implementa purga en F4, solo el cálculo). Transición a Nearline/Coldline OK.

`Dockerfile` WASM-only (C-8): imagen base Node slim, sin `apt-get install` de libs nativas; `@hyzyla/pdfium` y `zxing-wasm` son WASM prebuilt; `sharp` instala su binario prebuilt npm para la plataforma del runtime.

### Regla de cierre flexible (sub-fase 4c, dominio crítico, TDD)

El "cierre" de una orden = la transición a `entregado` en `confirmarEntregaViaje` (`apps/api/src/services/confirmar-entrega-viaje.ts`); `entregado` es estado terminal en `trip-state-machine`. Se añade una **precondición** antes del UPDATE a `entregado`:

- Si `REQUIRE_DOCUMENT_TO_CLOSE=true` (default **true** — O-7 resuelta 2026-06-18): la orden requiere ≥1 documento subido correctamente (subido = fila existe y el objeto GCS existe), independiente del estado de extracción. **Solo aplica a viajes creados tras la activación del flag** (comparar `viajes.creado_en` ≥ fecha de corte); las órdenes legacy ya `entregado` o en curso quedan **exentas** (no bloquear viajes en ruta sin documento).
- `REQUIRE_TED_DECODE=false` por defecto: el TED decodificado **no** es condición de cierre. Una orden con un documento subido cuyo TED quedó `fallido`/`pendiente` **es cerrable**.
- La precondición vive como guard en el service (orquestación), consultando `documentos_transporte`; la *semántica* de "qué cuenta como documento válido para cerrar" se aísla en una función pura testeable (p.ej. `puedeCerrarConDocumentos(docs, flags)` en `packages/transport-documents` o un guard del service). No tocar la tabla de transiciones de `trip-state-machine` (la legalidad `asignado|en_proceso → entregado` no cambia; lo que se añade es una precondición de negocio).

### Canal XML opcional (stub, sub-fase 4c)

`interface DocumentIngestor { ingest(input): Promise<IngestResult> }` en `packages/transport-documents`. `PdfTedIngestor` implementa el flujo real (4b). `XmlIntercambioIngestor` implementa la interface como **no-op** (lanza `NotImplementedError` o devuelve `{ status: 'no_implementado' }`), sin conexión SII. Documenta el futuro: recepción de `EnvioDTE` por el canal de **Intercambio entre Contribuyentes** (no es API SII; es intercambio directo emisor↔receptor).

### Infraestructura (Terraform)

- `messaging.tf`: topic `document.uploaded` (añadir a `pubsub_topics`) + subscription pull `document-uploaded-processor-sub` con `dead_letter_policy` (`max_delivery_attempts=5`) + `retry_policy` (patrón `telemetry_events_processor`).
- Reusar bucket `documents` (storage.tf:119) para los objetos de terceros bajo prefijo `transport-documents/`. **No** activar `is_locked` (O-3: sin WORM obligatorio; tensión con ADR-069 — ver §11/§12). Verificar que el SA del worker tiene `objectViewer` y el SA de `apps/api` `objectCreator` sobre el bucket.
- SA del worker `document-service` con permisos mínimos (Pub/Sub subscriber, GCS objectViewer, Cloud SQL client).
- Si el worker requiere scaffolding nuevo de Cloud Run, seguir `booster-skills:adding-cloud-run-service` (reusando el directorio `document-service` existente, no app nueva — O-4).

### Sub-fases (orden de ejecución, PRs independientes)

| Sub-fase | Contenido | Dominio crítico (TDD obligatorio) |
|---|---|---|
| **4a** | Migración 0044 + schema Zod + 4 endpoints + regla de cierre flexible (guard + flags) | **Sí**: migración + cierre de orden. Endpoints: TDD-recomendado |
| **4b** | Worker TED (`document-service`) + `packages/transport-documents` (PdfTedIngestor, parser `<DD>`, firma, `retention_until`) + infra Pub/Sub/DLQ + Dockerfile | **Sí**: parser TED (documento tributario) + cálculo `retention_until` |
| **4c** | `XmlIntercambioIngestor` stub + endurecer/ajustar la regla de cierre con docs reales | Stub: no crítico; ajuste de cierre: sí |

> La regla de cierre flexible se prototipa en 4a (con flags) para no bloquear el cierre operacional; 4c la ajusta una vez 4b produce estados de extracción reales.

## 8. Risks

| ID | Riesgo | L | I | Mitigación |
|---|---|---|---|---|
| R-1 | Tags TED mal mapeados → metadatos legales incorrectos en documentos archivados | M | H | **C-7 bloqueante**: validar `<DD>`/`<TED>` contra `formato_dte_202602.pdf` antes de fijar el parser; test con Guía real decodificable; mapeo en función pura unit-testeada |
| R-2 | `retention_until` mal calculado → borrado prematuro o retención incorrecta de doc legal | M | H | Función pura TDD (con y sin `fecha_emision`); PROHIBIDO purga en F4; sin lifecycle-delete; fallback `created_at+6a` + marca de revisión |
| R-3 | `sharp` no es WASM (libvips nativo) — choca con "Dockerfile sin binarios" (C-8) | H | M | O-5: aceptar binario prebuilt npm de `sharp` (no compila libvips a mano) **solo** para fotos; o reemplazar por WASM (photon/jsquash); o omitir preprocesamiento (zxing tolera imágenes crudas, menor tasa de acierto) |
| R-4 | Procesamiento pesado (rasterizar PDF + PDF417) en request path agota concurrencia Cloud Run | — | — | Mitigado por diseño: el procesamiento va al worker separado vía Pub/Sub, no en el endpoint (que solo persiste + publica + 202) |
| R-5 | Worker como "app nueva" dispara el proceso de 11 pasos de `adding-cloud-run-service` | M | M | O-4 resuelto: reusar `apps/document-service` (skeleton existente), no app nueva |
| R-6 | Colisión de número de migración con PR #428 (0044) | M | L | C-6: re-verificar `_journal.json` al ejecutar 4a; renumerar a 0045 si #428 tomó 0044 (sin dependencia de orden) |
| R-7 | Documentos de terceros contienen PII (RUT, razón social) — superficie de privacidad | M | M | Bucket privado (`public_access_prevention=enforced`, `uniform_bucket_level_access`); signed URLs TTL corto; acceso por tenant; `security-scanner` (módulo compliance 19.628) sobre el diff |
| R-8 | Tensión O-3 vs ADR-069: ADR-069 §4 dice "sin WORM/Retention-Lock obligatorio" y "la retención de 6a del emisor deja de aplicar a Booster"; el brief O-3 (PO) ordena persistir `retention_until = fecha_emision + 6a` | M | M | Honrar el brief O-3 (decisión más reciente); ADR-070 debe **explicitar y reconciliar** la diferencia: la columna `retention_until` es política de custodia del **archivador**, distinta de la obligación del emisor que ADR-069 retiró. Confirmar con PO/legal (O-8) |
| R-9 | PDF417 con corrección de errores baja / TED dañado → tasa de `fallido` alta | M | M | `manual-entry` siempre disponible; cierre flexible no depende del decode; métricas de tasa decode vs fallido para observabilidad |

## 9. Alternatives considered (rejected)

- **Worker TED dentro de `apps/api`**: rechazado (plan maestro §9) — rasterizar PDF + PDF417 en el request path agota slots de concurrencia Cloud Run. Va a servicio separado por Pub/Sub.
- **App Cloud Run nueva para el worker**: rechazado a favor de reusar `apps/document-service` (skeleton, deuda day-0 que se salda; evita el proceso de 11 pasos de app nueva).
- **Espejo Firestore para estado realtime**: rechazado por PO — primer uso de Firestore en backend, superficie de riesgo dentro de feature crítica; polling + SSE existentes bastan.
- **OCR de texto libre (Document AI/Gemini, ADR-007)**: rechazado para F4 — el TED PDF417 da extracción determinista y verificable; el OCR no-TED es no-determinista y es otro frente.
- **`doc_type` como `varchar` libre**: rechazado — enum cerrado (`33`/`34`/`52`/`56`/`61`/`other`) hace el dominio explícito y validable; `other` cubre tipos no esperados sin romper el insert.
- **Borrado en cascada del documento al cerrar/cancelar la orden**: rechazado — viola O-3 (retención legal). FK `onDelete: 'restrict'`.
- **Activar `is_locked=true` en el bucket `documents`**: rechazado para F4 — el lock es irreversible (6a por objeto) y O-3 no exige WORM; se mantiene `false` (consistente con ADR-069).

## 10. Test list (TDD-ready)

> Orden: el test se escribe **antes** de la implementación (red→green→refactor). Marcados **[C]** los de dominio crítico (no negociables).

**Migración / schema (4a) [C]:**
- [C] La migración 0044 aplica limpia sobre un schema en `0043` (expand-only, sin DROP); el guard CI expand/contract pasa.
- [C] El schema Zod `transportDocumentSchema` y el DDL Drizzle tienen paridad de campos/enums (test de paridad, patrón `trip-state-machine-parity`).
- Enums SQL/TS coinciden en values (español; `doc_type` con códigos SII literales).

**Worker TED — decodificación (4b) [C]:**
- [C] PDF de Guía de Despacho de ejemplo con PDF417 legible → `extraction_status='decodificado'` con `rut_emisor`/`doc_type`/`folio`/`fecha_emision`/`rut_receptor`/`razon_social_receptor`/`monto_total` correctos según el `<DD>`.
- [C] El mapeo `<DD>` (RE/TD/F/FE/RR/RSR/MNT → columnas) coincide con `formato_dte_202602.pdf` (test de fixture con un `<TED>` de ejemplo del propio doc SII).
- [C] `doc_type` fuera del enum esperado → mapea a `other` sin romper el insert.
- Foto legible (tras preprocesamiento `sharp`) → `decodificado`.
- Foto ilegible / sin PDF417 → `extraction_status='fallido'`, sin campos `<DD>` poblados.
- `VALIDATE_TED_SIGNATURE=true` + firma `<FRMT>` válida → `ted_signature_valid=true`; firma inválida → `false`; flag off → `ted_signature_valid` queda NULL.

**Worker TED — mensajería (4b):**
- Payload Pub/Sub malformado (no pasa `safeParse`) → `message.ack()` (descarta, no reintenta) + log error.
- Error transitorio (GCS/DB caído) → `message.nack()` → reintento.
- N nacks (= `max_delivery_attempts`) → mensaje va a DLQ (no loop infinito).
- Idempotencia: reprocesar el mismo `document.uploaded` no duplica filas ni corrompe estado.

**Retención (4b) [C]:**
- [C] Con `fecha_emision` → `retention_until = fecha_emision + 6 años` exacto.
- [C] Sin `fecha_emision` (manual sin fecha / `fallido`) → `retention_until = created_at + 6 años` + marca de revisión.
- [C] No existe path que borre un documento dentro del período de retención (no hay purga implementada; cierre/cancelación de orden no borra el documento — FK `restrict`).

**API (4a):**
- `POST /transport-orders/:id/documents` con PDF válido → `202`, fila `pendiente`, objeto en GCS, `document.uploaded` publicado.
- MIME no permitido → `400`; archivo > tamaño máx → `413`; sin `file` → `400` (patrón `site-settings`).
- IDOR: usuario de empresa ajena (ni dueño generador ni transportista asignado) → `403` en POST/GET/manual-entry.
- `POST /documents/:id/manual-entry` corrige campos → `200`, `extraction_status='ingreso_manual'`, `retention_until` recalculado.
- `GET /transport-orders/:id/documents` lista solo los de esa orden; `GET /documents/:id` devuelve detalle + signed URL v4 que descarga el objeto.

**Cierre flexible (4c) [C]:**
- [C] Orden con ≥1 documento subido y TED **no** decodificado (`pendiente`/`fallido`) → **cierra** (`REQUIRE_TED_DECODE=false`).
- [C] Orden con `REQUIRE_DOCUMENT_TO_CLOSE=true` y **0 documentos** → cierre rechazado con código claro.
- [C] `REQUIRE_TED_DECODE=true` (override) → cierre exige al menos un `decodificado`.
- Regresión: el cierre idempotente (`alreadyDelivered`) y los permisos shipper/carrier de `confirmarEntregaViaje` siguen intactos.
- `booleanFlag()` parsea `"false"` correctamente como `false` (no footgun) para los 4 flags.

**Stub XML (4c):**
- `XmlIntercambioIngestor.ingest()` devuelve `no_implementado` / lanza `NotImplementedError` sin tocar red.

## 11. Open questions (para el PO / legal)

- **O-1** (de O-4 del plan): **resuelto** a favor de reusar `apps/document-service` (skeleton) como worker, no app nueva. Confirmar que no rompe expectativas de ADR-007 (que designó `document-service` para emisión DTE + OCR — ahora pasa a recepción/archivo TED).
- **O-2** (de O-5 del plan): **RESUELTA (PO)** — `sharp` (binario prebuilt npm, sin `apt-get`) **solo** para preprocesamiento de fotos; WASM puro para lo crítico (pdfium rasterizar + zxing PDF417). El Dockerfile no gestiona binarios de sistema a mano.
- **O-3** (retención, **decisión legal PO ya tomada** per brief): persistir `retention_until = fecha_emision + 6a` (fallback `created_at + 6a` + revisión); sin borrado automático; sin lifecycle-delete; sin cascada. **Pendiente**: sign-off legal de la responsabilidad de custodia de Booster como archivador (no emisor).
- **O-4**: `razon_social_emisor` — confirmar contra `formato_dte_202602.pdf` si viene en el `<DD>` o requiere otra fuente (manual-entry). El brief lista `RSR→razon_social_receptor` pero no un tag para `razon_social_emisor`.
- **O-5**: `monto_total` — ¿el `<MNT>` del TED es siempre el monto total del documento, o hay tipos (p.ej. guía sin monto) donde es 0/ausente? Afecta nullability y validación.
- **O-6**: ¿La regla de cierre debe distinguir por tipo de documento (p.ej. exigir una Guía 52 específicamente, no solo "cualquier documento")? El brief dice "≥1 documento subido correctamente" — asumido tipo-agnóstico.
- **O-7**: **RESUELTA (PO 2026-06-18)** — el cierre exige ≥1 documento subido (`REQUIRE_DOCUMENT_TO_CLOSE=true`) **solo para órdenes creadas tras el feature** (`viajes.creado_en` ≥ fecha de corte); legacy/en-curso exentas. Independiente de `REQUIRE_TED_DECODE` (sigue `false`). ⚠️ Antes del rollout: confirmar si hay órdenes en curso sin documento.
- **O-8** (de R-8): **RESUELTA (PO 2026-06-18)** — ADR-070 articula que `retention_until` (6a desde `fecha_emision`) es **política de custodia del archivador** (postura conservadora / default técnico seguro), **distinta** de la obligación del *emisor* SII que ADR-069 retiró (no se contradicen). El sign-off legal de la custodia sigue pendiente y puede ajustar el plazo; no bloquea diseño/código, sí el go-live con documentos reales.

## 12. Devils-advocate

- **"El TED nunca decodifica en producción → la columna `ted_raw` queda siempre NULL y el feature es teatro."** Mitigación: el cierre flexible (`REQUIRE_TED_DECODE=false`) y `manual-entry` hacen que el feature aporte valor (repositorio + retención + respaldo de cierre) **aunque** el decode falle. El decode es enriquecimiento, no la razón de ser. Métricas de tasa decode vigilan que no sea 0%.
- **"O-3 contradice ADR-069 y nadie lo notó."** ADR-069 §4 literalmente dice "sin WORM/Retention-Lock obligatorio" y "la obligación de retención de 6 años del emisor SII deja de aplicar a Booster". El brief O-3 (más reciente) ordena 6 años persistidos. **No es un descuido**: la retención del *emisor* (que ADR-069 retiró) ≠ la política de custodia del *archivador* (que el PO ahora adopta). ADR-070 DEBE escribir esta distinción explícitamente o el inventario ADR-vs-prod marcará drift. Flagueado en R-8/O-8.
- **"Reusar `apps/document-service` arrastra el contrato de ADR-007 (emisión + Document AI) que ya no aplica."** El README del skeleton dice "DTE emission (Bsale) + Carta de Porte + OCR Document AI". Reusar el directorio para el worker TED requiere reescribir ese README y dejar claro en ADR-070 que el rol cambió (recepción/archivo, no emisión). Si no, queda un skeleton mintiendo sobre su propósito.
- **"`sharp` rompe la regla WASM-only y abre la puerta a más binarios nativos."** C-8 acota: `sharp` prebuilt npm **solo** para preprocesamiento de fotos, nada de `apt-get`. Si el equipo no tolera la excepción, O-2 ofrece WASM estricto u omitir preprocesamiento. La decisión debe quedar firmada, no asumida.
- **"El cierre flexible puede dejar pasar órdenes con un PDF basura subido (cualquier archivo) como 'documento'."** El endpoint valida MIME (PDF/JPEG/PNG) pero no que el contenido sea realmente una Guía/Factura. Es deuda aceptada explícita: F4 archiva best-effort; la validación semántica del documento (que sea la guía correcta de esa carga) es responsabilidad operacional/humana, no del sistema en esta fase. Documentar como límite conocido, no parche silencioso.
- **"Polling `GET /documents/:id` + SSE no es realtime real y el frontend hará busy-loop."** Aceptado por el PO (rechazó Firestore). El SSE existente cubre el push; el polling es fallback. Si la carga de polling se vuelve problema, es optimización posterior, no bloqueo de F4.

## 13. Approval

**Gates antes de pasar de spec a build (consolidado):** (1) `terraform apply` de F3 cerrado con su pre-check (`plan -target` = 2 destroy/0/0 + `gcloud pubsub topics list-subscriptions document-events` vacío); (2) **ADR-070 mergeado** (estado `Proposed` basta para implementar; pasa a `Accepted` tras el sign-off legal); (3) **C-7**: validar tags TED `<DD>` vs `formato_dte_202602.pdf` del SII antes de fijar el parser (4b); (4) **O-7 rollout**: confirmar si hay órdenes en curso sin documento; (5) migración `0044` (→ `0045` si #428 la toma antes).

**Invariantes reafirmados (no se relajan en implementación):** cierre **flexible** (`REQUIRE_TED_DECODE=false` — basta el PDF/foto subido aunque el TED no decodifique); retención **6 años anclada a `fecha_emision`** (`ENABLE_RETENTION_PURGE=false`, sin purga automática esta fase); **WASM puro** (`@hyzyla/pdfium` + `zxing-wasm`) y `sharp` **solo** para preprocesado de fotos.

- [ ] PO (Felipe Vicencio) aprueba este spec y sus decisiones (hosting, O-3 retención, reuso de `document-service`, excepción `sharp`).
- [ ] ADR-070 redactado y mergeado **antes** de implementar 4a (constraint C-11).
- [ ] Sign-off legal de la responsabilidad de custodia del archivador (O-3 / O-8) — dependencia externa, no bloquea el diseño pero sí el go-live con documentos reales.
- [x] O-2 (sharp acotado), O-7 (cierre exige doc solo en órdenes nuevas) y O-8 (custodia≠emisión en ADR-070) **resueltas por el PO (2026-06-18)**. Pendiente: O-4/O-5 (tags TED `<DD>` vs `formato_dte_202602.pdf`, en 4b), O-6 (cierre tipo-agnóstico, asumido) y sign-off legal de custodia.
- [ ] C-7 ejecutado: tags TED validados contra `formato_dte_202602.pdf` y mapeo documentado en la Evidencia de 4b, antes de fijar el parser.

---

**Estado**: Draft pendiente de aprobación PO. No iniciar 4a sin firma en §13 ni sin ADR-070 mergeado.
