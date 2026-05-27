import gcipCloudFunctions from 'gcip-cloud-functions';
import { beforeCreateCallback } from './handler.js';

/**
 * Sprint 2c-A T4 — entrypoint deploy wrapper.
 *
 * Replaces the T3 BOOTSTRAP_T3 placeholder with the actual gcip-cloud-
 * functions `beforeCreate` Cloud Function Gen 1 export. `gcloud
 * functions deploy beforeCreate` (Sprint 2c-B) picks up this export.
 *
 * The handler logic lives in `./handler.ts` (testable in isolation
 * without the deploy machinery). This wrapper is excluded from
 * coverage per `vitest.config.ts` (`exclude: ['src/**\/index.ts']`)
 * because the gcip Auth instantiation has no testable surface.
 */
const auth = new gcipCloudFunctions.Auth();

export const beforeCreate = auth.functions().beforeCreateHandler(beforeCreateCallback);
