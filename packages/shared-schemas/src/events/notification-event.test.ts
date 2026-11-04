import { describe, expect, it } from 'vitest';
import { notificationEventSchema } from './notification-event.js';

const base = {
  version: 1,
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  canal: 'whatsapp_template',
  modo: 'enviar',
  destinatario: '+56957790379',
  contentSid: 'HX00000000000000000000000000000001',
  variables: { '1': 'BOO-1' },
  emitidoEn: '2026-10-08T12:00:00.000Z',
} as const;

describe('notificationEventSchema', () => {
  it('acepta un envío real sin hashEsperado', () => {
    expect(notificationEventSchema.parse(base)).toEqual(base);
  });

  it('acepta destinatario con prefijo whatsapp:', () => {
    expect(
      notificationEventSchema.safeParse({ ...base, destinatario: 'whatsapp:+56957790379' }).success,
    ).toBe(true);
  });

  it('modo sombra exige hashEsperado sha256', () => {
    expect(notificationEventSchema.safeParse({ ...base, modo: 'sombra' }).success).toBe(false);
    expect(
      notificationEventSchema.safeParse({ ...base, modo: 'sombra', hashEsperado: 'abc' }).success,
    ).toBe(false);
    expect(
      notificationEventSchema.safeParse({ ...base, modo: 'sombra', hashEsperado: 'a'.repeat(64) })
        .success,
    ).toBe(true);
  });

  it('rechaza destinatario no E.164, contentSid inválido y versión desconocida', () => {
    expect(notificationEventSchema.safeParse({ ...base, destinatario: '957790379' }).success).toBe(
      false,
    );
    expect(notificationEventSchema.safeParse({ ...base, contentSid: 'XX1' }).success).toBe(false);
    expect(notificationEventSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
  });
});
