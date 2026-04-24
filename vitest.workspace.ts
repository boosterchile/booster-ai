import { defineWorkspace } from 'vitest/config';

/**
 * Vitest workspace — descubre configs individuales de cada app/package
 * y corre tests en paralelo con coverage agregado.
 *
 * Cada workspace package puede tener su propio vitest.config.ts si necesita
 * overrides (ej. jsdom para apps/web, node para apps/api).
 */
export default defineWorkspace(['apps/*', 'packages/*']);
