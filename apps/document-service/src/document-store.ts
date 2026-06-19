/**
 * Implementación Drizzle del puerto `DocumentStore` sobre `documentos_transporte`.
 *
 * Usa SQL crudo vía `db.execute(sql\`...\`)` (mismo patrón que
 * telemetry-processor/persist.ts) para no acoplar el worker al schema de
 * `apps/api`. Todos los writes son parametrizados (sql tagged template → no
 * inyección).
 *
 * Idempotencia (sin columna nueva): `claimForProcessing` es un UPDATE
 * condicional por estado. Solo toma la fila si está en `pendiente` o `fallido`
 * (re-intento válido). Una fila ya `procesando`/`decodificado`/`ingreso_manual`
 * NO se reclama → el consumer ack-skip sin reprocesar destructivamente.
 *
 * NUNCA acorta una retención ya fijada (invariante O-3 / gate C-7 §4):
 * `persistDecoded` fija `retention_until` con `GREATEST(COALESCE(retention_until,
 * nuevo), nuevo)` — el MAYOR entre el valor ya persistido (p.ej. el fallback
 * `created_at + 6a` de 4a) y el nuevo cálculo (`fecha_emision + 6a` o el mismo
 * fallback). Así jamás se reduce un plazo ya escrito, aunque la `fecha_emision`
 * del TED resultara anterior a `created_at` (caso anómalo). En el caso normal
 * `fecha_emision <= created_at`, GREATEST conserva el fallback — correcto.
 */

import type { Logger } from '@booster-ai/logger';
import type { IngestResult } from '@booster-ai/transport-documents';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DocumentStore } from './process-document-uploaded.js';

type DecodedResult = Extract<IngestResult, { status: 'decodificado' }>;

export function createDrizzleDocumentStore(opts: {
  db: NodePgDatabase;
  logger: Logger;
}): DocumentStore {
  const { db, logger } = opts;
  return {
    async claimForProcessing(documentId: string): Promise<boolean> {
      // rls-allowlist: worker server-side sin tenant (consume document.uploaded);
      // la fila se identifica por su id (uuid), autz N/A — el endpoint de 4a ya
      // validó tenancy al subir. El claim es condicional por estado (idempotencia).
      const result = await db.execute<{ id: string }>(sql`
        UPDATE documentos_transporte
        SET extraction_status = 'procesando', actualizado_en = now()
        WHERE id = ${documentId}
          AND extraction_status IN ('pendiente', 'fallido')
        RETURNING id
      `);
      return result.rows.length > 0;
    },

    async loadCreatedAt(documentId: string): Promise<Date | null> {
      // rls-allowlist: worker server-side sin tenant; lookup por id (uuid).
      const result = await db.execute<{ creado_en: Date }>(sql`
        SELECT creado_en FROM documentos_transporte WHERE id = ${documentId} LIMIT 1
      `);
      const row = result.rows[0];
      return row ? new Date(row.creado_en) : null;
    },

    async persistDecoded(documentId: string, decoded: DecodedResult): Promise<void> {
      const { fields, tedRaw, retentionUntil } = decoded;
      // NUNCA acortar la retención ya fijada (invariante O-3 / C-7 §4). El
      // valor nuevo (`retentionUntil`) es `fecha_emision + 6a` cuando el TED
      // trae fecha, o el fallback `created_at + 6a` cuando no. Usamos GREATEST
      // entre el valor ya persistido (que pudo fijarlo 4a como fallback) y el
      // nuevo: el plazo solo puede MANTENERSE o EXTENDERSE, jamás reducirse.
      // COALESCE cubre el caso `retention_until` NULL (lo fija al valor nuevo).
      // Cast a ::date porque la columna es `date` y el bind param es text.
      // rls-allowlist: worker server-side sin tenant; UPDATE por id (uuid). La
      // tenancy la fijó 4a al subir; documentos_transporte es hija de viajes.
      await db.execute(sql`
        UPDATE documentos_transporte
        SET
          extraction_status = 'decodificado',
          doc_type = ${fields.docType},
          folio = ${fields.folio},
          rut_emisor = ${fields.rutEmisor},
          rut_receptor = ${fields.rutReceptor},
          razon_social_receptor = ${fields.razonSocialReceptor},
          fecha_emision = ${fields.fechaEmision},
          monto_total = ${fields.montoTotal},
          ted_raw = ${tedRaw},
          retention_until = GREATEST(
            COALESCE(retention_until, ${retentionUntil}::date),
            ${retentionUntil}::date
          ),
          actualizado_en = now()
        WHERE id = ${documentId}
      `);
      logger.info(
        {
          documentId,
          docType: fields.docType,
          needsRetentionReview: decoded.needsRetentionReview,
        },
        'transport-document decodificado (TED extraído y persistido)',
      );
    },

    async markFailed(documentId: string, reason: string): Promise<void> {
      // rls-allowlist: worker server-side sin tenant; UPDATE por id (uuid).
      await db.execute(sql`
        UPDATE documentos_transporte
        SET extraction_status = 'fallido', actualizado_en = now()
        WHERE id = ${documentId}
      `);
      logger.warn(
        { documentId, reason },
        'transport-document fallido (TED no decodificado; documento conservado, cierre no bloqueado)',
      );
    },
  };
}
