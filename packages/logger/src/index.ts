/**
 * @booster-ai/logger
 *
 * Wrapper tipado sobre Pino con:
 *  - Redaction automática de PII (Ley 19.628 compliance)
 *  - Formato JSON compatible con Cloud Logging structured logs
 *  - Integración con trace_id de OpenTelemetry
 *  - Niveles estándar: trace, debug, info, warn, error, fatal
 */

export { createLogger, type Logger, type LoggerOptions } from './createLogger.js';
export { redactionPaths } from './redaction.js';
