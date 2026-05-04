/**
 * Factory: lee config de env y construye el adapter correcto.
 * Llamar una vez al startup; cachear la instancia.
 *
 * dev/test:    DTE_PROVIDER=mock                       → MockAdapter
 * staging/prod: DTE_PROVIDER=paperless + PAPERLESS_*   → PaperlessAdapter
 */

import type { DteEmitter } from './dte-emitter.js';
import { MockAdapter } from './mock-adapter.js';
import { PaperlessAdapter } from './paperless-adapter.js';

export type DteProviderConfig =
  | { provider: 'mock' }
  | {
      provider: 'paperless';
      apiKey: string;
      baseUrl: string;
      timeoutMs?: number;
    };

export function createDteEmitter(config: DteProviderConfig): DteEmitter {
  if (config.provider === 'mock') {
    return new MockAdapter();
  }
  return new PaperlessAdapter({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    ...(config.timeoutMs !== undefined && { timeoutMs: config.timeoutMs }),
  });
}
