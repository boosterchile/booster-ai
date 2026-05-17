import { describe, expect, it } from 'vitest';
import { gcpEnvSchema } from './gcp.js';

describe('gcpEnvSchema', () => {
  it('parsea minimal válido (solo GOOGLE_CLOUD_PROJECT)', () => {
    const env = gcpEnvSchema.parse({ GOOGLE_CLOUD_PROJECT: 'booster-ai-prod' });
    expect(env.GOOGLE_CLOUD_PROJECT).toBe('booster-ai-prod');
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });

  it('acepta GOOGLE_APPLICATION_CREDENTIALS (path) opcional (dev local)', () => {
    const env = gcpEnvSchema.parse({
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_APPLICATION_CREDENTIALS: '/path/to/sa.json',
    });
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/path/to/sa.json');
  });

  it('rechaza GOOGLE_CLOUD_PROJECT vacío', () => {
    expect(() => gcpEnvSchema.parse({ GOOGLE_CLOUD_PROJECT: '' })).toThrow();
  });

  it('rechaza missing GOOGLE_CLOUD_PROJECT', () => {
    expect(() => gcpEnvSchema.parse({})).toThrow();
  });
});
