import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findMissingGuard } from '../scripts/check-impersonation-wire-completeness.js';
import { collectMiddlewaresPerPath } from '../scripts/collect-middlewares-per-path.js';

/**
 * Invariante de cobertura del impersonation-write-guard, corriendo en el job
 * `test` estándar (no depende de wire-check en un workflow aparte): CADA mount
 * point auth-required de usuario final en server.ts debe tener el guard. Un gap
 * sería una ruta mutante por la que una sesión impersonada podría escribir
 * sobre una empresa real sin bloqueo.
 *
 * Nota: el for-loop de transport-docs (`app.use(prefix, ...)` con variable) es
 * un blind spot del parser por-string — se cablea a
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
      app.use('/nuevo/*', firebaseAuthMiddleware, rateLimitMiddleware);
      app.use('/nuevo/*', userContextMiddleware);
      app.route('/nuevo', createNuevoRoutes());
    `;
    expect(findMissingGuard(source)).toContain('/nuevo/*');
  });

  it('no reporta un path que sí tiene el guard', () => {
    const source = `
      app.use('/ok/*', firebaseAuthMiddleware, rateLimitMiddleware);
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

// `.specs/confirmar-acceso-booster` SC12 (T5): la confirmación del acceso al
// panel es una escritura que una sesión impersonada no puede hacer. El guard
// de `/me/*` corre antes del userContext del path nuevo, así que no ve una
// empresa activa y bloquea toda escritura impersonada.
describe('impersonation-write-guard — confirmación del acceso al panel', () => {
  const PATH = '/me/confirmar-acceso-booster';
  const USE_GUARD = "app.use('/me/*', impersonationWriteGuardMiddleware)";
  const USE_CONTEXTO = `app.use('${PATH}', userContextMiddlewareForMe)`;

  it('el path tiene su app.use y queda bajo /me/*, con firebaseAuth y el guard', () => {
    // El colector solo extrae identificadores que terminan en `Middleware`;
    // `userContextMiddlewareForMe` se comprueba en el texto (test siguiente).
    const mapa = collectMiddlewaresPerPath(SERVER_SOURCE);
    expect(mapa.has(PATH)).toBe(true);
    expect(mapa.get('/me/*')).toEqual(
      expect.arrayContaining(['firebaseAuthMiddleware', 'impersonationWriteGuardMiddleware']),
    );
  });

  it('el guard de /me/* se registra antes que el userContext del path', () => {
    const guard = SERVER_SOURCE.indexOf(USE_GUARD);
    const contexto = SERVER_SOURCE.indexOf(USE_CONTEXTO);
    expect(guard).toBeGreaterThan(-1);
    expect(contexto).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(contexto);
  });

  it("el mount y su userContext quedan antes de app.route('/me', meRouter)", () => {
    // Un sub-mount de meRouter registrado después de app.route('/me', meRouter)
    // compila y pasa los tests del router aislado, pero no existe en la app.
    const montaje = SERVER_SOURCE.search(/meRouter\.route\(\s*'\/confirmar-acceso-booster'/);
    const contexto = SERVER_SOURCE.indexOf(USE_CONTEXTO);
    // La sentencia, no la mención en un comentario.
    const me = SERVER_SOURCE.search(/^\s*app\.route\('\/me', meRouter\);/m);
    expect(montaje).toBeGreaterThan(-1);
    expect(contexto).toBeGreaterThan(-1);
    expect(me).toBeGreaterThan(-1);
    expect(contexto).toBeLessThan(me);
    expect(montaje).toBeLessThan(me);
  });
});
