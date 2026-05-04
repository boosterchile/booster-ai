# @booster-ai/document-service

**Runtime**: `cloud-run`
**Status**: `MVP` (orquestador funcional con stubs de Repo/BlobStore — switch a adapters reales pendiente)

Hono service que orquesta los 3 packages de documentos para cumplir [ADR-007](../../docs/adr/007-chile-document-management.md):

- [`@booster-ai/dte-provider`](../../packages/dte-provider) → DTE 52 (Guía) y 33/34 (Factura)
- [`@booster-ai/carta-porte-generator`](../../packages/carta-porte-generator) → PDF Ley 18.290
- [`@booster-ai/document-indexer`](../../packages/document-indexer) → índice + retrieval con signed URLs + retention 6 años

## Endpoints

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness probe |
| `POST` | `/generate/guia-despacho` | Emite DTE 52 → indexa → sube XML al GCS |
| `POST` | `/generate/carta-porte` | Genera PDF Ley 18.290 → indexa → retorna signed URL |
| `POST` | `/documents/upload-url` | Signed PUT URL (cliente upload directo, ej. fotos del driver) |
| `GET` | `/documents/:id/signed-url` | Signed READ URL (15 min) |
| `GET` | `/documents/:id` | Metadata del registro |
| `GET` | `/documents` | Listado con filtros (`?tripId=...&type=...&limit=...`) |

## Arquitectura

```
┌─────────────────────────────────────────────┐
│  Hono app (apps/document-service/src/app.ts) │
│                                              │
│  ┌──────────────────┐  ┌─────────────────┐  │
│  │ DteProvider DI   │  │ DocumentRepo DI │  │
│  │ (Mock | Bsale)   │  │ (Memory|Drizzle)│  │
│  └──────────────────┘  └─────────────────┘  │
│  ┌──────────────────┐                        │
│  │ BlobStore DI     │                        │
│  │ (Memory|GCS)     │                        │
│  └──────────────────┘                        │
└─────────────────────────────────────────────┘
```

Inyección por constructor: `createApp({ dteProvider, documentRepo, blobStore, ... })`. Los tests usan implementaciones in-memory; producción usa BsaleAdapter + Drizzle + @google-cloud/storage.

## Flow `/generate/guia-despacho`

1. Validar body Zod (input ya coerce-a fechas ISO → Date).
2. `authorize(c, { action: 'generate.guia', tripId })` — middleware externo.
3. `dteProvider.emitGuiaDespacho(input)` → SII responde con folio + XML firmado.
4. `gcsPathFor({ type: 'dte_52', identifier: folio, ... })` → object name convencional.
5. `blobStore.uploadObject(name, xml)` → persiste el XML.
6. `indexDocument(repo, { ... folioSii: folio, sha256, ... })` → registra en BD.
7. Response 201 con `{ document, dte }`.

Errores tipados se mapean a HTTP:
- `DteValidationError` / `CartaPorteValidationError` / `DocumentValidationError` → 400
- `DocumentNotFoundError` → 404
- `DteProviderError` → 502 (transient, reintentable)
- `unhandled error` → 500 con log estructurado

## Bootstrap (main.ts)

`main.ts` crea las factories según env vars:

```bash
DOCUMENTS_BUCKET=booster-ai-documents-prod  # required
DTE_PROVIDER=mock | bsale                    # default mock
BSALE_API_TOKEN=<secret>                     # required si bsale
PORT=8080                                    # default 8080
NODE_ENV=production | development
```

⚠️ **STUBs** activos hasta que mergeen los PRs base:
- `DocumentRepo` STUB (in-memory) → reemplazar por adapter Drizzle cuando exista la migration `documentos`.
- `BlobStore` STUB (URLs simuladas) → reemplazar por `@google-cloud/storage` cuando esté cableado.
- `BsaleAdapter` no disponible aún en este branch → fallback a `MockDteProvider` con error log.

Cada STUB activo emite `logger.warn`/`logger.error` audible en startup.

## Tests

```bash
pnpm --filter @booster-ai/document-service typecheck  # pass
pnpm --filter @booster-ai/document-service test       # 12/12 pass
```

Tests cubren happy path de cada endpoint (con mocks in-memory de Repo/BlobStore que sí implementan `uploadObject`), validación 400, auth 401/403, 404 not found, listado con filtros.

## Deps locales (workspace)

Este PR depende de:
- **PR #26** (`feat/dte-provider-mvp`) — interface + mock DTE
- **PR #27** (`feat/carta-porte-generator-mvp`) — PDF Carta de Porte
- **PR #28** (`feat/document-indexer-mvp`) — repo + blob abstractions

Los archivos de los 3 packages están **cherry-picked** en este branch para que CI pase. Cuando los 3 PRs mergeen a main, `git rebase main` removerá los duplicados automáticamente.

## Próximos pasos (PRs follow-up)

1. **Adapter Drizzle** para `DocumentRepo` cuando exista migration `documentos` en el schema (Drizzle Kit).
2. **Adapter `@google-cloud/storage`** con `bucket.file().save()` + signed URLs v4 + IAM impersonation del SA del Cloud Run.
3. **Switch a `BsaleAdapter`** post-merge de PR #29 + credenciales sandbox SII.
4. **Auth real** con Firebase Auth middleware (delega a `@booster-ai/api`).
5. **Cron de retention cleanup** (`deleteDocumentIfExpired` para documentos vencidos los 7 años).

## Referencias

- [ADR-007](../../docs/adr/007-chile-document-management.md) — Chile Document Management
- HANDOFF.md §4 — bloqueante regulatorio go-live Chile
