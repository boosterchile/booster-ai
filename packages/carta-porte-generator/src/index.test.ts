import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

// Smoke test del stub: da cobertura real al entrypoint para que el gate
// de coverage de ci.yml valide este workspace (antes era opt-out, y
// código nuevo acá pasaba CI sin un solo test — auditoría 2026-06-09).
describe('@booster-ai/carta-porte-generator (stub)', () => {
  it('exporta PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@booster-ai/carta-porte-generator');
  });
});
