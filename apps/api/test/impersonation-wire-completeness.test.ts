import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMissingGuard } from '../scripts/check-impersonation-wire-completeness.js';

/**
 * Invariante de cobertura del impersonation-write-guard, corriendo en el job
 * `test` estándar (no depende de wire-check en un workflow aparte): CADA mount
 * point auth-required de usuario final en server.ts debe tener el guard. Un gap
 * sería una ruta mutante por la que una sesión impersonada podría escribir
 * sobre una empresa real sin bloqueo.
 *
 * Nota: el for-loop de transport-docs (`app.use(prefix, ...)` con variable) es
 * un blind spot del parser por-string (igual que check-is-demo) — se cablea a
 * mano y se cubre con el test de integración/route, no acá.
 */

const SERVER_SOURCE = readFileSync(new URL('../src/server.ts', import.meta.url).pathname, 'utf-8');

describe('impersonation-write-guard wire completeness', () => {
  it('server.ts: todos los mount points auth-required (firebaseAuth) tienen el guard', () => {
    const missing = findMissingGuard(SERVER_SOURCE);
    expect(missing, `paths sin guard: ${missing.join(', ')}`).toEqual([]);
  });

  it('detecta un gap: path con firebaseAuth pero sin el guard → lo reporta', () => {
    const source = `
      app.use('/nuevo/*', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
      app.use('/nuevo/*', userContextMiddleware);
      app.route('/nuevo', createNuevoRoutes());
    `;
    expect(findMissingGuard(source)).toContain('/nuevo/*');
  });

  it('no reporta un path que sí tiene el guard', () => {
    const source = `
      app.use('/ok/*', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
      app.use('/ok/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    `;
    expect(findMissingGuard(source)).toEqual([]);
  });

  it('ignora paths sin firebaseAuth (auth service-to-service OIDC no es impersonable)', () => {
    const source = `
      app.use('/trip-requests/*', authMiddleware);
      app.route('/trip-requests', createTripRequestsRoutes());
    `;
    expect(findMissingGuard(source)).toEqual([]);
  });
});
