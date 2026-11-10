import type { Logger } from '@booster-ai/logger';
import type { EmailSender } from './email-sender.js';

/**
 * Aviso a la lista de respaldo cuando el panel otorga o quita el acceso de
 * una persona (`.specs/acceso-panel-plataforma` SC5). Sale a cada correo de
 * `BOOSTER_PLATFORM_ADMIN_EMAILS`, con quién hizo el cambio y a quién. Nunca
 * lleva un código de activación.
 *
 * Solo texto plano: el nombre lo tipea un admin y así no hay HTML que escapar.
 *
 * **Nunca lanza.** Cuando esto corre el cambio ya está hecho. Un proveedor
 * caído no puede deshacerlo; cada fallo queda registrado sin el cuerpo.
 */

export type AccionAccesoPanel = 'otorgado' | 'quitado';

export interface ResultadoAvisoAccesoPanel {
  /** Correos distintos de la lista a los que se intentó avisar. */
  destinatarios: number;
  /** Cuántos aceptó el proveedor. */
  enviados: number;
}

export async function enviarAvisoAccesoPanel(opts: {
  sender: EmailSender;
  logger: Logger;
  accion: AccionAccesoPanel;
  /** La lista de respaldo. Se normaliza y se deduplica aquí. */
  destinatarios: readonly string[];
  persona: { userId: string; nombre: string; email: string };
  /** Correo del platform-admin que hizo el cambio. */
  actorEmail: string;
  webAppUrl: string;
}): Promise<ResultadoAvisoAccesoPanel> {
  const { sender, logger, accion, persona, actorEmail } = opts;
  const correos = [
    ...new Set(opts.destinatarios.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0)),
  ];
  const panel = `${opts.webAppUrl.replace(/\/$/, '')}/app/platform-admin/personal`;
  const quien = `${persona.nombre} (${persona.email})`;

  const subject =
    accion === 'otorgado'
      ? `Booster: acceso al panel otorgado a ${persona.nombre}`
      : `Booster: acceso al panel quitado a ${persona.nombre}`;
  const text = [
    'Hola,',
    '',
    accion === 'otorgado'
      ? `${actorEmail} otorgó acceso al panel de administración de Booster a ${quien}.`
      : `${actorEmail} quitó el acceso al panel de administración de Booster a ${quien}.`,
    '',
    accion === 'otorgado'
      ? `Si este cambio no corresponde, quita el acceso en ${panel}.`
      : `Si este cambio no corresponde, vuelve a dar de alta a la persona en ${panel}.`,
    '',
    'Recibes este aviso porque tu correo está en la lista de respaldo del panel.',
    '',
    'Booster',
  ].join('\n');

  let enviados = 0;
  for (const to of correos) {
    try {
      const r = await sender.send({ to, subject, text });
      if (r.enviado) {
        enviados += 1;
      } else {
        logger.warn(
          { userId: persona.userId, accion, motivo: r.motivo },
          'aviso de acceso al panel no salió a un correo de la lista de respaldo',
        );
      }
    } catch (err) {
      // Solo el tipo del error: el mensaje de un proveedor podría citar el cuerpo.
      logger.error(
        { userId: persona.userId, accion, error: err instanceof Error ? err.name : 'desconocido' },
        'fallo inesperado enviando el aviso de acceso al panel',
      );
    }
  }
  return { destinatarios: correos.length, enviados };
}
