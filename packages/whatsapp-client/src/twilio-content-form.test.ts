import { describe, expect, it } from 'vitest';
import { hashTwilioContentForm, twilioContentForm } from './twilio-content-form.js';

describe('twilioContentForm', () => {
  it('antepone whatsapp: a From y To y serializa las variables', () => {
    expect(
      twilioContentForm({
        fromNumber: '+19383365293',
        to: '+56957790379',
        contentSid: 'HX00000000000000000000000000000001',
        contentVariables: { '1': 'BOO-1', '2': 'Santiago → Concepción' },
      }),
    ).toEqual({
      From: 'whatsapp:+19383365293',
      To: 'whatsapp:+56957790379',
      ContentSid: 'HX00000000000000000000000000000001',
      ContentVariables: '{"1":"BOO-1","2":"Santiago → Concepción"}',
    });
  });

  it('no duplica el prefijo y omite ContentVariables vacías o ausentes', () => {
    const base = {
      fromNumber: 'whatsapp:+19383365293',
      to: 'whatsapp:+56957790379',
      contentSid: 'HX00000000000000000000000000000001',
    };
    const esperado = {
      From: 'whatsapp:+19383365293',
      To: 'whatsapp:+56957790379',
      ContentSid: 'HX00000000000000000000000000000001',
    };
    expect(twilioContentForm(base)).toEqual(esperado);
    expect(twilioContentForm({ ...base, contentVariables: {} })).toEqual(esperado);
  });
});

describe('hashTwilioContentForm', () => {
  const params = {
    fromNumber: '+19383365293',
    to: '+56957790379',
    contentSid: 'HX00000000000000000000000000000001',
    contentVariables: { '1': 'a', '2': 'b' },
  };

  it('es sha256 hex y estable ante el orden de inserción de las variables', () => {
    const h = hashTwilioContentForm(params);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTwilioContentForm({ ...params, contentVariables: { '2': 'b', '1': 'a' } })).toBe(h);
  });

  it('cambia si cambia el sender, el destinatario, el template o una variable', () => {
    const h = hashTwilioContentForm(params);
    expect(hashTwilioContentForm({ ...params, fromNumber: '+10000000000' })).not.toBe(h);
    expect(hashTwilioContentForm({ ...params, to: '+56900000000' })).not.toBe(h);
    expect(
      hashTwilioContentForm({ ...params, contentSid: 'HX00000000000000000000000000000002' }),
    ).not.toBe(h);
    expect(hashTwilioContentForm({ ...params, contentVariables: { '1': 'a', '2': 'c' } })).not.toBe(
      h,
    );
  });

  it('prefijo whatsapp: explícito o implícito produce el mismo hash', () => {
    expect(hashTwilioContentForm({ ...params, to: 'whatsapp:+56957790379' })).toBe(
      hashTwilioContentForm(params),
    );
  });
});
