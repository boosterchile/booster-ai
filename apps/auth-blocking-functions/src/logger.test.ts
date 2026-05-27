import { describe, expect, it } from 'vitest';
import { logger } from './logger.js';

/**
 * Sprint 2c-A T6 — structure smoke for logger module.
 *
 * Verifies that `createLogger` was called with valid options at module
 * load and the exported `logger` has the standard Pino API surface.
 * Behavioral tests of redaction etc. live in `@booster-ai/logger`'s
 * own suite.
 */
describe('logger', () => {
  it('exports a configured pino-like logger', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('is bound to the auth-blocking-functions service', () => {
    const bindings = logger.bindings();
    expect(bindings.service).toBe('@booster-ai/auth-blocking-functions');
  });
});
