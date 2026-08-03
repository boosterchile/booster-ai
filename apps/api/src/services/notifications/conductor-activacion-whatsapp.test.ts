import { describe, expect, it, vi } from 'vitest';
import { enviarWhatsAppActivacionConductor } from './conductor-activacion-whatsapp.js';

/**
 * WhatsApp es el canal PRINCIPAL hacia el conductor.
 *
 * Decisión del PO (2026-08-03): «los conductores muchas veces no usan correos
 * electrónicos pero sí whatsapp». A diferencia del correo, acá la
 * infraestructura ya existe: Twilio y cuatro plantillas aprobadas y montadas
 * en producción.
 *
 * v2 (opción A, PO 2026-08-03): el PIN NO viaja por WhatsApp — Meta rechazó el
 * template v1 por llevar un OTP fuera de la categoría Authentication (que es de
 * formato fijo). El PIN va por correo y por la pantalla de alta; esta función
 * ni siquiera lo recibe, que es la garantía más fuerte de que no se filtra.
 */

const noop = (): void => undefined;
function makeLogger() {
  const l = {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => l,
  };
  return l;
}

interface ParamsEnviados {
  to: string;
  contentSid: string;
  contentVariables: Record<string, string>;
}

function makeClient(impl?: () => Promise<unknown>) {
  const sendContent = vi.fn(impl ?? (async () => ({ sid: 'SM1', status: 'queued' })));
  return { client: { sendContent } as never, sendContent };
}

/** Los params del único envío. Falla el test si no hubo ninguno. */
function unicoEnvio(sendContent: ReturnType<typeof vi.fn>): ParamsEnviados {
  const call = sendContent.mock.calls[0];
  if (!call) {
    throw new Error('no se llamó a sendContent');
  }
  return call[0] as ParamsEnviados;
}

const BASE = {
  telefono: '+56957790379',
  nombre: 'Javier Poblete',
  rut: '5864136-7',
  empresa: 'Transportes Van Oosterwyk',
};

describe('enviarWhatsAppActivacionConductor', () => {
  it('manda la plantilla v2 con las 3 variables en el orden del Content Editor', async () => {
    const { client, sendContent } = makeClient();
    await enviarWhatsAppActivacionConductor({
      client,
      contentSid: 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      logger: makeLogger() as never,
      ...BASE,
    });

    expect(sendContent).toHaveBeenCalledTimes(1);
    const params = unicoEnvio(sendContent);
    expect(params.to).toBe('+56957790379');
    expect(params.contentSid).toBe('HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    // El orden es contrato con la plantilla cargada en Twilio: cambiarlo acá
    // sin cambiarla allá rompe el botón (el {{3}} es el RUT dentro de la URL).
    // Sin PIN a propósito: Meta lo rechaza fuera de Authentication.
    expect(params.contentVariables).toEqual({
      '1': 'Javier Poblete',
      '2': 'Transportes Van Oosterwyk',
      '3': '5864136-7',
    });
  });

  it('sin contentSid no intenta nada — la plantilla todavía no está aprobada', async () => {
    const { client, sendContent } = makeClient();
    const logger = makeLogger();
    await enviarWhatsAppActivacionConductor({
      client,
      contentSid: undefined,
      logger: logger as never,
      ...BASE,
    });
    expect(sendContent).not.toHaveBeenCalled();
    // Silencioso pero no invisible: hay que poder saber por qué no salió.
    expect(logger.warn).toHaveBeenCalled();
  });

  it('sin cliente Twilio tampoco', async () => {
    const logger = makeLogger();
    await enviarWhatsAppActivacionConductor({
      client: undefined,
      contentSid: 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      logger: logger as never,
      ...BASE,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('sin teléfono no intenta y lo deja registrado', async () => {
    const { client, sendContent } = makeClient();
    const logger = makeLogger();
    await enviarWhatsAppActivacionConductor({
      client,
      contentSid: 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      logger: logger as never,
      ...BASE,
      telefono: null,
    });
    expect(sendContent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('un fallo de Twilio NO propaga — el alta ya ocurrió', async () => {
    const { client } = makeClient(async () => {
      throw new Error('Twilio 500');
    });
    const logger = makeLogger();
    await expect(
      enviarWhatsAppActivacionConductor({
        client,
        contentSid: 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        logger: logger as never,
        ...BASE,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  // El test «el PIN nunca se loguea» se retiró con la v2: la garantía subió de
  // nivel — la función ya no RECIBE el PIN (no está en la firma), así que no
  // hay valor que pudiera filtrarse a un log ni a las variables del template.

  it('el teléfono tampoco se loguea en claro', async () => {
    const { client } = makeClient(async () => {
      throw new Error('boom');
    });
    const logger = makeLogger();
    await enviarWhatsAppActivacionConductor({
      client,
      contentSid: 'HXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      logger: logger as never,
      ...BASE,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('+56957790379');
  });
});
