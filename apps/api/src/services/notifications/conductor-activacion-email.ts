import type { Logger } from '@booster-ai/logger';
import type { EmailSender } from './email-sender.js';

/**
 * El correo de activación que el conductor recibe al ser dado de alta.
 *
 * **Por qué existe.** El alta devolvía el PIN sólo en la respuesta de la API,
 * o sea a la empresa, y de ahí dependía de que alguien se lo dictara al
 * conductor por WhatsApp. En producción (2026-08-03) el conductor Javier
 * Poblete quedó dado de alta y sin ninguna forma de enterarse: entró a la app,
 * rebotó, y nunca recibió nada. El PO lo había fijado desde el diseño: «debe
 * tener asociado un mail que permita la comunicación con la plataforma».
 *
 * **Nunca lanza.** Cuando esto corre, el conductor YA está creado y el PIN YA
 * existe. Un proveedor de correo caído no puede voltear un alta consumada; el
 * fallo se registra para que la empresa pueda dictar el PIN a mano.
 */
export async function enviarCorreoActivacionConductor(opts: {
  sender: EmailSender;
  logger: Logger;
  email: string;
  nombre: string;
  rut: string;
  /** PIN en claro. NUNCA debe entrar a un log. */
  pin: string;
  empresa: string;
  webAppUrl: string;
}): Promise<void> {
  const { sender, logger, email, nombre, rut, pin, empresa, webAppUrl } = opts;

  // El RUT viaja en el link para que no tenga que tipearlo en el celular.
  const enlace = `${webAppUrl.replace(/\/$/, '')}/login/conductor?rut=${encodeURIComponent(rut)}`;

  const text = [
    `Hola ${nombre},`,
    '',
    `${empresa} te dio de alta como conductor en Booster.`,
    '',
    'Para entrar por primera vez, activa tu cuenta acá:',
    enlace,
    '',
    `Tu RUT: ${rut}`,
    `Tu PIN de activación: ${pin}`,
    '',
    'El PIN sirve una sola vez. Al usarlo vas a crear tu propia clave de 6',
    'dígitos, que solo sabes tú: ni tu empresa ni Booster pueden verla. De ahí',
    'en adelante entras siempre con tu RUT y esa clave.',
    '',
    'Si no reconoces a esta empresa, ignora este correo y avísanos a',
    'soporte@boosterchile.com.',
    '',
    'Booster',
  ].join('\n');

  const html = [
    `<p>Hola ${nombre},</p>`,
    `<p><strong>${empresa}</strong> te dio de alta como conductor en Booster.</p>`,
    `<p><a href="${enlace}">Activa tu cuenta acá</a></p>`,
    `<p>Tu RUT: <strong>${rut}</strong><br>Tu PIN de activación: <strong>${pin}</strong></p>`,
    '<p>El PIN sirve una sola vez. Al usarlo vas a crear <strong>tu propia clave</strong> de 6 dígitos, que solo sabes tú: ni tu empresa ni Booster pueden verla. De ahí en adelante entras siempre con tu RUT y esa clave.</p>',
    '<p>Si no reconoces a esta empresa, ignora este correo y avísanos a soporte@boosterchile.com.</p>',
    '<p>Booster</p>',
  ].join('');

  try {
    const r = await sender.send({
      to: email,
      subject: 'Activa tu cuenta de conductor en Booster',
      text,
      html,
    });
    if (!r.enviado) {
      // Sin el PIN en el log: iría a parar a Cloud Logging.
      logger.warn(
        { rut, empresa, motivo: r.motivo },
        'correo de activación del conductor no salió — la empresa deberá entregar el PIN a mano',
      );
    }
  } catch (err) {
    logger.error(
      { rut, empresa, error: err instanceof Error ? err.name : 'desconocido' },
      'fallo inesperado enviando el correo de activación del conductor',
    );
  }
}
