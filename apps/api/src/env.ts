/**
 * Re-export de la config canónica. Mantener sólo config.ts como fuente de verdad.
 * Este archivo existe por compatibilidad — evitar importar desde acá en código nuevo.
 */
export { config, type ApiEnv } from './config.js';
