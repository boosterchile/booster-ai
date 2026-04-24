# ADR-007 — Gestión Documental Obligatoria Chile

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md), [ADR-001](./001-stack-selection.md)

---

## Contexto

El transporte de carga en Chile está regulado por normativa obligatoria del **Servicio de Impuestos Internos (SII)** y del **Ministerio de Transportes**. Todo viaje comercial requiere documentación específica, con **retención legal mínima de 6 años**. Booster AI no puede operar legalmente sin:

1. **Guía de Despacho Electrónica (DTE Tipo 52)** — obligatoria por la Ley 19.983 y Resolución Exenta SII N° 80 de 2014. Reemplaza a la guía física.
2. **Factura Electrónica (DTE Tipo 33 / 34)** — obligatoria por Ley 20.727 (2014). Emisión dentro del plazo legal.
3. **Carta de Porte electrónica** — según Ley 18.290 del Tránsito (Art. 174). Información del transporte.
4. **Acta de entrega / Conformidad de recepción** — prueba de delivery, firma del receptor.
5. **Fotos de estado de carga** — evidencia pre-pickup y post-delivery.
6. **Checklist de inspección del vehículo** — seguridad operacional, requisito para auditorías.

Adicionalmente, Booster AI genera **Certificado ESG** propio (no obligatorio legalmente pero diferenciador comercial y requerido por CORFO para TRL 10).

El sistema debe **emitir, almacenar, indexar, recuperar y exportar** estos documentos con:
- Trazabilidad completa (quién generó, cuándo, bajo qué transacción)
- Integridad (hashes SHA-256 del contenido + firma digital)
- Acceso controlado por rol (shipper solo ve sus docs; carrier solo los suyos)
- Cumplimiento de retención 6 años mínimo
- Formato legal requerido (XML SII para DTEs, PDF legible para humanos)

## Decisión

Implementar un **servicio dedicado de gestión documental** (`apps/document-service`) con tres capas:

1. **Generación** — emisión de documentos electrónicos en los formatos legales.
2. **Ingesta + OCR** — para documentos externos que llegan en formato foto/PDF (ej. factura de combustible que el carrier sube como gasto).
3. **Almacenamiento, indexación y retrieval** — archivo auditable y accesible.

### Tipos de documentos soportados

| Documento | Origen | Formato SII | Generador |
|-----------|--------|-------------|-----------|
| Guía de Despacho (DTE 52) | Emitida por Booster en nombre del carrier | XML DTE + PDF visual | document-service |
| Factura Electrónica (DTE 33/34) | Emitida por carrier o por Booster como facturador | XML DTE + PDF visual | document-service |
| Carta de Porte | Emitida por Booster | PDF firmado + JSON data | document-service |
| Acta de Entrega | Generada al confirmar recepción | PDF con firma digital | document-service |
| Foto pickup/delivery | Capturada por driver via PWA | JPG + metadata EXIF | driver app → Cloud Storage |
| Checklist vehículo | Capturada por driver antes del viaje | JSON estructurado + PDF | driver app |
| Factura de combustible (externo) | Subida por carrier (scan/foto) | Original + OCR output | document-service + Document AI |
| Certificado ESG Booster | Emitido al cierre del trip | PDF + JSON data | document-service |

### Integración SII DTE

El SII chileno requiere que:
- Los DTEs se firmen digitalmente con **certificado tributario electrónico** del emisor (RUT del emisor)
- Se envíen al SII para validación vía **Servicio de Impuestos Internos Web Service** (SOAP/XML)
- Se reciba **Folio autorizado** del SII antes de usar el documento
- Se mantenga el **archivo DTE** (XML original firmado) por 6 años

Decisiones operativas:

**Booster NO es emisor de DTEs propio** en fase inicial. Opciones:
1. **Integración con proveedor acreditado** (SovosChile, Bsale, Paperless, Acepta). Recomendado.
2. **Desarrollar integración directa SII** (requiere certificación como Emisor Electrónico Tipo I por SII, proceso de meses).

Elegimos **Opción 1 — proveedor acreditado** para time-to-market.

**Provider recomendado: Bsale** (API moderna, pricing razonable, soporte CLP, cobertura Chile). Alternativas: Paperless, Acepta. Decisión final pendiente de benchmarking comercial.

Abstracción: `packages/dte-provider` con interface `DteEmitter`:

```typescript
// Boceto
interface DteEmitter {
  emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult>;
  emitFactura(input: FacturaInput): Promise<DteResult>;
  queryStatus(folio: string, rutEmisor: string): Promise<DteStatus>;
}
```

Implementaciones: `BsaleAdapter`, `PaperlessAdapter` (futuro), `MockAdapter` (para tests). Cambio de provider = cambio de adapter, nada más.

### Arquitectura de almacenamiento

```
┌──────────────────────────────────────────────────────┐
│ CLOUD STORAGE                                         │
│                                                       │
│ Bucket: booster-ai-documents-prod                    │
│   ├─ /dte/{year}/{month}/                            │
│   │   ├─ guia-{folio}.xml (DTE firmado SII)          │
│   │   └─ guia-{folio}.pdf (versión humana)           │
│   ├─ /carta-porte/{year}/{month}/                    │
│   │   └─ cp-{trip_id}.pdf                            │
│   ├─ /photos/{year}/{month}/                         │
│   │   ├─ pickup-{trip_id}-{driver_id}.jpg            │
│   │   └─ delivery-{trip_id}-{driver_id}.jpg          │
│   ├─ /signatures/{year}/{month}/                     │
│   │   └─ sign-{trip_id}.png                          │
│   └─ /external-upload/{year}/{month}/{carrier_id}/   │
│       └─ {original-filename}-{hash}.pdf              │
│                                                       │
│ Object Lifecycle:                                    │
│   - Retention Lock de 6 años en /dte/ y /carta-porte/│
│   - Archive tier después de 2 años (cost)            │
│   - Delete después de 7 años (compliance + seguridad)│
│                                                       │
│ Encryption:                                           │
│   - Customer-Managed Encryption Key (CMEK) en KMS    │
│   - Key rotation cada 90 días                        │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ POSTGRESQL — Índice y metadata                       │
│                                                       │
│ Table: documents                                     │
│   id: UUID                                           │
│   trip_id: UUID (FK)                                 │
│   type: enum (dte_52, dte_33, carta_porte, ...)      │
│   gcs_path: text                                     │
│   sha256: text (integrity check)                     │
│   folio_sii: text (nullable, solo DTE)               │
│   emitted_by_user_id: UUID                           │
│   emitted_at: timestamp                              │
│   retention_until: timestamp (= emitted_at + 6 años) │
│   pii_redacted_copy: boolean (existe versión         │
│     redactada para compartir fuera del proyecto)     │
│                                                       │
│ Index: (trip_id, type), (emitted_at), (retention_until)│
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ BIGQUERY — Analytics + auditoría                     │
│                                                       │
│ Table: document_events                               │
│   documento emitido, descargado, modificado, etc.   │
│   Para reportería de cumplimiento + auditoría.      │
└──────────────────────────────────────────────────────┘
```

### OCR con Document AI + Gemini fallback

Para documentos externos (facturas de combustible, comprobantes, recibos):

**Path principal: Document AI**
- Procesador `Expense Parser` de Google (pre-entrenado para facturas)
- Extrae: emisor, RUT, fecha, neto, IVA, total, items
- Disponible como API managed en GCP

**Path fallback: Gemini 2.5 Vision multimodal**
- Si Document AI no reconoce el tipo o returns low confidence
- Prompt custom para extraer campos específicos
- Más flexible para formatos raros
- Abstracción en `packages/ai-provider`

Workflow:

```
1. Carrier sube imagen/PDF de factura via apps/web
2. Upload a Cloud Storage /external-upload/
3. Trigger Cloud Function → document-service
4. Intenta Document AI primero
5. Si confidence < 0.7 → fallback Gemini Vision
6. Resultado estructurado + enlace al archivo original
7. Carrier valida en UI, corrige si necesario
8. Persiste en tabla `expenses` con link a document
```

### Carta de Porte (generación)

Generador en `packages/carta-porte-generator`:
- Input: Trip + Shipper + Carrier + Vehicle + Driver
- Output: PDF conforme a Ley 18.290 Art. 174
- Usa `@react-pdf/renderer` para generar PDF desde TSX (testeable, diffeable)
- Firma digital con KMS (hash del contenido + signature)
- Embeds QR con link a la versión online de la Carta de Porte

### Firma digital de conformidad de entrega

Cuando el driver entrega la carga:
- UI PWA captura firma táctil del receptor en canvas HTML5
- Convierte a PNG base64
- Sube a Cloud Storage `/signatures/`
- Asocia al trip como Acta de Entrega
- Genera PDF con foto del receptor (opcional) + firma + timestamp + geolocation del momento de entrega
- Este PDF se firma digitalmente con KMS y queda inmutable

### Retención legal y delete

- **DTE + Carta de Porte**: Cloud Storage Object Retention Lock de 6 años (no se puede eliminar ni siquiera por admin hasta expiración)
- **Fotos + firmas**: 6 años también, mismo lock
- **External uploads (facturas de gastos)**: 6 años (SII)
- **Metadata en Postgres**: 6 años + 1 de margen, luego archive en BigQuery long-term

Después de 7 años total: job automático `document-retention-cleanup` corre mensualmente, borra documentos vencidos, y registra en audit log el borrado (para compliance GDPR-like / Ley 19.628 "derecho al olvido" adaptado).

### Acceso controlado por rol

Reglas en Firestore Security Rules + backend middleware:

- **Shipper**: ve documentos de sus propios trips (where `trip.shipper_id == user.id`)
- **Carrier**: ve documentos de trips donde es carrier
- **Driver**: ve documentos de trips donde fue el driver asignado
- **Admin**: ve todo con audit trail de cada consulta (tabla `document_access_log`)

URLs firmadas (signed URLs) de Cloud Storage con expiración 15 min por cada acceso, emitidas por backend tras autorización.

### Identidad del emisor fiscal

Cuando Booster emite un DTE **en nombre del carrier**, se usa el RUT del carrier (no el de Booster). El certificado digital del carrier debe estar en posesión del emisor (provider integrado).

Workflow de onboarding carrier:
1. Carrier se registra en Booster
2. Booster solicita RUT + razón social + certificado electrónico SII (archivo .pfx + password)
3. Certificado se sube encriptado a Secret Manager con key `carrier-{id}-cert-pfx`
4. Provider DTE (Bsale) se configura para usarlo
5. Desde entonces, DTEs salen con RUT del carrier, firmados con su certificado

Esto requiere que el carrier **sea Emisor Electrónico inscrito en SII** — requisito previo para vendeer servicios de transporte en Chile. La mayoría ya lo está; si no, Booster ofrece asesoría (opcional, no técnico).

## Consecuencias

### Positivas

- **Cumplimiento legal desde day 1**: TRL 10 requiere que el producto sea comercializable legalmente. Sin DTE válido, Booster es inviable comercialmente.
- **Diferenciador vs informalidad**: frente a competencia que opera "de palabra", Booster ofrece documentación legal automática — atrae shippers corporativos que exigen factura.
- **Trazabilidad para auditorías**: cada documento tiene hash, timestamp, autor, y está en BD + Cloud Storage con retention lock. ISO 27001 / SOC 2 auditables.
- **Automatización reduce fricción**: el carrier ya no genera guías manualmente; el sistema lo hace.
- **Reportes ESG con documentos soporte**: cada certificado ESG emitido puede vincularse al trip real con su Carta de Porte — validable externamente.

### Negativas

- **Dependencia del provider DTE**: si Bsale cae, Booster no puede emitir Guías. Mitigación: multi-provider con failover (adapter pattern).
- **Costo operativo**: provider DTE cobra por documento emitido (~$50-200 CLP cada uno). A 10K trips/mes → $500K-2M CLP/mes. Se incluye en pricing de plataforma.
- **Complejidad operativa**: onboarding de carriers requiere gestión de certificados digitales SII. Mitigado con flujo guiado y soporte humano los primeros clientes.
- **Retención 6 años**: costo de storage no despreciable. Mitigado con Archive tier para docs antiguos (vs. Standard tier).
- **Dependencia de Document AI**: servicio managed tiene costo por página procesada (~$0.10-0.50 USD/página). OK para volumen moderado.

## Implementación inicial

### Apps nuevas

- `apps/document-service` — Cloud Run service especializado. Endpoints:
  - `POST /generate/guia-despacho`
  - `POST /generate/carta-porte`
  - `POST /generate/acta-entrega`
  - `POST /ingest/external-document` (con OCR)
  - `GET /documents/:id/signed-url`

### Packages

- `packages/dte-provider` — abstracción Bsale + otros
- `packages/carta-porte-generator` — PDF gen con @react-pdf/renderer
- `packages/document-indexer` — helpers para consultar BD + Cloud Storage

### Infra (Terraform)

- Cloud Storage bucket `booster-ai-documents-prod` con CMEK + Object Retention Lock
- KMS keyring + keys para CMEK
- Secret Manager: certificados digitales por carrier (patrón `carrier-{id}-cert-pfx`)
- Document AI processor (Expense Parser) habilitado
- Cloud Function trigger on-upload para external documents
- BigQuery table `document_events`

### Operativo

- Contrato con provider DTE (Bsale o equivalente) — tarea paralela al desarrollo
- Definición de templates legales de Carta de Porte con asesoría jurídica
- Runbook `onboarding-carrier-dte` para configurar certificado digital

## Validación

- [ ] Emisión de Guía de Despacho DTE 52 con folio SII válido end-to-end
- [ ] Generación de Carta de Porte PDF conforme Ley 18.290 Art. 174
- [ ] Firma digital táctil capturada + PDF Acta de Entrega válido
- [ ] OCR de factura combustible con Document AI extrae campos correctos
- [ ] Retention Lock en Cloud Storage previene borrado dentro de 6 años
- [ ] Signed URL expira correctamente a los 15 min
- [ ] Audit log registra cada acceso a documento sensible
- [ ] Backup restaurable desde Cloud Storage + Postgres

## Referencias

- SII Chile — Guía de Despacho Electrónica: https://www.sii.cl/factura_electronica/formato_dte.htm
- Ley 19.983 Guía de Despacho: https://bcn.cl/2jdwx
- Ley 20.727 Factura Electrónica: https://bcn.cl/2xu0f
- Ley 18.290 Tránsito Art. 174: https://bcn.cl/2f72s
- Google Document AI: https://cloud.google.com/document-ai
- GCS Retention Lock: https://cloud.google.com/storage/docs/bucket-lock
- Bsale API: https://api.bsale.dev/
