import { describe, expect, it } from 'vitest';

// Smoke test del skeleton: importa main.ts (solo crea logger y loguea
// startup — verificado sin listeners ni I/O) para dar cobertura real al
// workspace y que el gate de ci.yml lo valide (auditoría 2026-06-09).
describe('@booster-ai/matching-engine (skeleton)', () => {
  it('main.ts importa sin lanzar', async () => {
    await expect(import('../src/main.js')).resolves.toBeDefined();
  });
});
