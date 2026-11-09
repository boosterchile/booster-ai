/**
 * Envía por correo el enlace público de seguimiento cuando se acepta una
 * oferta (spec `seguimiento-por-correo`).
 *
 * Destinatarios: el generador (`usuarios.email` de `viajes.creado_por_id`) y,
 * si lo consignó, el destinatario (`viajes.destinatario_email`). Un mismo
 * correo (sin distinguir mayúsculas) recibe uno solo. Los correos sintéticos
 * de dominio `.invalid` no son buzones reales y se descartan.
 *
 * Idempotencia propia (`asignaciones.tracking_link_email_enviado_en`),
 * independiente del WhatsApp: si un canal está caído, el otro sale igual. La
 * marca se toma con un UPDATE condicional antes de enviar, así dos despachos
 * concurrentes no duplican; si ningún correo sale, se libera para un reintento.
 *
 * Llamado fire-and-forget desde `offer-actions.ts` después de la transacción.
 * El `EmailSender` nunca lanza; los errores de BD sí, y el llamador los loguea.
 */
import type { Logger } from '@booster-ai/logger';
import { regionLabel } from '@booster-ai/notification-fan-out';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, empresas, trips, users, vehicles } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import type { EmailMessage, EmailSender } from './notifications/email-sender.js';

export interface NotifyTrackingLinkEmailDeps {
  db: Db;
  logger: Logger;
  emailSender: EmailSender;
  /** Base pública de la app (`WEB_APP_URL`). */
  webAppUrl: string;
}

export type NotifyTrackingLinkEmailResult =
  | { assignmentId: string; skipped: false; enviados: number }
  | {
      assignmentId: string;
      skipped: true;
      reason: 'assignment_not_found' | 'no_token' | 'no_email' | 'already_notified' | 'send_failed';
    };

/** Un correo usable: no vacío y no de un dominio reservado `.invalid`. */
function correoUsable(valor: string | null): string | null {
  const limpio = valor?.trim() ?? '';
  if (limpio.length === 0 || limpio.toLowerCase().endsWith('.invalid')) {
    return null;
  }
  return limpio;
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function armarCorreo(datos: {
  to: string;
  trackingCode: string;
  origen: string;
  destino: string;
  transportista: string | null;
  patente: string | null;
  url: string;
}): EmailMessage {
  const lineaTransporte = datos.transportista
    ? `Transporta: ${datos.transportista}${datos.patente ? ` (patente ${datos.patente})` : ''}.`
    : null;
  const text = [
    `Tu carga ${datos.trackingCode} ya tiene transportista.`,
    `Ruta: ${datos.origen} → ${datos.destino}.`,
    ...(lineaTransporte ? [lineaTransporte] : []),
    '',
    `Sigue la carga en vivo: ${datos.url}`,
    '',
    'Booster',
  ].join('\n');
  const html = [
    `<p>Tu carga <strong>${escaparHtml(datos.trackingCode)}</strong> ya tiene transportista.</p>`,
    `<p>Ruta: ${escaparHtml(datos.origen)} → ${escaparHtml(datos.destino)}.</p>`,
    ...(lineaTransporte ? [`<p>${escaparHtml(lineaTransporte)}</p>`] : []),
    `<p><a href="${escaparHtml(datos.url)}">Ver el seguimiento en vivo</a></p>`,
    '<p>Booster</p>',
  ].join('\n');
  return { to: datos.to, subject: `Seguimiento de tu carga ${datos.trackingCode}`, text, html };
}

/**
 * Span `notificaciones.tracking_correo` y contador de negocio por resultado
 * (`sent` o el motivo del skip). Sin clave de Resend, todo termina en
 * `send_failed`: la métrica lo hace visible.
 */
export async function notifyTrackingLinkEmailAtAssignment(
  deps: NotifyTrackingLinkEmailDeps,
  opts: { assignmentId: string },
): Promise<NotifyTrackingLinkEmailResult> {
  return await withBusinessSpan(
    {
      name: 'notificaciones.tracking_correo',
      attributes: { 'booster.assignment_id': opts.assignmentId },
    },
    async (span) => {
      const resultado = await enviarCorreoTracking(deps, opts);
      const outcome = resultado.skipped ? resultado.reason : 'sent';
      setResultAttributes(span, {
        'booster.outcome': outcome,
        'booster.tracking_correo.enviados': resultado.skipped ? 0 : resultado.enviados,
      });
      getBusinessCounter('notificaciones_tracking_correo').add(1, { outcome });
      return resultado;
    },
  );
}

async function enviarCorreoTracking(
  deps: NotifyTrackingLinkEmailDeps,
  opts: { assignmentId: string },
): Promise<NotifyTrackingLinkEmailResult> {
  const { db, logger, emailSender, webAppUrl } = deps;
  const { assignmentId } = opts;

  const rows = await db
    .select({
      assignmentId: assignments.id,
      publicToken: assignments.publicTrackingToken,
      trackingCode: trips.trackingCode,
      originRegion: trips.originRegionCode,
      destRegion: trips.destinationRegionCode,
      consigneeEmail: trips.consigneeEmail,
      shipperEmail: users.email,
      carrierName: empresas.legalName,
      vehiclePlate: vehicles.plate,
    })
    // rls-allowlist: notificador server-side; destinatarios derivados del assignmentId recién creado por acceptOffer.
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .leftJoin(users, eq(users.id, trips.createdByUserId))
    .leftJoin(empresas, eq(empresas.id, assignments.empresaId))
    .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    logger.warn({ assignmentId }, 'tracking por correo: asignación no encontrada');
    return { assignmentId, skipped: true, reason: 'assignment_not_found' };
  }
  if (!row.publicToken) {
    logger.info({ assignmentId }, 'tracking por correo: asignación sin token público');
    return { assignmentId, skipped: true, reason: 'no_token' };
  }

  const destinatarios: string[] = [];
  for (const candidato of [correoUsable(row.shipperEmail), correoUsable(row.consigneeEmail)]) {
    if (candidato && !destinatarios.some((d) => d.toLowerCase() === candidato.toLowerCase())) {
      destinatarios.push(candidato);
    }
  }
  if (destinatarios.length === 0) {
    logger.info(
      { assignmentId },
      'tracking por correo: sin correo usable del generador ni del destinatario',
    );
    return { assignmentId, skipped: true, reason: 'no_email' };
  }

  // Marca de idempotencia tomada antes de enviar (UPDATE condicional).
  // rls-allowlist: notificador server-side; UPDATE por id de la asignación recién creada.
  const tomadas = await db
    .update(assignments)
    .set({ trackingLinkEmailSentAt: new Date() })
    .where(and(eq(assignments.id, assignmentId), isNull(assignments.trackingLinkEmailSentAt)))
    .returning({ id: assignments.id });
  if (tomadas.length === 0) {
    return { assignmentId, skipped: true, reason: 'already_notified' };
  }

  const url = `${webAppUrl.replace(/\/$/, '')}/tracking/${row.publicToken}`;
  let enviados = 0;
  for (const to of destinatarios) {
    const resultado = await emailSender.send(
      armarCorreo({
        to,
        trackingCode: row.trackingCode,
        origen: regionLabel(row.originRegion),
        destino: regionLabel(row.destRegion),
        transportista: row.carrierName,
        patente: row.vehiclePlate,
        url,
      }),
    );
    if (resultado.enviado) {
      enviados += 1;
    } else {
      logger.warn(
        { assignmentId, motivo: resultado.motivo },
        'tracking por correo: un correo no salió',
      );
    }
  }

  if (enviados === 0) {
    // rls-allowlist: notificador server-side; libera la marca de la misma asignación.
    await db
      .update(assignments)
      .set({ trackingLinkEmailSentAt: null })
      .where(eq(assignments.id, assignmentId));
    return { assignmentId, skipped: true, reason: 'send_failed' };
  }
  logger.info(
    { assignmentId, trackingCode: row.trackingCode, enviados, destinatarios: destinatarios.length },
    'tracking por correo enviado',
  );
  return { assignmentId, skipped: false, enviados };
}
