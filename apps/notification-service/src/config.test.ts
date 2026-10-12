import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfig } from './config.js';

const minimo = {
  GOOGLE_CLOUD_PROJECT: 'booster-ai-494222',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'token',
  TWILIO_FROM_NUMBER: '+19383365293',
};

describe('loadConfig', () => {
  it('aplica defaults de subscription, flujo, puerto y log', () => {
    expect(loadConfig(minimo)).toEqual({
      ...minimo,
      PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS: 'notification-events-sub',
      MAX_MESSAGES_IN_FLIGHT: 10,
      PORT: 8080,
      LOG_LEVEL: 'info',
      NODE_ENV: 'production',
    });
  });

  it('rechaza arrancar sin credenciales Twilio o con sender no E.164', () => {
    const { TWILIO_AUTH_TOKEN: _t, ...sinToken } = minimo;
    expect(() => loadConfig(sinToken)).toThrow(InvalidConfigError);
    try {
      loadConfig({ ...minimo, TWILIO_FROM_NUMBER: '19383365293' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidConfigError);
      expect((e as InvalidConfigError).issues[0]?.path).toBe('TWILIO_FROM_NUMBER');
    }
  });
});
