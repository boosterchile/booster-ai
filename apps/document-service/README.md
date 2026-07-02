# @booster-ai/document-service

**Runtime**: `cloud-run`
**Status**: `WORKER TED (F4-4b)`

Worker Pub/Sub que consume `document.uploaded` y decodifica el **TED** (Timbre
Electrónico Documento, PDF417) de los documentos tributarios de terceros (Guía
de Despacho DTE 52, Factura 33, etc.) que el generador o el transportista sube
a una orden en 4a. Booster **recibe y archiva** — NO emite DTE ni se integra
con el SII (ADR-069 / ADR-070).

Por mensaje: valida el payload (Zod), reclama la fila por estado (idempotencia),
descarga el objeto de GCS, decodifica el TED vía
`@booster-ai/transport-documents` (pdfium WASM para rasterizar PDF, zxing-wasm
para PDF417, sharp para preprocesar fotos) y persiste `decodificado` (campos
del `<DD>` + `ted_raw` + `retention_until`) o `fallido` en
`documentos_transporte`. Nunca borra ni reescribe el objeto GCS original
(retención legal 6 años, O-3). ack/nack con DLQ tras 5 intentos
(`messaging.tf`).

> La lógica de dominio (parser `<DD>`, cálculo de retención, ingestor) vive en
> `packages/transport-documents`, no inline acá (C-4). La verificación
> criptográfica de la firma `<FRMT>` está fuera de alcance de 4b (gate C-7 §6).
