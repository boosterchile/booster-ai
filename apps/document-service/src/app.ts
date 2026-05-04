/**
 * Server Hono que orquesta los 3 packages de documentos:
 *   - @booster-ai/dte-provider           → emit DTE 52 (Guía) y 33/34 (Factura)
 *   - @booster-ai/carta-porte-generator  → genera PDF Carta de Porte (Ley 18.290)
 *   - @booster-ai/document-indexer       → persiste índice + retrieval con
 *     signed URLs + retention 6 años
 *
 * Endpoints (ADR-007 § "Implementación inicial"):
 *   POST /generate/guia-despacho      → emite DTE + indexa
 *   POST /generate/carta-porte        → genera PDF + indexa
 *   POST /documents/upload-url         → signed PUT URL (cliente upload directo)
 *   GET  /documents/:id/signed-url     → signed READ URL (15 min)
 *   GET  /documents/:id                → metadata del registro
 *   GET  /documents                    → listado con filtros
 *   GET  /healthz                      → liveness
 *
 * Auth (delegada al middleware):
 *   - Para los endpoints de READ: validar `tripId` ownership (shipper / carrier
 *     dueño del trip → permitido; admin → permitido con audit log).
 *   - Para los endpoints de GENERATE: validar role (carrier puede emitir guía
 *     en nombre del shipper si tiene assignment activo).
 *
 * Adapters (DI):
 *   - DteProvider: `MockDteProvider` en dev + tests; `BsaleAdapter` en prod.
 *   - DocumentRepo: implementado con Drizzle.
 *   - BlobStore: implementado con @google-cloud/storage.
 *   - El bootstrap (main.ts) inyecta los adapters reales; los tests inyectan mocks.
 */

import {
  type CartaPorteInput,
  CartaPorteValidationError,
  generarCartaPorte,
} from '@booster-ai/carta-porte-generator';
import {
  type BlobStore,
  DocumentNotFoundError,
  type DocumentRecord,
  type DocumentRepo,
  type DocumentType,
  DocumentValidationError,
  documentTypeSchema,
  gcsPathFor,
  getDocumentById,
  getSignedReadUrl,
  getSignedUploadUrl,
  indexDocument,
  listDocuments,
} from '@booster-ai/document-indexer';
import {
  type DteProvider,
  DteProviderError,
  DteValidationError,
  type GuiaDespachoInput,
} from '@booster-ai/dte-provider';
import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

/**
 * Helpers para coerce strings ISO → Date al cruzar la frontera HTTP/JSON.
 * Los schemas internos de los packages usan `z.date()` puro (mejor para tests
 * con Date objects directos); en HTTP nos llegan strings ISO.
 *
 * `zCoercedGuiaInput` y `zCoercedCartaInput` son los wrappers que transforman
 * el JSON en los Inputs tipados que los packages aceptan.
 */
const zCoercedGuiaInput = z
  .object({
    rutEmisor: z.string(),
    razonSocialEmisor: z.string(),
    rutReceptor: z.string(),
    razonSocialReceptor: z.string(),
    fechaEmision: z.coerce.date(),
    items: z.array(z.unknown()),
    transporte: z.unknown(),
    referenciaExterna: z.string().optional(),
    tipoDespacho: z.number().optional(),
  })
  .passthrough();

const zCoercedCartaInput = z
  .object({
    trackingCode: z.string(),
    fechaEmision: z.coerce.date(),
    fechaSalida: z.coerce.date(),
    duracionEstimadaHoras: z.number().optional(),
    remitente: z.unknown(),
    transportista: z.unknown(),
    conductor: z.unknown(),
    vehiculo: z.unknown(),
    origen: z.unknown(),
    destino: z.unknown(),
    cargas: z.array(z.unknown()),
    folioGuiaDte: z.string().optional(),
    observaciones: z.string().optional(),
  })
  .passthrough();

export interface AppDependencies {
  logger: Logger;
  dteProvider: DteProvider;
  documentRepo: DocumentRepo;
  blobStore: BlobStore;
  /**
   * Bucket GCS donde se persisten los documentos. El path completo
   * (`gs://<bucket>/<objectName>`) se construye al firmar URLs.
   */
  bucket: string;
  /**
   * Función que valida la autorización del request. Si retorna `false`,
   * el endpoint responde 403. Inyectable para que tests puedan
   * bypassear la auth real (Firebase Auth en prod).
   *
   * @returns `true` si autorizado, `false` si forbidden, `'anonymous'`
   *          si no hay user (rebota a 401).
   */
  authorize?: (
    c: Context,
    args: { action: string; tripId?: string; documentId?: string },
  ) => Promise<boolean | 'anonymous'>;
}

export function createApp(deps: AppDependencies): Hono {
  const { logger, dteProvider, documentRepo, blobStore } = deps;
  const authorize = deps.authorize ?? (async () => true); // tests bypass

  const app = new Hono();

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  app.get('/healthz', (c) => c.json({ ok: true, service: 'document-service' }));

  // -------------------------------------------------------------------------
  // POST /generate/guia-despacho
  //   Emite DTE 52 (Guía) via DteProvider + indexa metadata + sube XML al GCS.
  // -------------------------------------------------------------------------
  app.post(
    '/generate/guia-despacho',
    zValidator(
      'json',
      z.object({
        tripId: z.string().uuid(),
        userId: z.string().uuid().optional(),
        guia: zCoercedGuiaInput,
      }),
    ),
    async (c) => {
      const { tripId, userId, guia } = c.req.valid('json');
      const auth = await authorize(c, { action: 'generate.guia', tripId });
      if (auth === 'anonymous') {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      if (!auth) {
        return c.json({ error: 'forbidden' }, 403);
      }

      try {
        const dteResult = await dteProvider.emitGuiaDespacho(guia as GuiaDespachoInput);

        const objectName = gcsPathFor({
          type: 'dte_52',
          identifier: dteResult.folio,
          extension: 'xml',
          emittedAt: dteResult.fechaEmision,
        });
        await uploadToGcs(blobStore, objectName, dteResult.xmlSigned);

        const record = await indexDocument(documentRepo, {
          tripId,
          type: 'dte_52',
          gcsPath: objectName,
          sha256: dteResult.sha256,
          folioSii: dteResult.folio,
          emittedByUserId: userId ?? null,
          sizeBytes: Buffer.byteLength(dteResult.xmlSigned, 'utf8'),
          emittedAt: dteResult.fechaEmision,
        });

        logger.info(
          {
            tripId,
            folio: dteResult.folio,
            documentId: record.id,
            providerStatus: dteResult.status,
          },
          'guia despacho emitida + indexada',
        );

        return c.json({ document: record, dte: dteResult }, 201);
      } catch (err) {
        return handleError(c, err, logger);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /generate/carta-porte
  //   Genera PDF + indexa + retorna signed URL (15 min) para descarga inmediata.
  // -------------------------------------------------------------------------
  app.post(
    '/generate/carta-porte',
    zValidator(
      'json',
      z.object({
        tripId: z.string().uuid(),
        userId: z.string().uuid().optional(),
        carta: zCoercedCartaInput,
      }),
    ),
    async (c) => {
      const { tripId, userId, carta } = c.req.valid('json');
      const auth = await authorize(c, { action: 'generate.carta', tripId });
      if (auth === 'anonymous') {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      if (!auth) {
        return c.json({ error: 'forbidden' }, 403);
      }

      try {
        const result = await generarCartaPorte(carta as CartaPorteInput);
        const objectName = gcsPathFor({
          type: 'carta_porte',
          identifier: carta.trackingCode,
          extension: 'pdf',
          emittedAt: carta.fechaEmision,
        });
        await uploadToGcs(blobStore, objectName, result.pdfBuffer);

        const record = await indexDocument(documentRepo, {
          tripId,
          type: 'carta_porte',
          gcsPath: objectName,
          sha256: result.sha256,
          folioSii: null,
          emittedByUserId: userId ?? null,
          sizeBytes: result.sizeBytes,
          emittedAt: carta.fechaEmision,
        });

        const downloadUrl = await getSignedReadUrl(blobStore, objectName, 900);

        logger.info(
          {
            tripId,
            trackingCode: carta.trackingCode,
            documentId: record.id,
            sizeBytes: result.sizeBytes,
          },
          'carta de porte generada + indexada',
        );

        return c.json({ document: record, downloadUrl }, 201);
      } catch (err) {
        return handleError(c, err, logger);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /documents/upload-url
  //   Signed PUT URL para upload directo cliente→GCS (sin pasar por backend).
  //   Útil para fotos pesadas del driver (pickup/delivery).
  // -------------------------------------------------------------------------
  app.post(
    '/documents/upload-url',
    zValidator(
      'json',
      z.object({
        tripId: z.string().uuid(),
        type: documentTypeSchema,
        identifier: z.string().min(1).max(64),
        contentType: z.string().min(3).max(80),
      }),
    ),
    async (c) => {
      const { tripId, type, identifier, contentType } = c.req.valid('json');
      const auth = await authorize(c, { action: 'upload.url', tripId });
      if (auth === 'anonymous') {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      if (!auth) {
        return c.json({ error: 'forbidden' }, 403);
      }

      try {
        const objectName = gcsPathFor({
          type: type as DocumentType,
          identifier,
          extension: contentType.split('/').pop() ?? 'bin',
        });
        const url = await getSignedUploadUrl(blobStore, {
          objectName,
          contentType,
          expiresInSeconds: 900,
        });
        return c.json({ objectName, uploadUrl: url, expiresInSeconds: 900 });
      } catch (err) {
        return handleError(c, err, logger);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /documents/:id/signed-url
  //   Signed READ URL (15 min) para descarga del documento.
  // -------------------------------------------------------------------------
  app.get('/documents/:id/signed-url', async (c) => {
    const id = c.req.param('id');
    const auth = await authorize(c, { action: 'document.read', documentId: id });
    if (auth === 'anonymous') {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    if (!auth) {
      return c.json({ error: 'forbidden' }, 403);
    }

    try {
      const record = await getDocumentById(documentRepo, id);
      const url = await getSignedReadUrl(blobStore, record.gcsPath, 900);
      return c.json({ document: record, downloadUrl: url, expiresInSeconds: 900 });
    } catch (err) {
      return handleError(c, err, logger);
    }
  });

  // -------------------------------------------------------------------------
  // GET /documents/:id  → metadata only (sin signed URL)
  // -------------------------------------------------------------------------
  app.get('/documents/:id', async (c) => {
    const id = c.req.param('id');
    const auth = await authorize(c, { action: 'document.read', documentId: id });
    if (auth === 'anonymous') {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    if (!auth) {
      return c.json({ error: 'forbidden' }, 403);
    }

    try {
      const record = await getDocumentById(documentRepo, id);
      return c.json({ document: record });
    } catch (err) {
      return handleError(c, err, logger);
    }
  });

  // -------------------------------------------------------------------------
  // GET /documents → listado filtrado
  // -------------------------------------------------------------------------
  app.get(
    '/documents',
    zValidator(
      'query',
      z.object({
        tripId: z.string().uuid().optional(),
        type: documentTypeSchema.optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
    ),
    async (c) => {
      const filter = c.req.valid('query');
      const auth = await authorize(c, {
        action: 'documents.list',
        ...(filter.tripId ? { tripId: filter.tripId } : {}),
      });
      if (auth === 'anonymous') {
        return c.json({ error: 'unauthenticated' }, 401);
      }
      if (!auth) {
        return c.json({ error: 'forbidden' }, 403);
      }

      try {
        // Pasamos solo los campos definidos para no chocar con
        // exactOptionalPropertyTypes de los Zod schemas del package.
        const cleanedFilter: Parameters<typeof listDocuments>[1] = {};
        if (filter.tripId) {
          cleanedFilter.tripId = filter.tripId;
        }
        if (filter.type) {
          cleanedFilter.type = filter.type;
        }
        if (filter.limit !== undefined) {
          cleanedFilter.limit = filter.limit;
        }
        if (filter.offset !== undefined) {
          cleanedFilter.offset = filter.offset;
        }
        const list = await listDocuments(documentRepo, cleanedFilter);
        return c.json({ documents: list, count: list.length });
      } catch (err) {
        return handleError(c, err, logger);
      }
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function uploadToGcs(
  blob: BlobStore,
  objectName: string,
  payload: string | Uint8Array | Buffer,
): Promise<void> {
  // El BlobStore abstract no expone "write" directo; en prod el caller
  // (apps/document-service main.ts) inyecta una implementación que usa
  // `bucket.file(name).save(buffer)`. Aquí asumimos esa interface y la
  // accedemos via stat → si stat retorna null tras el upload, fallamos.
  // Para mantener la interface BlobStore mínima, este helper queda como
  // adaptador interno: hace fetch del signed upload URL, putea, y stat-ea.
  //
  // En esta primera iteración delegamos al blobStore agregándole un método
  // opcional `uploadObject` cuando esté disponible (Drizzle/GCS adapter
  // real). Si no, error explícito.
  const blobWithUpload = blob as BlobStore & {
    uploadObject?: (objectName: string, payload: string | Uint8Array | Buffer) => Promise<void>;
  };
  if (typeof blobWithUpload.uploadObject !== 'function') {
    throw new Error(
      'BlobStore.uploadObject no implementado — el adapter inyectado en main.ts debe proveerlo (e.g. via @google-cloud/storage bucket.file().save()).',
    );
  }
  await blobWithUpload.uploadObject(objectName, payload);
}

function handleError(c: Context, err: unknown, logger: Logger) {
  // Mapping de errores tipados → HTTP. Cada error específico antes que el
  // genérico para preservar metadata.
  if (err instanceof DocumentValidationError) {
    return c.json({ error: 'invalid_input', fields: err.fieldErrors }, 400);
  }
  if (err instanceof DteValidationError) {
    return c.json({ error: 'invalid_dte_input', fields: err.fieldErrors }, 400);
  }
  if (err instanceof CartaPorteValidationError) {
    return c.json({ error: 'invalid_carta_input', fields: err.fieldErrors }, 400);
  }
  if (err instanceof DocumentNotFoundError) {
    return c.json({ error: 'not_found', id: err.id }, 404);
  }
  if (err instanceof DteProviderError) {
    logger.error({ err }, 'DTE provider error');
    return c.json({ error: 'dte_provider_error', message: err.message }, 502);
  }
  // Errores no tipados → 500 con log estructurado.
  logger.error(
    { err, message: (err as Error)?.message, stack: (err as Error)?.stack },
    'unhandled error in document-service',
  );
  return c.json({ error: 'internal_error' }, 500);
}

export type { DocumentRecord };
