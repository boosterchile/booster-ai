import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { transportDocumentManualEntryInputSchema } from '@booster-ai/shared-schemas';
import { PubSub } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { assignments, transportDocuments, trips } from '../db/schema.js';
import { calcularRetentionUntil } from '../services/calcular-retention-until.js';

/**
 * Repositorio documental de transporte (ADR-070, frente F4-4a).
 *
 * 4 endpoints Hono para que el generador de carga (dueño de la orden) o el
 * transportista asignado suban/listen/corrijan/descarguen documentos
 * tributarios de terceros (Guía de Despacho 52, Factura 33, etc.) que amparan
 * la carga de una orden (`viajes`). Booster RECIBE y ARCHIVA — no emite DTE
 * (ADR-069).
 *
 *   - POST /transport-orders/:id/documents  → multipart, sube a GCS, fila
 *       `pendiente`, publica `document.uploaded`, 202.
 *   - POST /documents/:id/manual-entry      → corrige campos → `ingreso_manual`.
 *   - GET  /transport-orders/:id/documents  → lista metadatos de la orden.
 *   - GET  /documents/:id                   → detalle + signed URL v4 de descarga.
 *
 * Autorización multitenant: el actor debe pertenecer a la empresa generadora
 * de carga dueña de la orden, o a la empresa transportista asignada. IDOR
 * cross-empresa → 403.
 *
 * El worker decodificador del TED es de la sub-fase 4b: en 4a el endpoint solo
 * persiste + publica + 202. Si `DOCUMENT_UPLOADED_TOPIC` no está seteado, el
 * publish se omite (el consumer llega en 4b) sin romper el flujo.
 */

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB
const SIGNED_URL_TTL_SECONDS = 300; // 5 min

/**
 * Estados de assignment (`estado_asignacion`) que mantienen vigente el vínculo
 * transportista↔viaje para autorizar acceso documental. Excluye `cancelado`:
 * un assignment cancelado NO debe seguir autorizando al transportista a
 * subir/ver/corregir documentos de la orden (review F4-4a finding 2). Si el
 * transportista vuelve a quedar asignado, será una fila nueva con estado
 * vigente (la tabla tiene UNIQUE por viaje_id, así que a lo más una vigente).
 */
const ASSIGNMENT_ESTADOS_VIGENTES = ['asignado', 'recogido', 'entregado'] as const;

function extForMime(mime: AllowedMime): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
  }
}

function sourceForMime(mime: AllowedMime): 'pdf_upload' | 'photo_upload' {
  return mime === 'application/pdf' ? 'pdf_upload' : 'photo_upload';
}

/**
 * Magic bytes (file signatures) de cada MIME permitido. Defensa en profundidad
 * (review F4-4a finding 3): `file.type` lo controla el cliente y puede mentir
 * (ej. renombrar un `.exe` a `.pdf` y declarar `application/pdf`). Validamos el
 * CONTENIDO real del buffer antes de archivarlo en GCS.
 *
 *   - PDF  → 25 50 44 46            ("%PDF")
 *   - JPEG → FF D8 FF
 *   - PNG  → 89 50 4E 47 0D 0A 1A 0A
 */
const MAGIC_BYTES: Record<AllowedMime, readonly number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/**
 * Detecta el MIME real de un buffer por sus magic bytes. Función pura: devuelve
 * el `AllowedMime` cuyo prefijo de firma coincide con el inicio del buffer, o
 * `null` si no coincide con ninguno permitido. No depende de la extensión ni
 * del `file.type` declarado.
 */
export function detectMagicByteMime(buffer: Uint8Array): AllowedMime | null {
  for (const mime of ALLOWED_MIME_TYPES) {
    const signature = MAGIC_BYTES[mime];
    if (buffer.length < signature.length) {
      continue;
    }
    let matches = true;
    for (let i = 0; i < signature.length; i++) {
      if (buffer[i] !== signature[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return mime;
    }
  }
  return null;
}

let cachedStorage: Storage | null = null;
function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

let cachedPubSub: PubSub | null = null;
function getPubSub(): PubSub {
  if (!cachedPubSub) {
    cachedPubSub = new PubSub();
  }
  return cachedPubSub;
}

/**
 * Publica `document.uploaded` fire-and-forget. Si falla, la fila ya está en
 * DB; el worker 4b puede reconciliar por estado `pendiente`. No crashea el
 * endpoint (que ya respondió 202).
 */
async function publishDocumentUploaded(opts: {
  topicName: string;
  logger: Logger;
  documentId: string;
  viajeId: string;
  filePath: string;
  fileMime: string;
}): Promise<void> {
  const { topicName, logger, documentId, viajeId, filePath, fileMime } = opts;
  try {
    const data = JSON.stringify({
      documentId,
      viajeId,
      filePath,
      fileMime,
    });
    // rls-allowlist: publishMessage de Pub/Sub (document.uploaded); no es query Drizzle —
    // el linter interpreta el `data` de .publishMessage({ data }) como nombre de tabla (falso positivo).
    await getPubSub()
      .topic(topicName)
      .publishMessage({ data: Buffer.from(data) });
  } catch (err) {
    logger.error(
      { err, documentId, viajeId },
      'publishDocumentUploaded falló (fila ya en DB; worker 4b reconcilia por estado pendiente)',
    );
  }
}

export function createTransportDocumentsRoutes(opts: {
  db: Db;
  logger: Logger;
  /** Bucket GCS para archivar los documentos. Si ausente, POST/GET descarga → 503. */
  transportDocumentsBucket?: string | undefined;
  /** Topic `document.uploaded`. Si ausente, el publish se omite (worker llega en 4b). */
  documentUploadedTopic?: string | undefined;
}) {
  const app = new Hono();

  function requireUserContext(c: Context) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/transport-documents without userContext');
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    return {
      ok: true as const,
      userContext,
      activeMembership: active,
      empresaId: active.empresa.id,
    };
  }

  /**
   * Gate de rol de ESCRITURA (review F4-4a finding 4). Reusa el mismo conjunto
   * que `documentos.ts:requireWriteRole`: solo dueño/admin/despachador del
   * membership activo pueden mutar el repositorio documental (subir, corregir).
   * Visualizador/conductor/stakeholder → 403 `write_role_required`. Los GET no
   * pasan por este gate (lectura abierta a cualquier rol del tenant autorizado).
   */
  function requireWriteRole(c: Context) {
    const auth = requireUserContext(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'write_role_required' }, 403),
      };
    }
    return auth;
  }

  /**
   * Verifica que `empresaId` está autorizada sobre el viaje `tripId`: dueña
   * generadora de carga del viaje, O transportista del assignment. Devuelve
   * `{ authorized, exists }`.
   */
  async function authorizeOverTrip(tripId: string, empresaId: string) {
    const tripRows = await opts.db
      .select({ id: trips.id, generadorCargaEmpresaId: trips.generadorCargaEmpresaId })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);
    const trip = tripRows[0];
    if (!trip) {
      return { exists: false as const, authorized: false as const };
    }
    if (trip.generadorCargaEmpresaId === empresaId) {
      return { exists: true as const, authorized: true as const };
    }
    const asgRows = await opts.db
      .select({ empresaId: assignments.empresaId })
      .from(assignments)
      .where(
        and(
          eq(assignments.tripId, tripId),
          inArray(assignments.status, ASSIGNMENT_ESTADOS_VIGENTES),
        ),
      )
      .limit(1);
    const asg = asgRows[0];
    if (asg && asg.empresaId === empresaId) {
      return { exists: true as const, authorized: true as const };
    }
    return { exists: true as const, authorized: false as const };
  }

  // ---------------------------------------------------------------------
  // POST /transport-orders/:id/documents — subir PDF/foto a una orden.
  // ---------------------------------------------------------------------
  app.post('/transport-orders/:id/documents', async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const tripId = c.req.param('id');

    if (!opts.transportDocumentsBucket) {
      opts.logger.error({ tripId }, 'TRANSPORT_DOCUMENTS_BUCKET ausente — no se puede archivar');
      return c.json({ error: 'storage_unavailable', code: 'storage_unavailable' }, 503);
    }

    const authz = await authorizeOverTrip(tripId, auth.empresaId);
    if (!authz.exists) {
      return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
    }
    if (!authz.authorized) {
      return c.json({ error: 'forbidden', code: 'forbidden' }, 403);
    }

    const formData = await c.req.formData().catch(() => null);
    if (!formData) {
      return c.json({ error: 'multipart_required', code: 'multipart_required' }, 400);
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'file_missing', code: 'file_missing' }, 400);
    }
    const mime = file.type;
    if (!ALLOWED_MIME_TYPES.includes(mime as AllowedMime)) {
      return c.json(
        { error: 'mime_not_allowed', code: 'mime_not_allowed', allowed: ALLOWED_MIME_TYPES },
        400,
      );
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return c.json(
        { error: 'file_too_large', code: 'file_too_large', max_bytes: MAX_DOCUMENT_BYTES },
        413,
      );
    }

    const allowedMime = mime as AllowedMime;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Defensa en profundidad (review F4-4a finding 3): validar magic bytes del
    // contenido, no solo `file.type` (que controla el cliente). Si el contenido
    // real no coincide con el MIME declarado (o no es ningún tipo permitido),
    // rechazamos ANTES de archivar en GCS.
    const detectedMime = detectMagicByteMime(buffer);
    if (detectedMime !== allowedMime) {
      opts.logger.warn(
        { tripId, declaredMime: allowedMime, detectedMime },
        'transport-document mime_mismatch — magic bytes no coinciden con el tipo declarado',
      );
      return c.json(
        { error: 'mime_mismatch', code: 'mime_mismatch', allowed: ALLOWED_MIME_TYPES },
        400,
      );
    }

    const objectName = `transport-documents/${tripId}/${randomUUID()}.${extForMime(allowedMime)}`;

    try {
      await getStorage()
        .bucket(opts.transportDocumentsBucket)
        .file(objectName)
        .save(buffer, {
          contentType: allowedMime,
          metadata: { cacheControl: 'private, max-age=3600' },
        });
    } catch (err) {
      opts.logger.error({ err, objectName, tripId }, 'transport-document GCS upload failed');
      return c.json({ error: 'upload_failed', code: 'upload_failed' }, 500);
    }

    let documentId: string;
    try {
      const inserted = await opts.db
        .insert(transportDocuments)
        .values({
          viajeId: tripId,
          filePath: objectName,
          fileMime: allowedMime,
          // doc_type real lo determina el TED (4b) o manual-entry. Defaulteamos
          // a 'other' hasta entonces (el enum lo exige notNull).
          docType: 'other',
          extractionStatus: 'pendiente',
          source: sourceForMime(allowedMime),
          uploadedBy: auth.userContext.user.id,
        })
        .returning({ id: transportDocuments.id });
      const row = inserted[0];
      if (!row) {
        throw new Error('insert returned no row');
      }
      documentId = row.id;
    } catch (err) {
      opts.logger.error({ err, objectName, tripId }, 'transport-document INSERT failed');
      return c.json({ error: 'persist_failed', code: 'persist_failed' }, 500);
    }

    opts.logger.info(
      { documentId, tripId, mime: allowedMime, source: sourceForMime(allowedMime) },
      'transport-document subido (pendiente)',
    );

    // Publish fire-and-forget. El consumer (worker TED) llega en 4b.
    if (opts.documentUploadedTopic) {
      await publishDocumentUploaded({
        topicName: opts.documentUploadedTopic,
        logger: opts.logger,
        documentId,
        viajeId: tripId,
        filePath: objectName,
        fileMime: allowedMime,
      });
    }

    return c.json({ document_id: documentId, extraction_status: 'pendiente' }, 202);
  });

  // ---------------------------------------------------------------------
  // POST /documents/:id/manual-entry — corregir campos a mano.
  // ---------------------------------------------------------------------
  app.post(
    '/documents/:id/manual-entry',
    zValidator('json', transportDocumentManualEntryInputSchema),
    async (c) => {
      const auth = requireWriteRole(c);
      if (!auth.ok) {
        return auth.response;
      }
      const documentId = c.req.param('id');
      const body = c.req.valid('json');

      const docRows = await opts.db
        .select({
          id: transportDocuments.id,
          viajeId: transportDocuments.viajeId,
          createdAt: transportDocuments.createdAt,
          // Estado de anclaje de la retención (invariante O-3): si la fila ya
          // tiene una fecha_emision válida, su retention_until está anclada a
          // la emisión y NO debe pisarse al corregir otros campos.
          fechaEmision: transportDocuments.fechaEmision,
          retentionUntil: transportDocuments.retentionUntil,
        })
        .from(transportDocuments)
        .where(eq(transportDocuments.id, documentId))
        .limit(1);
      const doc = docRows[0];
      if (!doc) {
        return c.json({ error: 'document_not_found', code: 'document_not_found' }, 404);
      }

      const authz = await authorizeOverTrip(doc.viajeId, auth.empresaId);
      if (!authz.authorized) {
        return c.json({ error: 'forbidden', code: 'forbidden' }, 403);
      }

      // Anclaje de retención (invariante O-3 / ADR-070). El ancla legal cuenta
      // desde la EMISIÓN del documento, no desde la subida:
      //  - fecha_emision provista y válida → corrección humana AUTORITATIVA:
      //    se ancla retention_until = fecha+6a (puede mover hacia arriba o
      //    hacia abajo; el operador asume la fecha real del documento).
      //  - SIN fecha provista → NUNCA pisar una retención ya anclada a una
      //    fecha_emision válida (corregir otro campo no debe tocar la
      //    retención). Solo si la fila aún NO está anclada y no tiene retención,
      //    se fija el fallback conservador created_at+6a.
      // (El schema Zod ya garantiza que body.fecha_emision, si viene, es un día
      // de calendario REAL → no hay throw al castear ::date.)
      const fechaUpdate =
        body.fecha_emision !== undefined ? { fechaEmision: body.fecha_emision } : undefined;
      let retentionUpdate: { retentionUntil: string } | undefined;
      let effectiveRetention = doc.retentionUntil;
      if (body.fecha_emision !== undefined) {
        const r = calcularRetentionUntil({
          fechaEmision: body.fecha_emision,
          createdAt: doc.createdAt,
        });
        retentionUpdate = { retentionUntil: r.retentionUntil };
        effectiveRetention = r.retentionUntil;
      } else if (doc.fechaEmision === null && doc.retentionUntil === null) {
        // Fila sin anclar y sin retención previa: fija el fallback conservador.
        const r = calcularRetentionUntil({ fechaEmision: null, createdAt: doc.createdAt });
        retentionUpdate = { retentionUntil: r.retentionUntil };
        effectiveRetention = r.retentionUntil;
      }

      try {
        // rls-allowlist: autorización por tenant vía authorizeOverTrip (el viaje pertenece al tenant);
        // documentos_transporte es hija de viajes, sin empresa_id propia para filtrar.
        await opts.db
          .update(transportDocuments)
          .set({
            ...(body.doc_type !== undefined ? { docType: body.doc_type } : {}),
            ...(body.folio !== undefined ? { folio: body.folio } : {}),
            ...(body.rut_emisor !== undefined ? { rutEmisor: body.rut_emisor } : {}),
            ...(body.razon_social_emisor !== undefined
              ? { razonSocialEmisor: body.razon_social_emisor }
              : {}),
            ...(body.rut_receptor !== undefined ? { rutReceptor: body.rut_receptor } : {}),
            ...(body.razon_social_receptor !== undefined
              ? { razonSocialReceptor: body.razon_social_receptor }
              : {}),
            ...(body.monto_total !== undefined ? { montoTotal: body.monto_total } : {}),
            ...(fechaUpdate ?? {}),
            ...(retentionUpdate ?? {}),
            extractionStatus: 'ingreso_manual',
            updatedAt: new Date(),
          })
          .where(eq(transportDocuments.id, documentId));
      } catch (err) {
        opts.logger.error({ err, documentId }, 'transport-document manual-entry UPDATE failed');
        return c.json({ error: 'update_failed', code: 'update_failed' }, 500);
      }

      opts.logger.info(
        { documentId, retentionRecalculada: retentionUpdate !== undefined },
        'transport-document manual-entry → ingreso_manual',
      );

      return c.json({
        ok: true,
        document_id: documentId,
        extraction_status: 'ingreso_manual',
        retention_until: effectiveRetention,
      });
    },
  );

  // ---------------------------------------------------------------------
  // GET /transport-orders/:id/documents — listar metadatos de la orden.
  // ---------------------------------------------------------------------
  app.get('/transport-orders/:id/documents', async (c) => {
    const auth = requireUserContext(c);
    if (!auth.ok) {
      return auth.response;
    }
    const tripId = c.req.param('id');

    const authz = await authorizeOverTrip(tripId, auth.empresaId);
    if (!authz.exists) {
      return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
    }
    if (!authz.authorized) {
      return c.json({ error: 'forbidden', code: 'forbidden' }, 403);
    }

    const rows = await opts.db
      .select({
        id: transportDocuments.id,
        docType: transportDocuments.docType,
        folio: transportDocuments.folio,
        fileMime: transportDocuments.fileMime,
        extractionStatus: transportDocuments.extractionStatus,
        source: transportDocuments.source,
        fechaEmision: transportDocuments.fechaEmision,
        montoTotal: transportDocuments.montoTotal,
        retentionUntil: transportDocuments.retentionUntil,
        createdAt: transportDocuments.createdAt,
      })
      .from(transportDocuments)
      .where(eq(transportDocuments.viajeId, tripId))
      .orderBy(desc(transportDocuments.createdAt));

    return c.json({ documents: rows });
  });

  // ---------------------------------------------------------------------
  // GET /documents/:id — detalle + signed URL v4 de descarga.
  // ---------------------------------------------------------------------
  app.get('/documents/:id', async (c) => {
    const auth = requireUserContext(c);
    if (!auth.ok) {
      return auth.response;
    }
    const documentId = c.req.param('id');

    const docRows = await opts.db
      .select()
      .from(transportDocuments)
      .where(eq(transportDocuments.id, documentId))
      .limit(1);
    const doc = docRows[0];
    if (!doc) {
      return c.json({ error: 'document_not_found', code: 'document_not_found' }, 404);
    }

    const authz = await authorizeOverTrip(doc.viajeId, auth.empresaId);
    if (!authz.authorized) {
      return c.json({ error: 'forbidden', code: 'forbidden' }, 403);
    }

    let downloadUrl: string | null = null;
    if (opts.transportDocumentsBucket) {
      try {
        const [url] = await getStorage()
          .bucket(opts.transportDocumentsBucket)
          .file(doc.filePath)
          .getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
          });
        downloadUrl = url;
      } catch (err) {
        opts.logger.error({ err, documentId }, 'transport-document signed URL failed');
      }
    }

    return c.json({
      document: {
        id: doc.id,
        viaje_id: doc.viajeId,
        doc_type: doc.docType,
        folio: doc.folio,
        file_mime: doc.fileMime,
        rut_emisor: doc.rutEmisor,
        razon_social_emisor: doc.razonSocialEmisor,
        rut_receptor: doc.rutReceptor,
        razon_social_receptor: doc.razonSocialReceptor,
        fecha_emision: doc.fechaEmision,
        monto_total: doc.montoTotal,
        ted_signature_valid: doc.tedSignatureValid,
        extraction_status: doc.extractionStatus,
        source: doc.source,
        retention_until: doc.retentionUntil,
        creado_en: doc.createdAt,
      },
      download_url: downloadUrl,
    });
  });

  return app;
}
