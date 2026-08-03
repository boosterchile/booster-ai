import type { Logger } from '@booster-ai/logger';

/**
 * Envío de correo — la primera infraestructura de email de la plataforma.
 *
 * **Por qué existe.** Hasta 2026-08-03 el repo no enviaba un solo correo: el
 * `LoggingSignupRequestNotifier` escribía structured logs y su propio docstring
 * lo declaraba («NO existe email infra integrada»). El conductor Javier Poblete
 * se dio de alta en producción, quedó con su PIN pendiente y **nunca recibió
 * nada** — no había forma de que la plataforma le hablara.
 *
 * La interfaz `EmailSender` aísla al proveedor: los call-sites no saben que
 * detrás hay Resend.
 *
 * **Nunca lanza.** Quien manda un correo acá está cerrando una operación de
 * negocio (dar de alta un conductor, aprobar un cliente). Si un proveedor caído
 * volteara esa operación, dejaríamos registros a medio crear por un problema
 * ajeno. Devuelve `{ enviado: false, motivo }` y **loguea**: un `catch` que
 * traga en silencio sería peor que el fallo.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Texto plano — es el que leen los clientes de correo del celular. */
  text: string;
  html?: string;
}

export type EmailSendResult =
  | { enviado: true; id: string }
  | { enviado: false; motivo: 'sin_proveedor' | 'error_proveedor' | 'error_red' };

export interface EmailSender {
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Implementación de reemplazo cuando no hay `RESEND_API_KEY`: registra el
 * correo que HABRÍA salido y sigue.
 *
 * Loguea a nivel `warn`, no `info`, a propósito: un correo que no sale es una
 * degradación silenciosa: el PO podría creer que sus conductores fueron
 * notificados cuando no lo fueron.
 *
 * **El cuerpo nunca se loguea** — lleva el PIN de activación, y un structured
 * log termina en Cloud Logging al alcance de cualquiera con read en el
 * proyecto. Destinatario y asunto sí: son los que permiten diagnosticar.
 */
export class LoggingEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.logger.warn(
      { to: msg.to, subject: msg.subject },
      'correo NO enviado: falta RESEND_API_KEY (se registra el intento)',
    );
    return { enviado: false, motivo: 'sin_proveedor' };
  }
}

/** Cliente HTTP contra la API de Resend. Sin SDK: es un POST con bearer. */
export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly logger: Logger;

  constructor(opts: { apiKey: string; from: string; logger: Logger }) {
    this.apiKey = opts.apiKey;
    this.from = opts.from;
    this.logger = opts.logger;
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
        }),
      });
    } catch (err) {
      // Sin `err` crudo en el log: podría arrastrar la request completa, con
      // el cuerpo y la Authorization adentro.
      this.logger.error(
        {
          to: msg.to,
          subject: msg.subject,
          error: err instanceof Error ? err.name : 'desconocido',
        },
        'correo NO enviado: fallo de red contra Resend',
      );
      return { enviado: false, motivo: 'error_red' };
    }

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      this.logger.error(
        { to: msg.to, subject: msg.subject, status: res.status, detalle: detalle.slice(0, 300) },
        'correo NO enviado: Resend respondió con error',
      );
      return { enviado: false, motivo: 'error_proveedor' };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    this.logger.info({ to: msg.to, subject: msg.subject, id: body.id }, 'correo enviado');
    return { enviado: true, id: body.id ?? '' };
  }
}

/**
 * Elige la implementación según haya o no credencial. Ausente ⇒ logger, y se
 * avisa fuerte al arrancar: es la diferencia entre "los correos no salen" y
 * "los correos no salen y nadie lo sabe".
 */
export function crearEmailSender(opts: {
  apiKey: string | undefined;
  from: string;
  logger: Logger;
}): EmailSender {
  if (!opts.apiKey) {
    opts.logger.warn(
      {},
      'RESEND_API_KEY ausente — los correos se registrarán en el log pero NO se enviarán',
    );
    return new LoggingEmailSender(opts.logger);
  }
  return new ResendEmailSender({ apiKey: opts.apiKey, from: opts.from, logger: opts.logger });
}
