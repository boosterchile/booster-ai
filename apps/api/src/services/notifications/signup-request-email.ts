import type { Logger } from '@booster-ai/logger';

/**
 * T10 SEC-001 Sprint 2b — Notifier para el flow signup-request → admin
 * approval (`sec-001-cierre` §3 H1.2 SC-1.2.1). Spec requiere:
 *
 *   - On signup-request submit → email a `BOOSTER_PLATFORM_ADMIN_EMAILS`
 *     con link al admin page.
 *   - On approve → email a user con login link.
 *
 * **Realidad del repo a 2026-05-26**: NO existe email infra integrada
 * (no SendGrid / SES / nodemailer / etc en `apps/api`). Twilio cubre
 * SMS + WhatsApp; web-push cubre PWA notifications; correo es gap.
 *
 * **Decisión T10**: este archivo expone una interfaz `SignupRequestNotifier`
 * + implementación `LoggingSignupRequestNotifier` que escribe structured
 * logs en lugar de enviar email real. Cuando un futuro spec agregue email
 * infra (SendGrid o equivalente), el caller no cambia — se inyecta una
 * implementación distinta. El contract se mantiene.
 *
 * Riesgo aceptado: post-Sprint-2b ship, los admins NO recibirán email
 * automático cuando llegue una signup-request. Mitigation operacional:
 * (a) admin UI muestra dashboard con count de pending; (b) admin entra
 * periódicamente a `/app/platform-admin/signup-requests`; (c) structured
 * log `signup-request.notify.admin` permite alerta Cloud Monitoring si
 * pendings crecen unhandled > N días. Tracked en
 * `.specs/_followups/email-infra-integration.md` cuando se cree.
 */

export interface SignupRequestNotifier {
  /** Envía notif a admins de que llegó una nueva solicitud (pending approval). */
  notifyAdminsOfNewRequest(opts: {
    requestId: string;
    requesterEmailHashed: string;
    adminEmails: readonly string[];
    correlationId: string;
  }): Promise<void>;

  /** Envía notif al user de que su solicitud fue aprobada (login link). */
  notifyUserOfApproval(opts: {
    requestId: string;
    userEmail: string;
    loginLinkUrl: string;
    correlationId: string;
  }): Promise<void>;

  /** Envía notif al user de que su solicitud fue rechazada (opcional reason). */
  notifyUserOfRejection(opts: {
    requestId: string;
    userEmail: string;
    reason?: string;
    correlationId: string;
  }): Promise<void>;
}

/**
 * Implementación stub que loguea structured eventos en lugar de enviar email.
 * Reemplazable cuando email infra real se integre (futuro spec).
 */
export class LoggingSignupRequestNotifier implements SignupRequestNotifier {
  constructor(private readonly logger: Logger) {}

  async notifyAdminsOfNewRequest(opts: {
    requestId: string;
    requesterEmailHashed: string;
    adminEmails: readonly string[];
    correlationId: string;
  }): Promise<void> {
    this.logger.info(
      {
        event: 'signup-request.notify.admin',
        correlationId: opts.correlationId,
        requestId: opts.requestId,
        requesterEmailHashed: opts.requesterEmailHashed,
        recipients: opts.adminEmails.length,
      },
      'signup-request: notify admins of new pending request (logging stub — real email infra pending)',
    );
  }

  async notifyUserOfApproval(opts: {
    requestId: string;
    userEmail: string;
    loginLinkUrl: string;
    correlationId: string;
  }): Promise<void> {
    this.logger.info(
      {
        event: 'signup-request.notify.user.approved',
        correlationId: opts.correlationId,
        requestId: opts.requestId,
        userEmail: opts.userEmail,
        loginLinkUrl: opts.loginLinkUrl,
      },
      'signup-request: notify user of approval (logging stub — real email infra pending)',
    );
  }

  async notifyUserOfRejection(opts: {
    requestId: string;
    userEmail: string;
    reason?: string;
    correlationId: string;
  }): Promise<void> {
    this.logger.info(
      {
        event: 'signup-request.notify.user.rejected',
        correlationId: opts.correlationId,
        requestId: opts.requestId,
        userEmail: opts.userEmail,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      'signup-request: notify user of rejection (logging stub — real email infra pending)',
    );
  }
}
