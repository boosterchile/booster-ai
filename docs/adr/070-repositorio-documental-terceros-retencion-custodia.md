# ADR-070 — Repositorio documental de terceros: recepción/archivo de DTE + extracción TED + retención de custodia

**Estado**: **Proposed** — pendiente sign-off legal de la responsabilidad de custodia (§Sign-off legal) y aprobación PO de la implementación.
**Fecha**: 2026-06-18
**Decider**: Felipe Vicencio (Product Owner) — *propuesto*; sign-off legal PENDIENTE.
**Complementa**: [ADR-007](./007-chile-document-management.md) §recepción/OCR · [ADR-069](./069-booster-deja-de-emitir-dte-remocion-sovos.md) §4 (Booster = receptor/archivador)
**Related**:
- Frente F4 de `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md`
- Spec detallado: `.specs/repositorio-documental-transporte/spec.md`
- Decisión O-3 (retención): `.specs/pivote-documental-y-cierre-legal-2026-06/decisiones-fase-b.md`

---

## Contexto

[ADR-069](./069-booster-deja-de-emitir-dte-remocion-sovos.md) estableció que **Booster ya no emite DTE** y pasa a **receptor/archivador**. Su §4 dejó explícito que la retención de documentos de terceros (F4) **se rige por O-3** ("retención según exigencia legal aplicable al archivador, sin WORM/Retention-Lock obligatorio salvo que una norma específica lo exija").

F4 materializa ese rol: el **generador de carga** o el **transportista** sube el PDF/foto de la **Guía de Despacho (DTE 52)** y/o **Factura (33)** que ampara la carga, para poder **cerrar la orden de transporte**. Booster **NO emite** ni se integra con la facturación electrónica del SII en esta fase — solo **recibe y archiva**, con extracción **best-effort** del TED (código PDF417 embebido en el documento).

Este ADR fija las decisiones estructurales de F4 y, en particular, **reconcilia la política de retención** con ADR-069 (la tensión O-8 flagueada en el diseño).

## Decisión

### 1. Repositorio documental por orden de transporte

Tabla `documentos_transporte` (FK a `viajes`, naming SQL español), 4 endpoints Hono en `apps/api`, worker de extracción TED como servicio Cloud Run separado (suscrito a Pub/Sub `document.uploaded`), lógica de dominio en `packages/transport-documents`. Detalle completo en `.specs/repositorio-documental-transporte/spec.md`.

El worker se construye **sobre `apps/document-service`** (reusa el skeleton existente, elimina deuda day-0). El rol de `document-service` cambia de "emisión DTE + OCR Document AI" (ADR-007 original) a **recepción/archivo + extracción TED**; su README se reescribe en consecuencia.

### 2. Extracción TED best-effort; cierre flexible

La decodificación del TED (rasterizar PDF con `@hyzyla/pdfium` WASM → decodificar PDF417 con `zxing-wasm` → parsear `<DD>` con `fast-xml-parser`; `sharp` solo para preprocesar fotos) es **mejor esfuerzo**: si decodifica, enriquece los metadatos; si no, basta el archivo subido o el ingreso manual. **`REQUIRE_TED_DECODE=false`** por defecto — el TED **no** es condición de cierre.

El **cierre de la orden** exige ≥1 documento subido (`REQUIRE_DOCUMENT_TO_CLOSE=true`) **solo para órdenes creadas tras el feature** (O-7); las órdenes legacy/en-curso quedan exentas.

### 3. Retención de custodia (O-3) — reconciliación con ADR-069

**Esta es la decisión central de reconciliación (O-8).** Hay dos obligaciones de retención **distintas**, y no se contradicen:

| | Obligación del **EMISOR** SII | Política de custodia del **ARCHIVADOR** |
|---|---|---|
| Quién | El contribuyente que emite el DTE | Booster, como repositorio de los documentos que amparan sus operaciones |
| Estado | **Retirada** (ADR-069): Booster ya no emite → no le aplica | **Adoptada** (este ADR): conservar los documentos de terceros |
| WORM/Retention-Lock | No aplica | **No obligatorio** (consistente con ADR-069 §4) |

**Política adoptada (O-3, decisión PO):**
- Columna `retention_until` persistida = **`fecha_emision` + 6 años** (extraída del TED). Fundamento de referencia: **Código Tributario DL 830 Art. 17 en relación con Art. 200** (plazo extraordinario de prescripción SII de 6 años) — adoptado como **postura conservadora / default técnico seguro**.
- **Fallback** si no hay `fecha_emision` (ingreso manual sin fecha, o decode fallido): `created_at + 6 años` + marcar el registro para revisión.
- **Prohibido el borrado automático dentro del período**: sin lifecycle-delete de Cloud Storage, sin borrado en cascada al cerrar/archivar una orden.
- **Purga** solo después de `retention_until`, vía proceso explícito y auditable, detrás de flag **`ENABLE_RETENTION_PURGE=false`**. **En esta fase NO se implementa la purga** — solo el cálculo y almacenamiento de `retention_until`.
- Transición a almacenamiento frío (Nearline/Coldline) permitida como optimización de costo, **sin eliminar** dentro del período.

Esto **completa** —no contradice— ADR-069 §4: donde ADR-069 dijo "la retención de terceros se rige por O-3", este ADR define qué es O-3.

### 4. Firestore diferido; canal XML como stub

El espejo Firestore (ADR-005) queda **fuera de scope** (Postgres es la única fuente; estado de procesamiento al frontend vía polling `GET /documents/:id` + el canal SSE existente). El canal de Intercambio entre Contribuyentes (`EnvioDTE` XML) se deja como **interface + stub no-op** (`XmlIntercambioIngestor`), sin conexión al SII.

## Sign-off legal (PENDIENTE)

⚠️ **Este ADR está en estado `Proposed` precisamente por esto.** La **responsabilidad de custodia** de Booster como archivador (¿voluntaria/conservadora, o exigida por una norma específica?) y el **plazo de 6 años** deben ser **confirmados por un abogado habilitado en Chile** antes del go-live con documentos reales de terceros. El plazo de 6 años es el **default técnico seguro**; el área legal puede ajustarlo (acortar/extender) sin cambiar el diseño (`retention_until` es un cálculo parametrizable). Hasta ese sign-off, el ADR no pasa a `Accepted`.

## Consecuencias

**Positivas:**
- Cierra el ciclo del pivote: Booster recibe/archiva los DTE de terceros que amparan la carga, habilitando el cierre de orden con respaldo documental.
- Reconciliación explícita emisor-vs-custodio: el inventario ADR-vs-prod no marcará drift entre ADR-069 y `retention_until`.
- Reusa `document-service` (elimina deuda del skeleton) y patrones probados (GCS, consumer Pub/Sub, multipart).

**Negativas / deuda explícita aceptada:**
- `retention_until` se persiste pero la **purga no se implementa** esta fase (flag OFF): los documentos se conservan indefinidamente hasta que se construya el proceso de purga auditable. Aceptable (conservar de más es el lado seguro).
- Excepción a "WASM-only": `sharp` usa binario prebuilt npm (no `apt-get`) solo para preprocesar fotos (O-2).
- Extracción TED best-effort: la tasa de decode real depende de la calidad de los PDF417 en terreno; mitigado con ingreso manual + métricas.
- Sign-off legal pendiente bloquea el go-live (no el diseño/implementación).

## Alternativas consideradas

- **Espejo Firestore ahora**: rechazado por el PO — primer uso de Firestore en backend, superficie de riesgo dentro de feature crítica; polling + SSE bastan.
- **WORM/Retention-Lock obligatorio en el bucket de terceros**: rechazado — Booster no es el emisor; el lock irreversible no se justifica sin exigencia legal específica (consistente con ADR-069 §4). Reevaluable si legal lo exige.
- **Implementar la purga ahora**: rechazado — borrar documentos legales es irreversible; se difiere tras el sign-off legal y un proceso auditable (flag OFF).
- **Worker TED en `apps/api`**: rechazado — el procesamiento pesado (rasterizar + PDF417) en el request path agota slots de Cloud Run; va a servicio separado.

## Gates antes de pasar de spec a implementación (build)

1. `terraform apply` de F3 (destroy de cron + topic) cerrado, con su pre-check.
2. **Este ADR-070** mergeado (Proposed es suficiente para implementar; `Accepted` requiere el sign-off legal) — los ADR van antes del código.
3. C-7: validar los tags del TED `<DD>` contra `formato_dte_202602.pdf` del SII antes de fijar el parser (sub-fase 4b).
4. O-7 rollout: confirmar si hay órdenes en curso sin documento.
5. Migración será `0044` (→ `0045` si #428 la toma antes).
