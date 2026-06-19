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
});
