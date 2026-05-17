import { vi } from 'vitest';

// ADR-038: mismo mock de google-auth-library que setup.ts para evitar que
// importar módulos de prod (config, services/firebase) dispare
// `new GoogleAuth()` real.
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

// Integration tests sí necesitan una BD real, así que NO stubeamos
// DATABASE_URL ni TEST_DATABASE_URL — el helper `createTestDb` los lee
// del shell y aborta si TEST_DATABASE_URL no está definido.
//
// El resto del env va con defaults inocuos para que `parseEnv` no haga
// `process.exit(1)` al evaluar config en imports indirectos.
process.env.NODE_ENV ??= 'test';
process.env.SERVICE_NAME ??= 'booster-ai-api';
process.env.SERVICE_VERSION ??= '0.0.0-test';
process.env.LOG_LEVEL ??= 'error';
process.env.GOOGLE_CLOUD_PROJECT ??= 'booster-ai-test';
// DATABASE_URL placeholder para parseEnv — los tests integration no lo usan,
// usan TEST_DATABASE_URL via createTestDb. Si algún import indirecto necesita
// DATABASE_URL real, ese test debe sobreescribir process.env.DATABASE_URL
// con TEST_DATABASE_URL en su propio beforeAll.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.DATABASE_POOL_MAX ??= '5';
process.env.DATABASE_CONNECT_TIMEOUT_MS ??= '5000';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
process.env.REDIS_TLS ??= 'false';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:5173';
process.env.FIREBASE_PROJECT_ID ??= 'booster-ai-test';
process.env.JWT_ISSUER ??= 'booster-ai';
process.env.API_AUDIENCE ??= 'https://api.test.boosterchile.com';
process.env.ALLOWED_CALLER_SA ??= 'test-caller@booster-ai-test.iam.gserviceaccount.com';
process.env.BOOSTER_PLATFORM_ADMIN_EMAILS ??= 'dev@boosterchile.com';
