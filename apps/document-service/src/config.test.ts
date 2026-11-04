import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfig } from './config.js';

/**
 * El config es un boundary externo (env). Zod lo valida al startup; el worker
 * se rehúsa a arrancar con config inválida (no defaults silenciosos de campos
 * obligatorios).
 */
describe('loadConfig — boundary Zod del worker TED', () => {
  const ORIGINAL = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });
  afterEach(() => {
    process.env = ORIGINAL;
  });

  const minimal = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    GOOGLE_CLOUD_PROJECT: 'booster-ai-test',
    // Mismo nombre de env que inyecta compute.tf (módulo service_document):
    // DOCUMENTS_BUCKET = google_storage_bucket.documents.name.
    DOCUMENTS_BUCKET: 'booster-documents',
  };

  it('parsea una config mínima válida y aplica defaults', () => {
    process.env = { ...process.env, ...minimal };
    const config = loadConfig();
    expect(config.DOCUMENTS_BUCKET).toBe('booster-documents');
    expect(config.PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED).toBe('document-uploaded-processor-sub');
    expect(config.MAX_MESSAGES_IN_FLIGHT).toBe(5);
    expect(config.HEALTH_PORT).toBe(8080);
  });

  it('lanza InvalidConfigError si falta DOCUMENTS_BUCKET', () => {
    process.env = {
      ...process.env,
      DATABASE_URL: minimal.DATABASE_URL,
      GOOGLE_CLOUD_PROJECT: minimal.GOOGLE_CLOUD_PROJECT,
    };
    process.env.DOCUMENTS_BUCKET = undefined;
    expect(() => loadConfig()).toThrow(InvalidConfigError);
  });

  it('lanza si DATABASE_URL no es una URL', () => {
    process.env = { ...process.env, ...minimal, DATABASE_URL: 'not-a-url' };
    expect(() => loadConfig()).toThrow(InvalidConfigError);
  });

  it('MAX_MESSAGES_IN_FLIGHT respeta el rango (rechaza 0 y >100)', () => {
    process.env = { ...process.env, ...minimal, MAX_MESSAGES_IN_FLIGHT: '0' };
    expect(() => loadConfig()).toThrow(InvalidConfigError);
  });

  // ADR-085: el modo de consumo lo fija Terraform junto con la suscripción.
  describe('DOCUMENT_CONSUMER_MODE', () => {
    const SA = 'document-push-invoker@booster-ai-494222.iam.gserviceaccount.com';
    const AUD = 'https://booster-ai-document-service-1.southamerica-west1.run.app';

    function issuesOf(fn: () => unknown): InvalidConfigError['issues'] {
      try {
        fn();
      } catch (err) {
        if (err instanceof InvalidConfigError) {
          return err.issues;
        }
        throw err;
      }
      throw new Error('loadConfig no lanzó');
    }

    it('por defecto es pull y sin endpoint push (imagen nueva antes del apply = comportamiento de hoy)', () => {
      process.env = { ...process.env, ...minimal };
      const config = loadConfig();
      expect(config.DOCUMENT_CONSUMER_MODE).toBe('pull');
      expect(config.PUSH_CALLER_SA).toBeUndefined();
      expect(config.PUSH_OIDC_AUDIENCE).toBeUndefined();
    });

    it('acepta push con el SA y la audience del push', () => {
      process.env = {
        ...process.env,
        ...minimal,
        DOCUMENT_CONSUMER_MODE: 'push',
        PUSH_CALLER_SA: SA,
        PUSH_OIDC_AUDIENCE: AUD,
      };
      const config = loadConfig();
      expect(config.DOCUMENT_CONSUMER_MODE).toBe('push');
      expect(config.PUSH_CALLER_SA).toBe(SA);
      expect(config.PUSH_OIDC_AUDIENCE).toBe(AUD);
    });

    it('acepta pull con el endpoint push configurado (lo que inyecta Terraform con el flag apagado)', () => {
      process.env = { ...process.env, ...minimal, PUSH_CALLER_SA: SA, PUSH_OIDC_AUDIENCE: AUD };
      expect(loadConfig().DOCUMENT_CONSUMER_MODE).toBe('pull');
    });

    it('no arranca en push sin SA o sin audience', () => {
      const message =
        'PUSH_CALLER_SA y PUSH_OIDC_AUDIENCE son obligatorios con DOCUMENT_CONSUMER_MODE=push';
      process.env = { ...process.env, ...minimal, DOCUMENT_CONSUMER_MODE: 'push' };
      expect(issuesOf(loadConfig)).toEqual([{ path: 'PUSH_CALLER_SA', message }]);
      process.env = {
        ...process.env,
        ...minimal,
        DOCUMENT_CONSUMER_MODE: 'push',
        PUSH_CALLER_SA: SA,
      };
      expect(issuesOf(loadConfig)).toEqual([{ path: 'PUSH_OIDC_AUDIENCE', message }]);
    });

    it('en pull, el SA y la audience van juntos', () => {
      const message = 'PUSH_CALLER_SA y PUSH_OIDC_AUDIENCE van juntos';
      process.env = { ...process.env, ...minimal, PUSH_CALLER_SA: SA };
      expect(issuesOf(loadConfig)).toEqual([{ path: 'PUSH_OIDC_AUDIENCE', message }]);
      process.env = { ...minimal, PUSH_OIDC_AUDIENCE: AUD };
      expect(issuesOf(loadConfig)).toEqual([{ path: 'PUSH_CALLER_SA', message }]);
    });

    it('rechaza un modo desconocido, un SA que no es email o una audience que no es URL', () => {
      process.env = { ...process.env, ...minimal, DOCUMENT_CONSUMER_MODE: 'eventarc' };
      expect(() => loadConfig()).toThrow(InvalidConfigError);
      process.env = { ...minimal, PUSH_CALLER_SA: 'x', PUSH_OIDC_AUDIENCE: AUD };
      expect(() => loadConfig()).toThrow(InvalidConfigError);
      process.env = { ...minimal, PUSH_CALLER_SA: SA, PUSH_OIDC_AUDIENCE: 'no-url' };
      expect(() => loadConfig()).toThrow(InvalidConfigError);
    });
  });
});
