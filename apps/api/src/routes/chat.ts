/**
 * Chat shipper↔transportista por assignment (P3.a — endpoints REST).
 *
 * Endpoints:
 *   - POST   /assignments/:id/messages              — enviar mensaje
 *   - GET    /assignments/:id/messages              — listar (cursor pagination)
 *   - PATCH  /assignments/:id/messages/read         — marcar como leído
 *   - POST   /assignments/:id/messages/photo-upload-url — signed URL GCS PUT
 *
 * Permisos:
 *   - SHIPPER: el user pertenece a la empresa que es generador_carga del trip
 *     que tiene este assignment.
 *   - CARRIER: el user pertenece a la empresa que es dueña del assignment
 *     (assignment.empresa_id).
 *   - Cualquier otro user → 403 forbidden.
 *
 * Estados que permiten escritura:
 *   - assignment.status ∈ {asignado, en_proceso}: ambos lados pueden escribir.
 *   - assignment.status ∈ {entregado, cancelado}: read-only (los GET y PATCH
 *     read funcionan, pero POST nuevo mensaje devuelve 409 chat_closed).
 *
 * Pub/Sub publish (P3.b): el wire fire-and-forget post-INSERT vive en este
 * file pero arranca null hasta que P3.b configure el topic. Misma idea de
 * config-optional que usamos para certificados.
 */

import type { Logger } from '@booster-ai/logger';
import { Storage } from '@google-cloud/storage';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  assignments,
  chatMessages,
  trips,
  users as usersTable,
} from '../db/schema.js';
import {
  createEphemeralChatSubscription,
  publishChatMessage,
} from '../services/chat-pubsub.js';

let cachedStorage: Storage | null = null;

function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

// =============================================================================
// Schemas (zod)
// =============================================================================

const sendMessageBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('texto'),
    text: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('foto'),
    /**
     * URI gs:// devuelta por POST /photo-upload-url. Validamos que empiece
     * con gs://{bucket}/chat/{assignment_id}/ para evitar que un caller
     * malicioso aproveche el endpoint para guardar URIs arbitrarios.
     */
    photo_gcs_uri: z.string().regex(/^gs:\/\/[a-z0-9-]+\/chat\/[0-9a-f-]+\/[0-9a-f-]+\.[a-z]+$/),
  }),
  z.object({
    type: z.literal('ubicacion'),
    location_lat: z.number().min(-90).max(90),
    location_lng: z.number().min(-180).max(180),
  }),
]);

const photoUploadUrlBodySchema = z.object({
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const listQuerySchema = z.object({
  /** Mensaje id desde el cual paginar hacia atrás (más viejos). */
  cursor: z.string().uuid().optional(),
  /** Máximo a devolver. Default 50, max 100. */
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((n) => n > 0 && n <= 100, 'limit debe ser 1-100')
    .optional(),
});

// =============================================================================
// Factory
// =============================================================================

export function createChatRoutes(opts: {
  db: Db;
  logger: Logger;
  attachmentsBucket?: string;
  /**
   * Pub/Sub topic para realtime (P3.b). Si está ausente, POST igual
   * inserta en DB pero no publica al topic; GET /stream devuelve 503.
   * En dev sin Pub/Sub, la UI cae a polling como fallback.
   */
  pubsubTopic?: string;
}) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Helper: valida que el user actual tenga acceso al chat de este assignment
  // y devuelve su rol (shipper/carrier) + empresa para usar al insertar.
  // -------------------------------------------------------------------------
  async function resolveChatAccess(
    // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
    c: Context<any, any, any>,
    assignmentId: string,
  ): Promise<
    | {
        ok: true;
        role: 'transportista' | 'generador_carga';
        empresaId: string;
        userId: string;
        assignmentStatus: string;
      }
    | { ok: false; response: Response }
  > {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/chat without userContext');
      return { ok: false, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }

    // Cargar assignment + trip en una sola query (necesitamos generador_carga_empresa_id
    // del trip para validar shipper, y empresa_id del assignment para carrier).
    const rows = await opts.db
      .select({
        assignmentId: assignments.id,
        assignmentStatus: assignments.status,
        carrierEmpresaId: assignments.empresaId,
        shipperEmpresaId: trips.generadorCargaEmpresaId,
      })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        ok: false,
        response: c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404),
      };
    }

    const empresaActivaId = active.empresa.id;
    let role: 'transportista' | 'generador_carga' | null = null;
    if (empresaActivaId === row.shipperEmpresaId) {
      role = 'generador_carga';
    } else if (empresaActivaId === row.carrierEmpresaId) {
      role = 'transportista';
    }

    if (!role) {
      return {
        ok: false,
        response: c.json(
          { error: 'forbidden_not_party', code: 'forbidden_not_party' },
          403,
        ),
      };
    }

    return {
      ok: true,
      role,
      empresaId: empresaActivaId,
      userId: userContext.user.id,
      assignmentStatus: row.assignmentStatus,
    };
  }

  // -------------------------------------------------------------------------
  // POST /:id/messages — enviar
  // -------------------------------------------------------------------------
  app.post('/:id/messages', zValidator('json', sendMessageBodySchema), async (c) => {
    const assignmentId = c.req.param('id');
    const access = await resolveChatAccess(c, assignmentId);
    if (!access.ok) return access.response;

    // Solo se puede escribir mientras el assignment esté activo. Una vez
    // entregado/cancelado el chat queda read-only.
    if (!['asignado', 'en_proceso'].includes(access.assignmentStatus)) {
      return c.json(
        {
          error: 'chat_closed',
          code: 'chat_closed',
          assignment_status: access.assignmentStatus,
        },
        409,
      );
    }

    const body = c.req.valid('json');

    // Si es foto, validar que el GCS URI matchea el bucket configurado y el
    // assignment correcto (defensa-en-profundidad sobre el regex zod).
    if (body.type === 'foto') {
      if (!opts.attachmentsBucket) {
        return c.json(
          { error: 'attachments_disabled', code: 'attachments_disabled' },
          503,
        );
      }
      const expectedPrefix = `gs://${opts.attachmentsBucket}/chat/${assignmentId}/`;
      if (!body.photo_gcs_uri.startsWith(expectedPrefix)) {
        return c.json(
          { error: 'photo_uri_mismatch', code: 'photo_uri_mismatch' },
          400,
        );
      }
    }

    const insertValues = {
      assignmentId,
      senderEmpresaId: access.empresaId,
      senderUserId: access.userId,
      senderRole: access.role,
      messageType: body.type,
      ...(body.type === 'texto' ? { textContent: body.text } : {}),
      ...(body.type === 'foto' ? { photoGcsUri: body.photo_gcs_uri } : {}),
      ...(body.type === 'ubicacion'
        ? {
            // Drizzle numeric espera string para precision.
            locationLat: String(body.location_lat),
            locationLng: String(body.location_lng),
          }
        : {}),
    };

    const [inserted] = await opts.db.insert(chatMessages).values(insertValues).returning();
    if (!inserted) {
      opts.logger.error({ assignmentId }, 'chat insert returned no row');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    opts.logger.info(
      {
        messageId: inserted.id,
        assignmentId,
        senderRole: access.role,
        type: body.type,
      },
      'chat message sent',
    );

    // P3.b — fire-and-forget publish al topic Pub/Sub para que los SSE
    // viewers de este assignment reciban el mensaje en realtime. Si
    // falla, el mensaje ya está en DB; los viewers se enteran al próximo
    // refetch o cuando otro mensaje publique OK.
    if (opts.pubsubTopic) {
      void publishChatMessage({
        topicName: opts.pubsubTopic,
        logger: opts.logger,
        assignmentId,
        messageId: inserted.id,
      });
    }
    // P3.c — wire Web Push también acá.

    return c.json(
      {
        message: serializeMessage(inserted),
      },
      201,
    );
  });

  // -------------------------------------------------------------------------
  // GET /:id/messages?cursor=&limit= — listar
  // -------------------------------------------------------------------------
  app.get('/:id/messages', zValidator('query', listQuerySchema), async (c) => {
    const assignmentId = c.req.param('id');
    const access = await resolveChatAccess(c, assignmentId);
    if (!access.ok) return access.response;

    const { cursor, limit } = c.req.valid('query');
    const effectiveLimit = limit ?? 50;

    // Cursor pagination: si hay cursor, traer mensajes con created_at <
    // cursor.created_at. Para hacerlo, primero resolvemos el cursor →
    // created_at del mensaje cursor.
    let cursorCreatedAt: Date | null = null;
    if (cursor) {
      const [cursorRow] = await opts.db
        .select({ createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(eq(chatMessages.id, cursor))
        .limit(1);
      if (!cursorRow) {
        return c.json({ error: 'invalid_cursor', code: 'invalid_cursor' }, 400);
      }
      cursorCreatedAt = cursorRow.createdAt;
    }

    const whereClauses = cursorCreatedAt
      ? and(
          eq(chatMessages.assignmentId, assignmentId),
          lt(chatMessages.createdAt, cursorCreatedAt),
        )
      : eq(chatMessages.assignmentId, assignmentId);

    const rows = await opts.db
      .select({
        id: chatMessages.id,
        senderEmpresaId: chatMessages.senderEmpresaId,
        senderUserId: chatMessages.senderUserId,
        senderRole: chatMessages.senderRole,
        messageType: chatMessages.messageType,
        textContent: chatMessages.textContent,
        photoGcsUri: chatMessages.photoGcsUri,
        locationLat: chatMessages.locationLat,
        locationLng: chatMessages.locationLng,
        readAt: chatMessages.readAt,
        createdAt: chatMessages.createdAt,
        senderName: usersTable.fullName,
      })
      .from(chatMessages)
      .leftJoin(usersTable, eq(usersTable.id, chatMessages.senderUserId))
      .where(whereClauses)
      .orderBy(desc(chatMessages.createdAt))
      .limit(effectiveLimit + 1);

    // Detectar si hay más allá del límite.
    const hasMore = rows.length > effectiveLimit;
    const messages = hasMore ? rows.slice(0, effectiveLimit) : rows;
    const nextCursor = hasMore ? messages[messages.length - 1]?.id ?? null : null;

    return c.json({
      messages: messages.map(serializeMessageWithSender),
      // Cliente usa este como cursor para el próximo GET (mensajes más viejos).
      next_cursor: nextCursor,
      // Útil para que el cliente sepa el rol propio sin re-resolverlo.
      viewer_role: access.role,
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /:id/messages/read — marcar como leído
  // -------------------------------------------------------------------------
  app.patch('/:id/messages/read', async (c) => {
    const assignmentId = c.req.param('id');
    const access = await resolveChatAccess(c, assignmentId);
    if (!access.ok) return access.response;

    // Marca como leídos todos los mensajes del OTRO rol que aún están unread.
    // No tocamos read_at de los propios (sería trivial — uno mismo no se
    // marca como leído).
    const result = await opts.db
      .update(chatMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(chatMessages.assignmentId, assignmentId),
          ne(chatMessages.senderRole, access.role),
          isNull(chatMessages.readAt),
        ),
      )
      .returning({ id: chatMessages.id });

    return c.json({
      marked_read: result.length,
    });
  });

  // -------------------------------------------------------------------------
  // GET /:id/messages/stream — SSE realtime (P3.b)
  // -------------------------------------------------------------------------
  // El cliente abre EventSource a este endpoint. El servidor:
  //   1. Crea una subscription efímera al topic chat-messages con filter
  //      por assignment_id.
  //   2. Envía un evento `connected` con el subscription name (debug).
  //   3. Cada vez que llega un mensaje al topic, lo serializa y envía
  //      como evento SSE 'message' con el payload {message_id, assignment_id}.
  //      El cliente usa eso para invalidar el cache de useQuery o pedir
  //      el GET /messages individual del nuevo id.
  //   4. Heartbeat cada 25s para mantener la conexión viva a través de
  //      proxies (Cloud Armor cierra conexiones idle a ~60s).
  //   5. Cuando el cliente desconecta (window unload, tab close), borra
  //      la subscription y cierra el stream.
  // -------------------------------------------------------------------------
  app.get('/:id/messages/stream', async (c) => {
    const assignmentId = c.req.param('id');
    const access = await resolveChatAccess(c, assignmentId);
    if (!access.ok) return access.response;

    if (!opts.pubsubTopic) {
      return c.json(
        { error: 'realtime_disabled', code: 'realtime_disabled' },
        503,
      );
    }

    const { subscription, cleanup } = await createEphemeralChatSubscription({
      topicName: opts.pubsubTopic,
      logger: opts.logger,
      assignmentId,
    });

    return streamSSE(c, async (stream) => {
      // Evento inicial — útil para debug client-side y para confirmar al
      // cliente que la conexión está viva (antes del primer mensaje).
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ assignment_id: assignmentId }),
      });

      // Forward de cada mensaje del topic al cliente SSE.
      const onMessage = async (msg: { data: Buffer; ack: () => void; nack: () => void }) => {
        try {
          const payload = JSON.parse(msg.data.toString('utf-8'));
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify(payload),
          });
          msg.ack();
        } catch (err) {
          opts.logger.warn(
            { err, assignmentId },
            'SSE forward de mensaje Pub/Sub falló (nack para reintento)',
          );
          msg.nack();
        }
      };

      const onSubError = (err: Error) => {
        opts.logger.error({ err, assignmentId }, 'subscription Pub/Sub error');
      };

      subscription.on('message', onMessage);
      subscription.on('error', onSubError);

      // Heartbeat para evitar que proxies cierren la conexión idle.
      // 25s es seguro para Cloud Run + Cloud Armor (cierran ~60s default).
      const heartbeat = setInterval(() => {
        // No await — si el stream está cerrándose, write puede throw.
        // El catch en el bloque externo lo captura.
        stream
          .writeSSE({
            event: 'heartbeat',
            data: new Date().toISOString(),
          })
          .catch(() => {
            // Cliente probablemente desconectó.
          });
      }, 25_000);

      // Esperar a que el cliente desconecte. onAbort se dispara cuando el
      // browser cierra la conexión (tab close, navegación, network drop).
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          opts.logger.info({ assignmentId }, 'SSE client disconnected');
          resolve();
        });
      });

      // Cleanup ordenado.
      clearInterval(heartbeat);
      subscription.removeListener('message', onMessage);
      subscription.removeListener('error', onSubError);
      await cleanup();
    });
  });

  // -------------------------------------------------------------------------
  // POST /:id/messages/photo-upload-url — signed URL GCS PUT
  // -------------------------------------------------------------------------
  // El cliente:
  //   1. POST aquí con content_type
  //   2. recibe { upload_url, gcs_uri }
  //   3. PUT directo a upload_url con la imagen (browser → GCS, sin proxy api)
  //   4. POST /messages con type=foto, photo_gcs_uri=<gcs_uri devuelto>
  //
  // Por qué signed URL en vez de proxy:
  //   - Cero CPU del api durante uploads (las fotos pueden ser MB).
  //   - Cero memoria del api (no hay que bufferear el body completo).
  //   - El browser hace upload paralelo al PUT mientras el resto de la UI
  //     sigue respondiendo.
  app.post(
    '/:id/messages/photo-upload-url',
    zValidator('json', photoUploadUrlBodySchema),
    async (c) => {
      const assignmentId = c.req.param('id');
      const access = await resolveChatAccess(c, assignmentId);
      if (!access.ok) return access.response;

      if (!opts.attachmentsBucket) {
        return c.json(
          { error: 'attachments_disabled', code: 'attachments_disabled' },
          503,
        );
      }

      // Solo permitir mientras el chat esté activo (consistente con POST /messages).
      if (!['asignado', 'en_proceso'].includes(access.assignmentStatus)) {
        return c.json(
          {
            error: 'chat_closed',
            code: 'chat_closed',
            assignment_status: access.assignmentStatus,
          },
          409,
        );
      }

      const { content_type } = c.req.valid('json');
      const ext = content_type === 'image/jpeg' ? 'jpg' : content_type === 'image/png' ? 'png' : 'webp';

      // El cliente todavía no tiene messageId (lo emite la DB al insertar
      // el mensaje), así que generamos un UUID para el filename. El cliente
      // PUT a esa URI y después POST /messages con el gcs_uri.
      // Si el cliente nunca llega a hacer el POST /messages, el archivo
      // queda huérfano en GCS — el lifecycle de 90 días lo barre.
      const filenameUuid = crypto.randomUUID();
      const gcsPath = `chat/${assignmentId}/${filenameUuid}.${ext}`;
      const gcsUri = `gs://${opts.attachmentsBucket}/${gcsPath}`;

      const file = getStorage().bucket(opts.attachmentsBucket).file(gcsPath);
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 5 * 60 * 1000, // TTL 5 min
        contentType: content_type,
      });

      return c.json({
        upload_url: uploadUrl,
        gcs_uri: gcsUri,
        expires_in_seconds: 300,
        // El cliente debe usar EXACTAMENTE este Content-Type en el PUT,
        // sino GCS rechaza la firma. Lo devolvemos echo para evitar bugs.
        required_content_type: content_type,
      });
    },
  );

  return app;
}

// =============================================================================
// Serializers — mantienen el shape estable hacia el cliente
// =============================================================================

function serializeMessage(row: {
  id: string;
  senderEmpresaId: string;
  senderUserId: string;
  senderRole: 'transportista' | 'generador_carga';
  messageType: 'texto' | 'foto' | 'ubicacion';
  textContent: string | null;
  photoGcsUri: string | null;
  locationLat: string | null;
  locationLng: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    sender_empresa_id: row.senderEmpresaId,
    sender_user_id: row.senderUserId,
    sender_role: row.senderRole,
    type: row.messageType,
    text: row.textContent,
    photo_gcs_uri: row.photoGcsUri,
    location_lat: row.locationLat ? Number(row.locationLat) : null,
    location_lng: row.locationLng ? Number(row.locationLng) : null,
    read_at: row.readAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function serializeMessageWithSender(row: {
  id: string;
  senderEmpresaId: string;
  senderUserId: string;
  senderRole: 'transportista' | 'generador_carga';
  messageType: 'texto' | 'foto' | 'ubicacion';
  textContent: string | null;
  photoGcsUri: string | null;
  locationLat: string | null;
  locationLng: string | null;
  readAt: Date | null;
  createdAt: Date;
  senderName: string | null;
}) {
  return {
    ...serializeMessage(row),
    sender_name: row.senderName,
  };
}
