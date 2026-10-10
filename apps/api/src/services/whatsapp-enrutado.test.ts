import type { Logger } from '@booster-ai/logger';
import { notificationEventSchema } from '@booster-ai/shared-schemas';
import { hashTwilioContentForm } from '@booster-ai/whatsapp-client';
import { describe, expect, it, vi } from 'vitest';

const publishMessage = vi.fn();
const topic = vi.fn(() => ({ publishMessage }));
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: vi.fn(function PubSubMock() {
    return { topic };
  }),
}));

const { crearEnrutadorWhatsApp, crearPublicadorEventosNotificacion, modoNotificaciones } =
  await import('./whatsapp-enrutado.js');

const noop = (): void => undefined;
function makeLogger() {
  return {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => makeLogger(),
  };
}

const FROM = '+19383365293';
const params = {
  to: '+56957790379',
  contentSid: 'HX00000000000000000000000000000001',
  contentVariables: { '1': 'BOO-1', '2': 'Santiago → Concepción' },
};
const ID = '00000000-0000-4000-8000-000000000001';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

function deps() {
  const log = makeLogger();
  return {
    directo: { sendContent: vi.fn().mockResolvedValue({ sid: 'SM123' }) },
    publicar: vi.fn().mockResolvedValue('msg-1'),
    logger: log as never as Logger,
    log,
  };
}

describe('modoNotificaciones', () => {
  it('microservicio gana sobre sombra; ambos off es directo', () => {
    expect(modoNotificaciones({ viaMicroservicio: false, sombra: false })).toBe('directo');
    expect(modoNotificaciones({ viaMicroservicio: false, sombra: true })).toBe('sombra');
    expect(modoNotificaciones({ viaMicroservicio: true, sombra: true })).toBe('microservicio');
    expect(modoNotificaciones({ viaMicroservicio: true, sombra: false })).toBe('microservicio');
  });
});

describe('crearEnrutadorWhatsApp', () => {
  it('directo: devuelve el cliente Twilio tal cual (o null si no hay)', () => {
    const d = deps();
    const r = crearEnrutadorWhatsApp({ modo: 'directo', fromNumber: FROM, ...d });
    expect(r).toBe(d.directo);
    expect(
      crearEnrutadorWhatsApp({ modo: 'directo', fromNumber: FROM, ...d, directo: null }),
    ).toBeNull();
  });

  it('sombra: envía directo y publica el evento sombra con el hash del request', async () => {
    const d = deps();
    const r = crearEnrutadorWhatsApp({
      modo: 'sombra',
      fromNumber: FROM,
      ahora: () => AHORA,
      nuevoId: () => ID,
      ...d,
    });

    const res = await r?.sendContent(params);

    expect(res).toEqual({ sid: 'SM123' });
    expect(d.directo.sendContent).toHaveBeenCalledWith(params);
    const evento = d.publicar.mock.calls[0]?.[0];
    expect(notificationEventSchema.parse(evento)).toEqual({
      version: 1,
      idempotencyKey: ID,
      canal: 'whatsapp_template',
      modo: 'sombra',
      destinatario: params.to,
      contentSid: params.contentSid,
      variables: params.contentVariables,
      hashEsperado: hashTwilioContentForm({ fromNumber: FROM, ...params }),
      emitidoEn: AHORA.toISOString(),
    });
  });

  it('sombra: si la publicación falla, el envío real igual se informa como exitoso', async () => {
    const d = deps();
    d.publicar.mockRejectedValueOnce(new Error('pubsub caído'));
    const r = crearEnrutadorWhatsApp({ modo: 'sombra', fromNumber: FROM, ...d });

    await expect(r?.sendContent(params)).resolves.toEqual({ sid: 'SM123' });
    expect(d.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: params.contentSid }),
      expect.stringContaining('sombra'),
    );
  });

  it('sombra: si el envío directo falla, no publica y propaga el error', async () => {
    const d = deps();
    d.directo.sendContent.mockRejectedValueOnce(new Error('twilio 500'));
    const r = crearEnrutadorWhatsApp({ modo: 'sombra', fromNumber: FROM, ...d });

    await expect(r?.sendContent(params)).rejects.toThrow('twilio 500');
    expect(d.publicar).not.toHaveBeenCalled();
  });

  it('sombra sin directo no tiene nada que comparar: null', () => {
    const d = deps();
    expect(
      crearEnrutadorWhatsApp({ modo: 'sombra', fromNumber: FROM, ...d, directo: null }),
    ).toBeNull();
  });

  it('sombra sin publicador o sin sender: degrada a directo con warn', () => {
    const d = deps();
    expect(crearEnrutadorWhatsApp({ modo: 'sombra', fromNumber: FROM, ...d, publicar: null })).toBe(
      d.directo,
    );
    expect(crearEnrutadorWhatsApp({ modo: 'sombra', fromNumber: null, ...d })).toBe(d.directo);
    expect(d.log.warn).toHaveBeenCalledTimes(2);
  });

  it('microservicio: publica modo enviar, no toca Twilio y devuelve sid pubsub', async () => {
    const d = deps();
    const r = crearEnrutadorWhatsApp({
      modo: 'microservicio',
      fromNumber: null,
      ahora: () => AHORA,
      nuevoId: () => ID,
      ...d,
    });

    const res = await r?.sendContent({ to: params.to, contentSid: params.contentSid });

    expect(res).toEqual({ sid: 'pubsub:msg-1' });
    expect(d.directo.sendContent).not.toHaveBeenCalled();
    expect(d.publicar).toHaveBeenCalledWith({
      version: 1,
      idempotencyKey: ID,
      canal: 'whatsapp_template',
      modo: 'enviar',
      destinatario: params.to,
      contentSid: params.contentSid,
      variables: {},
      emitidoEn: AHORA.toISOString(),
    });
  });

  it('microservicio: un fallo de publicación se propaga como un fallo de envío', async () => {
    const d = deps();
    d.publicar.mockRejectedValueOnce(new Error('pubsub caído'));
    const r = crearEnrutadorWhatsApp({ modo: 'microservicio', fromNumber: null, ...d });
    await expect(r?.sendContent(params)).rejects.toThrow('pubsub caído');
  });

  it('microservicio sin publicador: null (no hay por dónde enviar)', () => {
    const d = deps();
    expect(
      crearEnrutadorWhatsApp({ modo: 'microservicio', fromNumber: null, ...d, publicar: null }),
    ).toBeNull();
    expect(d.log.error).toHaveBeenCalled();
  });

  it('ids y fecha por defecto: uuid v4 e ISO actual', async () => {
    const d = deps();
    const r = crearEnrutadorWhatsApp({ modo: 'microservicio', fromNumber: null, ...d });
    await r?.sendContent(params);
    const evento = notificationEventSchema.parse(d.publicar.mock.calls[0]?.[0]);
    expect(evento.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.now() - Date.parse(evento.emitidoEn)).toBeLessThan(5_000);
  });
});

describe('crearPublicadorEventosNotificacion', () => {
  it('publica el JSON en el topic y devuelve el messageId', async () => {
    publishMessage.mockResolvedValueOnce('msg-9');
    const publicar = crearPublicadorEventosNotificacion('notification-events');
    const evento = {
      version: 1 as const,
      idempotencyKey: ID,
      canal: 'whatsapp_template' as const,
      modo: 'enviar' as const,
      destinatario: params.to,
      contentSid: params.contentSid,
      variables: {},
      emitidoEn: AHORA.toISOString(),
    };
    await expect(publicar(evento)).resolves.toBe('msg-9');
    expect(topic).toHaveBeenCalledWith('notification-events');
    const arg = publishMessage.mock.calls[0]?.[0] as { data: Buffer };
    expect(JSON.parse(arg.data.toString('utf-8'))).toEqual(evento);
  });
});
