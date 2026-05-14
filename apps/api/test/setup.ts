import { vi } from 'vitest';

// ADR-038: routes-api.ts y gemini-client.ts usan `new GoogleAuth(...)` a
// nivel de módulo. En CI no hay ADC ni internet — `getAccessToken()` lanza
// y los tests que indirectamente ejercitan estos clientes fallan. Mock
// global con `importOriginal` para preservar OAuth2Client/JWT/otros exports
// usados por otras dependencias (pg auth helpers, firebase-admin, etc.).
vi.mock('google-auth-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('google-auth-library')>();
  class MockGoogleAuth {
    async getClient() {
      return {
        async getAccessToken() {
          return { token: 'test-access-token' };
        },
      };
    }
  }
  return { ...actual, GoogleAuth: MockGoogleAuth };
});

// Stub env vars antes que cualquier test importe módulos que evalúan config.
// El `parseEnv` de packages/config llama process.exit(1) si fallan los Zod
// schemas — sin estos defaults, vitest aborta el suite con
// "process.exit unexpectedly called". Tests que necesitan valores específicos
// pueden sobreescribir process.env dentro de su propio beforeEach.
process.env.NODE_ENV ??= 'test';
process.env.SERVICE_NAME ??= 'booster-ai-api';
process.env.SERVICE_VERSION ??= '0.0.0-test';
process.env.LOG_LEVEL ??= 'error';
process.env.GOOGLE_CLOUD_PROJECT ??= 'booster-ai-test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.DATABASE_POOL_MAX ??= '5';
process.env.DATABASE_CONNECT_TIMEOUT_MS ??= '1000';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
process.env.REDIS_TLS ??= 'false';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:5173';
process.env.FIREBASE_PROJECT_ID ??= 'booster-ai-test';
process.env.JWT_ISSUER ??= 'booster-ai';
process.env.API_AUDIENCE ??= 'https://api.test.boosterchile.com';
process.env.ALLOWED_CALLER_SA ??= 'test-caller@booster-ai-test.iam.gserviceaccount.com';
process.env.BOOSTER_PLATFORM_ADMIN_EMAILS ??= 'dev@boosterchile.com';
