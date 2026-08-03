import type { Logger } from '@booster-ai/logger';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';

/**
 * El mensaje de WhatsApp con el que el conductor activa su cuenta.
 *
 * **Por qué es el canal principal.** Decisión del PO (2026-08-03): «muchas
 * veces los conductores no usan correos electrónicos pero sí whatsapp». En la
 * operación de carga chilena eso es sencillamente cierto. Por eso el teléfono
 * pasó a ser obligatorio en el alta.
 *
 * A diferencia del correo —que no existía en el repo— acá la infraestructura
 * ya estaba: Twilio operativo y cuatro plantillas aprobadas y montadas en
 * producción.
 *
 * **Plantilla `activacion_conductor_v1`**, categoría *Authentication* (es un
 * código de un solo uso). Las variables son CONTRATO con lo cargado en el
 * Content Editor de Twilio — cambiar el orden acá sin cambiarlo allá manda el
 * PIN al lugar del nombre:
 *
 *   {{1}} nombre del conductor
 *   {{2}} empresa que lo dio de alta
 *   {{3}} PIN de activación
 *   {{4}} RUT — sufijo dinámico del botón
 *         `https://app.boosterchile.com/login/conductor?rut={{4}}`
 *
 * **Nunca lanza y nunca es silencioso.** Cuando esto corre el conductor ya
 * está creado: un fallo de Twilio no puede voltear un alta consumada. Pero
 * tampoco puede desaparecer — queda registrado para que la empresa sepa que
 * tiene que entregar el PIN a mano.
 */
export async function enviarWhatsAppActivacionConductor(opts: {
  /** Ausente cuando Twilio no está configurado (dev, o credenciales faltantes). */
  client: TwilioWhatsAppClient | undefined;
  /**
   * Ausente mientras Meta no apruebe la plantilla. El repo monta los
   * content-sid en dos pasos a propósito (`content_sid_ready` en Terraform):
   * un placeholder montado tumbaba el arranque del api (INC-2026-06-19).
   */
  contentSid: string | undefined;
  logger: Logger;
  telefono: string | null;
  nombre: string;
  rut: string;
  /** PIN en claro. NUNCA debe entrar a un log. */
  pin: string;
  empresa: string;
}): Promise<void> {
  const { client, contentSid, logger, telefono, nombre, rut, pin, empresa } = opts;

  // Los tres motivos de no-envío se distinguen en el log: son diagnósticos
  // distintos (falta credencial / falta aprobación de Meta / falta el dato).
  if (!client) {
    logger.warn({ rut, empresa }, 'WhatsApp de activación no enviado: Twilio no configurado');
    return;
  }
  if (!contentSid) {
    logger.warn(
      { rut, empresa },
      'WhatsApp de activación no enviado: plantilla activacion_conductor_v1 sin content-sid (¿aprobada por Meta?)',
    );
    return;
  }
  if (!telefono) {
    logger.warn(
      { rut, empresa },
      'WhatsApp de activación no enviado: el conductor no tiene teléfono registrado',
    );
    return;
  }

  try {
    await client.sendContent({
      to: telefono,
      contentSid,
      contentVariables: {
        '1': nombre,
        '2': empresa,
        '3': pin,
        '4': rut,
      },
    });
    // Sin el teléfono en claro: el logger redacta RUT pero no números.
    logger.info({ rut, empresa }, 'WhatsApp de activación enviado al conductor');
  } catch (err) {
    logger.error(
      { rut, empresa, error: err instanceof Error ? err.name : 'desconocido' },
      'WhatsApp de activación falló — la empresa deberá entregar el PIN a mano',
    );
  }
}
