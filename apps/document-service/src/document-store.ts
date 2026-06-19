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
 * Anclaje de la retención (invariante O-3 / gate C-7 §4 / decisión del PO):
 * el ancla legal cuenta desde la EMISIÓN del documento (Código Tributario
 * DL 830 Art. 17/200), no desde la subida. `persistDecoded` por tanto fija
 * `retention_until = fecha_emision + 6a` cuando el TED trae `<FE>`, y usa el
 * fallback `created_at + 6a` SOLO cuando no hay fecha. "Nunca acortar" se
 * preserva de forma quirúrgica: el plazo se recalcula al decodificar SOLO si
 * la fila aún NO estaba anclada a una `fecha_emision` válida (estaba en
 * fallback). Una retención YA anclada a una `fecha_emision` válida jamás se
 * pisa hacia abajo (ni se re-ancla hacia arriba): es idempotente.
 *
 * Discriminante: el valor PREVIO de la columna `fecha_emision`. En Postgres el
 * RHS de un `UPDATE` se evalúa contra la fila pre-update, así que el `CASE WHEN
 * fecha_emision IS NULL` lee la fecha ANTERIOR aunque la misma sentencia
 * también la escriba. `IS NULL` ⇒ fallback/sin anclar ⇒ se recalcula al nuevo
 * cálculo; `IS NOT NULL` ⇒ anclada ⇒ se preserva. (Se descartó `GREATEST`: en
 * fallback retenía de más anclando a `created_at+6a` en vez de a la emisión.)
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
      // Anclar a la EMISIÓN, sin pisar una retención ya anclada (invariante
      // O-3 / C-7 §4 / decisión del PO). `retentionUntil` es `fecha_emision+6a`
      // cuando el TED trae fecha, o el fallback `created_at+6a` cuando no.
      // El CASE recalcula `fecha_emision`/`retention_until` SOLO si la fila aún
      // NO estaba anclada (su `fecha_emision` PREVIA, leída por Postgres contra
      // la fila pre-update, es NULL). Si ya estaba anclada a una fecha válida,
      // ambas columnas se preservan: nunca se acorta ni se re-ancla (idempotente).
      // Cast a ::date porque las columnas son `date` y los binds son text.
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
          monto_total = ${fields.montoTotal},
          ted_raw = ${tedRaw},
          fecha_emision = CASE
            WHEN fecha_emision IS NULL THEN ${fields.fechaEmision}::date
            ELSE fecha_emision
          END,
          retention_until = CASE
            WHEN fecha_emision IS NULL THEN ${retentionUntil}::date
            ELSE retention_until
          END,
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
