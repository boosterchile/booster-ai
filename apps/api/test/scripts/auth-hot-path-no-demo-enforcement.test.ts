import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findHotPathDemoEnforcement,
  stripComments,
} from '../../scripts/check-is-demo-wire-completeness.js';

/**
 * Regresión Slot 2: el enforcement demo no puede volver al request path
 * productivo. Si `server.ts` importa o monta demoExpires / isDemoEnforcement,
 * este test falla.
 */

const SERVER_SOURCE = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf-8');

describe('auth hot path sin enforcement es_demo', () => {
  it('server.ts no importa ni monta demoExpires ni isDemoEnforcement', () => {
    const hits = findHotPathDemoEnforcement(SERVER_SOURCE);
    expect(hits, `enforcement demo reintroducido: ${hits.join(', ')}`).toEqual([]);
  });

  it('un mount que vuelve a encadenar los middlewares dispara el guard', () => {
    const source = `
      app.use('/me', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
    `;
    expect(findHotPathDemoEnforcement(source)).toEqual([
      'demoExpiresMiddleware',
      'isDemoEnforcementMiddleware',
    ]);
  });

  it('el factory y el import disparan el guard aunque el app.use use otro nombre', () => {
    const source = `
      import { createDemoExpiresMiddleware } from './middleware/demo-expires.js';
      const demoExpiresMiddleware = createDemoExpiresMiddleware({ auth, redis, logger });
    `;
    expect(findHotPathDemoEnforcement(source)).toEqual([
      'createDemoExpiresMiddleware',
      'demoExpiresMiddleware',
      "from './middleware/demo-expires",
    ]);
  });

  it('app.use(prefix, …) del for de transport-docs también cuenta', () => {
    const source = `
      app.use(prefix, firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
    `;
    expect(findHotPathDemoEnforcement(source)).toContain('demoExpiresMiddleware');
    expect(findHotPathDemoEnforcement(source)).toContain('isDemoEnforcementMiddleware');
  });

  it('una mención solo en comentario no dispara el guard', () => {
    const source = `
      // demoExpiresMiddleware e isDemoEnforcementMiddleware quedaron fuera del chain.
      /* createDemoExpiresMiddleware no se monta */
      app.use('/me', firebaseAuthMiddleware);
    `;
    expect(stripComments(source)).not.toContain('demoExpiresMiddleware');
    expect(findHotPathDemoEnforcement(source)).toEqual([]);
  });
});
