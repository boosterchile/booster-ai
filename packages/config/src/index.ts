/**
 * @booster-ai/config
 *
 * Parsing de variables de entorno y constantes compartidas.
 * Principios:
 *   - Parse al arranque, no en runtime (fail-fast si config inválida).
 *   - Zod schemas tipados para cada servicio.
 *   - Sin defaults silenciosos: explicitamos requeridos vs opcionales.
 */

export { parseEnv, type EnvSchema } from './parseEnv.js';
export { commonEnvSchema, type CommonEnv } from './schemas/common.js';
export { gcpEnvSchema, type GcpEnv } from './schemas/gcp.js';
export { databaseEnvSchema, type DatabaseEnv } from './schemas/database.js';
export { redisEnvSchema, type RedisEnv } from './schemas/redis.js';
export { firebaseEnvSchema, type FirebaseEnv } from './schemas/firebase.js';
