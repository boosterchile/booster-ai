import { describe, expect, it } from 'vitest';
import { redisEnvSchema } from './redis.js';

describe('redisEnvSchema', () => {
  it('parsea minimal válido y aplica defaults (port=6379, TLS=false)', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'localhost' });
    expect(env.REDIS_HOST).toBe('localhost');
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.REDIS_TLS).toBe(false);
    expect(env.REDIS_PASSWORD).toBeUndefined();
  });

  it('coerce REDIS_PORT desde string', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_PORT: '6380' });
    expect(env.REDIS_PORT).toBe(6380);
  });

  it('REDIS_TLS="true" → true (booleanFlag)', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_TLS: 'true' });
    expect(env.REDIS_TLS).toBe(true);
  });

  it('REDIS_TLS="false" → false (el footgun de z.coerce.boolean lo volvía true)', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_TLS: 'false' });
    expect(env.REDIS_TLS).toBe(false);
  });

  it('REDIS_TLS="0" → false', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_TLS: '0' });
    expect(env.REDIS_TLS).toBe(false);
  });

  it('acepta REDIS_PASSWORD opcional', () => {
    const env = redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_PASSWORD: 'shh' });
    expect(env.REDIS_PASSWORD).toBe('shh');
  });

  it('rechaza REDIS_HOST vacío', () => {
    expect(() => redisEnvSchema.parse({ REDIS_HOST: '' })).toThrow();
  });

  it('rechaza REDIS_PORT no-positivo', () => {
    expect(() => redisEnvSchema.parse({ REDIS_HOST: 'h', REDIS_PORT: '0' })).toThrow();
  });
});
