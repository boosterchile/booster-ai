import type { Logger } from '@booster-ai/logger';
import type { TipoInvitacionCorreoCuenta } from '@booster-ai/shared-schemas';
import type { EmailSender } from './email-sender.js';
import { escaparHtml } from './escapar-html.js';

/**
 * Correo de invitación a `/crear-cuenta` (ADR-093). From canónico vía
 * `EmailSender` / `EMAIL_FROM` (`Booster <contacto@boosterchile.com>`).
 * El token solo viaja en la URL; nunca en logs.
 */

function copyPorTipo(tipo: TipoInvitacionCorreoCuenta): {
  subject: string;
  intro: string;
  postLogin: string;
} {
  if (tipo === 'stakeholder') {
    return {
      subject: 'Crea tu cuenta de stakeholder en Booster',
      intro: 'Booster te invitó a crear tu cuenta de stakeholder.',
      postLogin: 'De ahí en adelante entras con el tipo «Stakeholder», tu correo y esa clave.',
    };
  }
  return {
    subject: 'Crea tu cuenta del personal de Booster',
    intro: 'Booster te invitó a crear tu cuenta del personal de la plataforma.',
    postLogin: 'De ahí en adelante entras con el tipo «Booster», tu correo y esa clave.',
  };
}

export async function enviarCorreoInvitacionCrearCuenta(opts: {
  sender: EmailSender;
  logger: Logger;
  invitacionId: string;
  email: string;
  tipo: TipoInvitacionCorreoCuenta;
  /** Token en claro. NUNCA debe entrar a un log. */
  token: string;
  webAppUrl: string;
  expiraEn: Date;
}): Promise<void> {
  const { sender, logger, invitacionId, email, tipo, token, webAppUrl, expiraEn } = opts;
  const base = webAppUrl.replace(/\/$/, '');
  const enlace = `${base}/crear-cuenta?token=${encodeURIComponent(token)}`;
  const login = `${base}/login?tipo=${tipo === 'stakeholder' ? 'stakeholder' : 'booster'}`;
  const { subject, intro, postLogin } = copyPorTipo(tipo);
  const vence = expiraEn.toISOString();

  const text = [
    'Hola,',
    '',
    intro,
    '',
    'Para crear tu cuenta, abre este enlace y consigna tus datos y tu clave:',
    enlace,
    '',
    `El enlace sirve una sola vez y vence el ${vence}.`,
    'La clave la eliges tú: nadie en Booster la conoce.',
    postLogin,
    `Login: ${login}`,
    '',
    'Si no esperabas este correo, ignóralo y avísanos a soporte@boosterchile.com.',
    '',
    'Booster',
  ].join('\n');

  const html = [
    '<p>Hola,</p>',
    `<p>${escaparHtml(intro)}</p>`,
    `<p><a href="${escaparHtml(enlace)}">Crea tu cuenta aquí</a></p>`,
    `<p>El enlace sirve una sola vez y vence el <strong>${escaparHtml(vence)}</strong>.</p>`,
    '<p>La clave la eliges tú: nadie en Booster la conoce.</p>',
    `<p>${escaparHtml(postLogin)}</p>`,
    `<p>Login: <a href="${escaparHtml(login)}">${escaparHtml(login)}</a></p>`,
    '<p>Si no esperabas este correo, ignóralo y avísanos a soporte@boosterchile.com.</p>',
    '<p>Booster</p>',
  ].join('');

  try {
    const r = await sender.send({ to: email, subject, text, html });
    if (!r.enviado) {
      logger.warn(
        { invitacionId, tipo, motivo: r.motivo },
        'correo de invitación crear-cuenta no salió — reenvía desde el panel',
      );
    }
  } catch (err) {
    logger.error(
      {
        invitacionId,
        tipo,
        error: err instanceof Error ? err.name : 'desconocido',
      },
      'fallo inesperado enviando correo de invitación crear-cuenta',
    );
  }
}
