import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { Storage } from '@google-cloud/storage';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { denegarPublicarCarga } from '../auth/capacidades.js';
import type { Db } from '../db/client.js';
import { pickupInstructions } from '../db/schema.js';
import { extForMime, validarArchivoSubido } from '../lib/archivo-subido.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { autorizarSobreViaje } from '../services/autorizar-sobre-viaje.js';

/**
 * Instrucciones de retiro (spec `instrucciones-retiro`).
 *
 * El generador sube el QR o comprobante que le entrega el lugar de retiro, con
 * el lugar y una nota, y el conductor lo muestra al retirar. Va aparte del
 * repositorio documental (decisión del PO, 2026-11-09): no pasa por el TED, no
 * se retiene 6 años y no cuenta para el cierre de la entrega.
 *
 *   PUT /viajes/:id/instrucciones-retiro — el generador dueño, rol de gestión.
 *   GET /viajes/:id/instrucciones-retiro — generador dueño, transportista
 *       asignada y el conductor solo con la asignación a su nombre.
 */

const SIGNED_URL_TTL_SECONDS = 300; // 5 min
const MAX_TEXTO = 500;

/** Campos de texto del multipart: vacío o solo espacios → null. */
const textoOpcional = z
  .string()
  .max(MAX_TEXTO)
  .transform((v) => v.trim())
  .transform((v) => (v.length > 0 ? v : null));

const camposSchema = z.object({
  lugar: textoOpcional.nullable().default(null),
  nota: textoOpcional.nullable().default(null),
});

let cachedStorage: Storage | null = null;
function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

interface FilaInstrucciones {
  filePath: string | null;
  fileMime: string | null;
  place: string | null;
  note: string | null;
  updatedAt: Date;
}

export function createPickupInstructionsRoutes(opts: {
  db: Db;
  logger: Logger;
  /** Bucket GCS (INSTRUCCIONES_RETIRO_BUCKET). Sin él, subir o firmar → 503. */
  bucket?: string | undefined;
}) {
  const app = new Hono();

  function requireUserContext(c: Context) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/viajes/instrucciones-retiro sin userContext');
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    return { ok: true as const, userContext, empresaId: active.empresa.id };
  }

  async function autorizar(c: Context, tripId: string) {
    const auth = requireUserContext(c);
    if (!auth.ok) {
      return auth;
    }
    const authz = await autorizarSobreViaje(opts.db, tripId, auth.empresaId, {
      role: auth.userContext.activeMembership?.membership.role ?? '',
      userId: auth.userContext.user.id,
    });
    if (!authz.exists) {
      return {
        ok: false as const,
        response: c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404),
      };
    }
    if (!authz.authorized) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'forbidden' }, 403),
      };
    }
    return { ok: true as const, auth, lado: authz.lado };
  }

  async function leerFila(tripId: string): Promise<FilaInstrucciones | null> {
    // rls-allowlist: el viaje ya pasó por autorizarSobreViaje contra la empresa activa (empresaId).
    const rows = await opts.db
      .select({
        filePath: pickupInstructions.filePath,
        fileMime: pickupInstructions.fileMime,
        place: pickupInstructions.place,
        note: pickupInstructions.note,
        updatedAt: pickupInstructions.updatedAt,
      })
      .from(pickupInstructions)
      .where(eq(pickupInstructions.viajeId, tripId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function serializar(c: Context, fila: FilaInstrucciones) {
    let archivo: { mime: string; url: string } | null = null;
    // El bucket borra los objetos a los 90 días (lifecycle de uploads_raw). Si
    // el archivo ya no está, se avisa en vez de firmar una URL que da 404.
    let archivoVencido = false;
    if (fila.filePath && fila.fileMime) {
      if (!opts.bucket) {
        return c.json({ error: 'storage_unavailable', code: 'storage_unavailable' }, 503);
      }
      const objeto = getStorage().bucket(opts.bucket).file(fila.filePath);
      const [existe] = await objeto.exists();
      if (existe) {
        const [url] = await objeto.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        });
        archivo = { mime: fila.fileMime, url };
      } else {
        archivoVencido = true;
        opts.logger.warn(
          { filePath: fila.filePath },
          'instrucciones-retiro: el archivo ya no está en el bucket (ciclo de vida)',
        );
      }
    }
    return c.json({
      instrucciones: {
        lugar: fila.place,
        nota: fila.note,
        archivo,
        archivo_vencido: archivoVencido,
        actualizado_en: fila.updatedAt.toISOString(),
      },
    });
  }

  app.get('/viajes/:id/instrucciones-retiro', async (c) => {
    const tripId = c.req.param('id');
    const authz = await autorizar(c, tripId);
    if (!authz.ok) {
      return authz.response;
    }
    const fila = await leerFila(tripId);
    if (!fila) {
      return c.json({ error: 'sin_instrucciones', code: 'sin_instrucciones' }, 404);
    }
    return serializar(c, fila);
  });

  app.put('/viajes/:id/instrucciones-retiro', async (c) => {
    const tripId = c.req.param('id');
    const authz = await autorizar(c, tripId);
    if (!authz.ok) {
      return authz.response;
    }
    // Solo el generador dueño, con rol de gestión. La transportista lee pero
    // no escribe: las instrucciones vienen del lugar de retiro vía el generador.
    if (authz.lado !== 'generador') {
      return c.json({ error: 'forbidden', code: 'forbidden' }, 403);
    }
    const sinPermiso = denegarPublicarCarga(c, authz.auth.userContext);
    if (sinPermiso) {
      return sinPermiso;
    }

    const formData = await c.req.formData().catch(() => null);
    if (!formData) {
      return c.json({ error: 'multipart_required', code: 'multipart_required' }, 400);
    }
    const lugarCrudo = formData.get('lugar');
    const notaCrudo = formData.get('nota');
    const campos = camposSchema.safeParse({
      lugar: typeof lugarCrudo === 'string' ? lugarCrudo : null,
      nota: typeof notaCrudo === 'string' ? notaCrudo : null,
    });
    if (!campos.success) {
      return c.json({ error: 'invalid_body', code: 'invalid_body', max_length: MAX_TEXTO }, 400);
    }

    // `anterior` solo sirve para validar que quede archivo o nota. El archivo
    // vigente no se reescribe desde esta lectura: sin archivo nuevo, el upsert
    // deja las columnas del archivo como están en la BD (evita pisar un QR que
    // otro usuario subió entre esta lectura y el upsert).
    const anterior = await leerFila(tripId);
    let filePath: string | null = null;
    let fileMime: string | null = null;
    const file = formData.get('file');
    let archivoNuevo: {
      buffer: Buffer;
      mime: 'application/pdf' | 'image/jpeg' | 'image/png';
    } | null = null;
    if (file instanceof File) {
      const validado = await validarArchivoSubido(file);
      if (!validado.ok) {
        if (validado.body.code === 'mime_mismatch') {
          opts.logger.warn(
            { tripId, declaredMime: file.type, detectedMime: validado.detectedMime ?? null },
            'instrucciones-retiro mime_mismatch — magic bytes no coinciden con el tipo declarado',
          );
        }
        return c.json(validado.body, validado.status);
      }
      if (!opts.bucket) {
        return c.json({ error: 'storage_unavailable', code: 'storage_unavailable' }, 503);
      }
      archivoNuevo = { buffer: validado.buffer, mime: validado.mime };
      filePath = `instrucciones-retiro/${tripId}/${randomUUID()}.${extForMime(validado.mime)}`;
      fileMime = validado.mime;
    }

    const { lugar, nota } = campos.data;
    if (!filePath && !anterior?.filePath && !nota) {
      return c.json({ error: 'instrucciones_vacias', code: 'instrucciones_vacias' }, 400);
    }

    return await withBusinessSpan(
      {
        name: 'retiro.instrucciones_guardadas',
        attributes: {
          'booster.trip_id': tripId,
          'booster.retiro.archivo_nuevo': Boolean(filePath),
        },
      },
      async (span) => {
        if (archivoNuevo && filePath && opts.bucket) {
          try {
            await getStorage()
              .bucket(opts.bucket)
              .file(filePath)
              .save(archivoNuevo.buffer, {
                contentType: archivoNuevo.mime,
                metadata: { cacheControl: 'private, max-age=3600' },
              });
          } catch (err) {
            opts.logger.error({ err, tripId, filePath }, 'instrucciones-retiro GCS upload failed');
            setResultAttributes(span, { 'booster.retiro.outcome': 'upload_failed' });
            return c.json({ error: 'upload_failed', code: 'upload_failed' }, 500);
          }
        }
        const valores = {
          viajeId: tripId,
          filePath,
          fileMime,
          place: lugar,
          note: nota,
          uploadedBy: authz.auth.userContext.user.id,
        };
        // rls-allowlist: el viaje ya pasó por autorizarSobreViaje contra la empresa activa (empresaId).
        const [fila] = await opts.db
          .insert(pickupInstructions)
          .values(valores)
          .onConflictDoUpdate({
            target: pickupInstructions.viajeId,
            set: {
              // Sin archivo nuevo, las columnas del archivo no se tocan.
              ...(archivoNuevo ? { filePath, fileMime } : {}),
              place: lugar,
              note: nota,
              uploadedBy: valores.uploadedBy,
              updatedAt: sql`now()`,
            },
          })
          .returning({
            filePath: pickupInstructions.filePath,
            fileMime: pickupInstructions.fileMime,
            place: pickupInstructions.place,
            note: pickupInstructions.note,
            updatedAt: pickupInstructions.updatedAt,
          });
        if (!fila) {
          opts.logger.error({ tripId }, 'instrucciones-retiro: el upsert no devolvió fila');
          setResultAttributes(span, { 'booster.retiro.outcome': 'sin_fila' });
          return c.json({ error: 'internal_error', code: 'internal_error' }, 500);
        }
        setResultAttributes(span, { 'booster.retiro.outcome': 'guardadas' });
        opts.logger.info(
          {
            tripId,
            archivoNuevo: Boolean(archivoNuevo),
            conArchivo: Boolean(fila.filePath),
            reemplazo: Boolean(anterior),
          },
          'instrucciones de retiro guardadas',
        );
        return serializar(c, fila);
      },
    );
  });

  return app;
}
