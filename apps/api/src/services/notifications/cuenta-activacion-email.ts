import type { Logger } from '@booster-ai/logger';
import type { EmailSender } from './email-sender.js';
import { escaparHtml } from './escapar-html.js';

/** Roles que reciben un código de activación al ser invitados a una empresa. */
export type RolActivacionCuenta =
  | 'dueno'
  | 'admin'
  | 'despachador'
  | 'conductor'
  | 'visualizador'
  | 'stakeholder_sostenibilidad';

const ROL_EN_PALABRAS: Record<RolActivacionCuenta, string> = {
  dueno: 'dueña o dueño',
  admin: 'administradora o administrador',
  despachador: 'despacho',
  conductor: 'conductora o conductor',
  visualizador: 'consulta',
  stakeholder_sostenibilidad: 'sostenibilidad',
};

/**
 * El correo con el que una persona invitada a una empresa activa su cuenta.
 *
 * **Por qué existe (T10-04, ADR-082).** El alta desde el panel de
 * administración devolvía el código solo al admin, que tenía que dictárselo
 * a la persona. El 2026-09-27 se dio de alta el dueño de TransJavier y al
 * 2026-10-06 seguía sin activar. El código ahora le llega a su correo; el
 * admin lo sigue viendo como respaldo.
 *
 * **Nunca lanza.** Cuando esto corre la invitación ya existe. Un proveedor
 * caído no puede deshacerla; el fallo queda registrado sin el código.
 */
export async function enviarCorreoActivacionCuenta(opts: {
  sender: EmailSender;
  logger: Logger;
  email: string;
  nombre: string;
  rut: string;
  /** Código en claro. NUNCA debe entrar a un log. */
  codigo: string;
  empresa: string;
  rol: RolActivacionCuenta;
  webAppUrl: string;
}): Promise<void> {
  const { sender, logger, email, nombre, rut, codigo, empresa, rol, webAppUrl } = opts;
  const enlace = `${webAppUrl.replace(/\/$/, '')}/activar`;
  const rolEnPalabras = ROL_EN_PALABRAS[rol];

  const text = [
    `Hola ${nombre},`,
    '',
    `${empresa} te invitó a Booster con el rol de ${rolEnPalabras}.`,
    '',
    'Para entrar por primera vez, activa tu cuenta aquí:',
    enlace,
    '',
    `Tu RUT: ${rut}`,
    `Tu código de activación: ${codigo}`,
    '',
    'El código sirve una sola vez y vence en 7 días. Al usarlo vas a crear tu',
    'propia clave de 6 dígitos, que solo sabes tú: ni tu empresa ni Booster',
    'pueden verla. De ahí en adelante entras siempre con tu RUT y esa clave.',
    '',
    'Si no esperabas esta invitación, ignora este correo y avísanos a',
    'soporte@boosterchile.com.',
    '',
    'Booster',
  ].join('\n');

  const html = [
    `<p>Hola ${escaparHtml(nombre)},</p>`,
    `<p><strong>${escaparHtml(empresa)}</strong> te invitó a Booster con el rol de ${rolEnPalabras}.</p>`,
    `<p><a href="${escaparHtml(enlace)}">Activa tu cuenta aquí</a></p>`,
    `<p>Tu RUT: <strong>${escaparHtml(rut)}</strong><br>Tu código de activación: <strong>${escaparHtml(codigo)}</strong></p>`,
    '<p>El código sirve una sola vez y vence en 7 días. Al usarlo vas a crear <strong>tu propia clave</strong> de 6 dígitos, que solo sabes tú: ni tu empresa ni Booster pueden verla. De ahí en adelante entras siempre con tu RUT y esa clave.</p>',
    '<p>Si no esperabas esta invitación, ignora este correo y avísanos a soporte@boosterchile.com.</p>',
    '<p>Booster</p>',
  ].join('');

  try {
    const r = await sender.send({ to: email, subject: 'Activa tu cuenta en Booster', text, html });
    if (!r.enviado) {
      logger.warn(
        { rut, empresa, rol, motivo: r.motivo },
        'correo de activación de cuenta no salió — el admin deberá entregar el código a mano',
      );
    }
  } catch (err) {
    // Solo el tipo del error: el mensaje de un proveedor podría citar el cuerpo.
    logger.error(
      { rut, empresa, rol, error: err instanceof Error ? err.name : 'desconocido' },
      'fallo inesperado enviando el correo de activación de cuenta',
    );
  }
}

/**
 * El correo con el que una persona del personal de Booster activa su acceso al
 * panel de administración (`.specs/alta-personal-booster`, SC9). Hermano de
 * `enviarCorreoActivacionCuenta`: mismo remitente, texto propio, sin empresa
 * ni rol.
 *
 * Quien llama decide cuándo sale: solo si el correo ya está en la lista de
 * Terraform. Antes de eso la persona todavía no podría activar.
 *
 * **Nunca lanza.** Cuando esto corre la cuenta ya existe. Un proveedor caído
 * no puede deshacerla; el fallo queda registrado sin el código.
 */
export async function enviarCorreoActivacionPersonalBooster(opts: {
  sender: EmailSender;
  logger: Logger;
  /** Solo para trazar el envío en los logs. */
  userId: string;
  email: string;
  nombre: string;
  rut: string;
  /** Código en claro. NUNCA debe entrar a un log. */
  codigo: string;
  webAppUrl: string;
}): Promise<void> {
  const { sender, logger, userId, email, nombre, rut, codigo, webAppUrl } = opts;
  const base = webAppUrl.replace(/\/$/, '');
  const enlace = `${base}/activar`;
  const login = `${base}/login`;

  const text = [
    `Hola ${nombre},`,
    '',
    'Booster te dio acceso a su panel de administración.',
    '',
    'Para entrar por primera vez, activa tu acceso aquí:',
    enlace,
    '',
    `Tu RUT: ${rut}`,
    `Tu código de activación: ${codigo}`,
    '',
    'El código sirve una sola vez y vence en 7 días. Al usarlo vas a crear tu',
    'propia clave de 6 dígitos, que solo sabes tú: nadie en Booster puede verla.',
    `De ahí en adelante entras en ${login} con el tipo «Booster», tu RUT y esa clave.`,
    '',
    'Si no esperabas este correo, ignóralo y avísanos a soporte@boosterchile.com.',
    '',
    'Booster',
  ].join('\n');

  const html = [
    `<p>Hola ${escaparHtml(nombre)},</p>`,
    '<p>Booster te dio acceso a su panel de administración.</p>',
    `<p><a href="${escaparHtml(enlace)}">Activa tu acceso aquí</a></p>`,
    `<p>Tu RUT: <strong>${escaparHtml(rut)}</strong><br>Tu código de activación: <strong>${escaparHtml(codigo)}</strong></p>`,
    '<p>El código sirve una sola vez y vence en 7 días. Al usarlo vas a crear <strong>tu propia clave</strong> de 6 dígitos, que solo sabes tú: nadie en Booster puede verla.</p>',
    `<p>De ahí en adelante entras en <a href="${escaparHtml(login)}">${escaparHtml(login)}</a> con el tipo «Booster», tu RUT y esa clave.</p>`,
    '<p>Si no esperabas este correo, ignóralo y avísanos a soporte@boosterchile.com.</p>',
    '<p>Booster</p>',
  ].join('');

  try {
    const r = await sender.send({
      to: email,
      subject: 'Activa tu acceso al panel de Booster',
      text,
      html,
    });
    if (!r.enviado) {
      logger.warn(
        { userId, motivo: r.motivo },
        'correo de activación del personal de Booster no salió — el admin deberá entregar el código a mano',
      );
    }
  } catch (err) {
    // Solo el tipo del error: el mensaje de un proveedor podría citar el cuerpo.
    logger.error(
      { userId, error: err instanceof Error ? err.name : 'desconocido' },
      'fallo inesperado enviando el correo de activación del personal de Booster',
    );
  }
}
