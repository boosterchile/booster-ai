import { describe, expect, it } from 'vitest';
import { firebaseEnvSchema } from './firebase.js';

describe('firebaseEnvSchema', () => {
  it('parsea minimal válido (solo FIREBASE_PROJECT_ID)', () => {
    const env = firebaseEnvSchema.parse({ FIREBASE_PROJECT_ID: 'booster-ai-dev' });
    expect(env.FIREBASE_PROJECT_ID).toBe('booster-ai-dev');
    expect(env.FIREBASE_STORAGE_BUCKET).toBeUndefined();
  });

  it('acepta FIREBASE_STORAGE_BUCKET opcional', () => {
    const env = firebaseEnvSchema.parse({
      FIREBASE_PROJECT_ID: 'p',
      FIREBASE_STORAGE_BUCKET: 'gs://p.appspot.com',
    });
    expect(env.FIREBASE_STORAGE_BUCKET).toBe('gs://p.appspot.com');
  });

  it('rechaza FIREBASE_PROJECT_ID vacío', () => {
    expect(() => firebaseEnvSchema.parse({ FIREBASE_PROJECT_ID: '' })).toThrow();
  });

  it('rechaza missing FIREBASE_PROJECT_ID', () => {
    expect(() => firebaseEnvSchema.parse({})).toThrow();
  });
});
