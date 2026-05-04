# @booster-ai/document-indexer

Helpers de **índice y retrieval de documentos** sobre Cloud Storage + Postgres. Implementa [ADR-007 § "Arquitectura de almacenamiento"](../../docs/adr/007-chile-document-management.md).

## Estado

- ✅ Schema Zod del registro (`DocumentRecord`)
- ✅ Builder de paths GCS convencionales (`gcsPathFor`, `redactedPathFor`)
- ✅ Cálculo de `retentionUntil` (Ley 18.290 + SII = 6 años + margen)
- ✅ 5 errores tipados
- ✅ Operations: `indexDocument`, `listDocuments`, `getDocumentById`, `getSignedReadUrl`, `getSignedUploadUrl`, `assertSha256Match`, `deleteDocumentIfExpired`
- ✅ Interfaces abstractas `DocumentRepo` + `BlobStore` (caller implementa con Drizzle / @google-cloud/storage)
- ✅ 23 tests con in-memory implementations

## Diseño clave: agnóstico al backend

El package **NO importa** `drizzle-orm` ni `@google-cloud/storage`. Define dos interfaces que el caller implementa:

```ts
interface DocumentRepo {
  insert(input: DocumentRecord): Promise<void>;
  findById(id: string): Promise<DocumentRecord | null>;
  list(filter: ListDocumentsFilter): Promise<DocumentRecord[]>;
  findExpired(asOf: Date, limit: number): Promise<DocumentRecord[]>;
  delete(id: string): Promise<void>;
}

interface BlobStore {
  getSignedReadUrl(args): Promise<string>;
  getSignedUploadUrl(args): Promise<string>;
  statObject(name): Promise<{ sizeBytes: number } | null>;
  deleteObject(name): Promise<void>;
}
```

Beneficios:
- Tests end-to-end con `MemoryRepo` + `MemoryBlobStore` sin BD ni GCP.
- Si en el futuro se cambia de Drizzle a Prisma o de GCS a S3, el package no se toca.

## Uso típico (en `apps/document-service`)

```ts
import {
  gcsPathFor,
  indexDocument,
  getSignedReadUrl,
  type DocumentRepo,
  type BlobStore,
} from '@booster-ai/document-indexer';

// Adapter Drizzle
const repo: DocumentRepo = {
  insert: async (record) => { await db.insert(documentos).values(record); },
  findById: async (id) => {
    const [row] = await db.select().from(documentos).where(eq(documentos.id, id));
    return row ?? null;
  },
  // ... resto
};

// Adapter @google-cloud/storage
const blob: BlobStore = {
  getSignedReadUrl: async ({ objectName, expiresInSeconds }) => {
    const [url] = await bucket.file(objectName).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });
    return url;
  },
  // ... resto
};

// Indexar un PDF recién generado
const path = gcsPathFor({
  type: 'carta_porte',
  identifier: 'BOO-ABC123',
  emittedAt: new Date(),
});
// → 'carta-porte/2026/05/cp-BOO-ABC123.pdf'

await bucket.file(path).save(pdfBuffer);
const record = await indexDocument(repo, {
  tripId,
  type: 'carta_porte',
  gcsPath: path,
  sha256,
  folioSii: null,
  emittedByUserId: userId,
  sizeBytes: pdfBuffer.byteLength,
});

// Servir signed URL al cliente (autorización ya validada en HTTP middleware)
const url = await getSignedReadUrl(blob, record.gcsPath, 900); // 15 min
```

## Convención de paths GCS

| Tipo documento | Path |
|----------------|------|
| `dte_52` (Guía) | `dte/{year}/{month}/guia-<folio>.<ext>` |
| `dte_33` / `dte_34` (Factura) | `dte/{year}/{month}/factura-<folio>.<ext>` |
| `carta_porte` | `carta-porte/{year}/{month}/cp-<tracking>.pdf` |
| `acta_entrega` | `actas/{year}/{month}/acta-<id>.pdf` |
| `firma_entrega` | `signatures/{year}/{month}/sign-<id>.png` |
| `foto_pickup` | `photos/pickup/{year}/{month}/pickup-<id>.jpg` |
| `foto_delivery` | `photos/delivery/{year}/{month}/delivery-<id>.jpg` |
| `checklist_vehiculo` | `checklists/{year}/{month}/checklist-<id>.json` |
| `factura_combustible` | `external-upload/{year}/{month}/<filename>` |
| `certificado_esg` | `certificates/{year}/{month}/cert-<id>.pdf` |

Mes con leading zero (`01`-`12`) para que `gsutil ls` ordene cronológico. Year/month en UTC para consistencia cross-region. Identifiers se sanitizan removiendo chars no `[A-Za-z0-9_-]`.

## Retention

Default: **6 años + 365 días extra** desde `emittedAt`. Configurable via `RetentionConfig`:

```ts
import { computeRetentionUntil } from '@booster-ai/document-indexer';

const r = computeRetentionUntil(new Date(), {
  retentionYears: 10,
  extraMarginDays: 0,
});
// → 10 años exactos sin margen
```

Job de cleanup nocturno (en `apps/document-service`) usa `findExpired` + `deleteDocumentIfExpired`:

```ts
import { deleteDocumentIfExpired } from '@booster-ai/document-indexer';

const expired = await repo.findExpired(new Date(), 100);
for (const doc of expired) {
  await deleteDocumentIfExpired(repo, blob, doc.id);
  await auditLog.write({ action: 'document_deleted_post_retention', docId: doc.id });
}
```

## Integrity check post-download

Después de descargar un documento desde GCS, verificar que el sha256 indexado matchea el contenido real:

```ts
import { assertSha256Match } from '@booster-ai/document-indexer';

const buf = await bucket.file(record.gcsPath).download();
assertSha256Match(record.sha256, buf[0]);
// throws DocumentIntegrityError si no matchea
```

Esto detecta tampering en GCS (improbable con CMEK + retention lock, pero defensivo).

## Errores tipados

| Error | HTTP | Cuándo |
|-------|------|--------|
| `DocumentValidationError` | 400 | Input no pasa Zod |
| `DocumentNotFoundError` | 404 | `getDocumentById` no encuentra |
| `DocumentIntegrityError` | 500 | sha256 mismatch — bug grave |
| `DocumentRetentionViolationError` | 403 | Intento de delete dentro del período legal |

## Testing

```bash
pnpm --filter @booster-ai/document-indexer typecheck
pnpm --filter @booster-ai/document-indexer test
```

23 tests cubren happy path, validación, paths sanitization, retention, signed URLs, integrity, delete-if-expired.

## Referencias

- [ADR-007 — Chile Document Management](../../docs/adr/007-chile-document-management.md)
- Ley 18.290 Art. 174 — retención 6 años
- SII — retención DTE 6 años mínimo
