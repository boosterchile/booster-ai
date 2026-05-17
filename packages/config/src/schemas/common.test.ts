import { describe, expect, it } from 'vitest';
import { commonEnvSchema } from './common.js';

describe('commonEnvSchema', () => {
  const baseValid = {
    NODE_ENV: 'production',
    SERVICE_NAME: 'api',
  };

  it('parsea minimal válido y aplica defaults (PORT=8080, LOG_LEVEL=info, version)', () => {
    const env = commonEnvSchema.parse(baseValid);
    expect(env.NODE_ENV).toBe('production');
    expect(env.SERVICE_NAME).toBe('api');
    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SERVICE_VERSION).toBe('0.0.0-dev');
  });

  it('acepta los 4 NODE_ENV permitidos', () => {
    for (const e of ['development', 'staging', 'production', 'test'] as const) {
      const env = commonEnvSchema.parse({ ...baseValid, NODE_ENV: e });
      expect(env.NODE_ENV).toBe(e);
    }
  });

  it('rechaza NODE_ENV fuera de los 4 valores', () => {
    expect(() => commonEnvSchema.parse({ ...baseValid, NODE_ENV: 'prod' })).toThrow();
  });

  it('coerce PORT desde string', () => {
    const env = commonEnvSchema.parse({ ...baseValid, PORT: '9090' });
    expect(env.PORT).toBe(9090);
  });

  it('rechaza PORT no-positivo', () => {
    expect(() => commonEnvSchema.parse({ ...baseValid, PORT: '-1' })).toThrow();
    expect(() => commonEnvSchema.parse({ ...baseValid, PORT: '0' })).toThrow();
  });

  it('acepta los 6 LOG_LEVEL permitidos', () => {
    for (const l of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      const env = commonEnvSchema.parse({ ...baseValid, LOG_LEVEL: l });
      expect(env.LOG_LEVEL).toBe(l);
    }
  });

  it('rechaza SERVICE_NAME vacío', () => {
    expect(() => commonEnvSchema.parse({ ...baseValid, SERVICE_NAME: '' })).toThrow();
  });

  it('rechaza missing required (NODE_ENV, SERVICE_NAME)', () => {
    expect(() => commonEnvSchema.parse({})).toThrow();
    expect(() => commonEnvSchema.parse({ NODE_ENV: 'production' })).toThrow();
  });
});
