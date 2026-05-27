import { createLogger } from '@booster-ai/logger';

/**
 * Sprint 2c-A T6 — structured logger for auth-blocking-functions.
 *
 * Service name `@booster-ai/auth-blocking-functions` matches the
 * workspace package name and shows up in every log entry's `service`
 * field. Cloud Run + Cloud Logging map the JSON output to structured
 * log fields (severity, trace, etc.) automatically per @booster-ai/
 * logger conventions.
 *
 * Used by T7 onwards for `event: 'signup.blocked.google'` structured
 * log entries with PII-redacted email (hashed) + correlationId +
 * ipAddress.
 */
export const logger = createLogger({
  service: '@booster-ai/auth-blocking-functions',
  level: 'info',
});
