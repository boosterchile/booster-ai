import { describe, expect, it } from 'vitest';
import { collectMiddlewaresPerPath } from '../../scripts/check-is-demo-wire-completeness.js';

/**
 * Parser de `app.use` que reutiliza el gate de impersonación.
 * El veredicto "el enforcement demo no vuelve al hot path" vive en
 * `auth-hot-path-no-demo-enforcement.test.ts`.
 */

const WELL_WIRED = `
app.use('/me', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
app.use('/me/*', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
app.use(
  '/empresas/*',
  firebaseAuthMiddleware,
  demoExpiresMiddleware,
  isDemoEnforcementMiddleware,
);
`;

const SPLIT_USE_BLOCKS = `
// Pattern: firebaseAuth + demoExpires + isDemo en use blocks separados
// (válido pq se suman en la chain del path).
app.use('/certificates/*', async (c, next) => firebaseAuthMiddleware(c, next));
app.use('/certificates/*', async (c, next) => demoExpiresMiddleware(c, next));
app.use('/certificates/*', isDemoEnforcementMiddleware);
`;

describe('check-is-demo-wire-completeness — collectMiddlewaresPerPath', () => {
  it('single-line app.use con múltiples middlewares → todos asociados al path', () => {
    const map = collectMiddlewaresPerPath(WELL_WIRED);
    expect(map.get('/me')).toEqual([
      'firebaseAuthMiddleware',
      'demoExpiresMiddleware',
      'isDemoEnforcementMiddleware',
    ]);
  });

  it('multi-line app.use → middlewares correctamente asociados', () => {
    const map = collectMiddlewaresPerPath(WELL_WIRED);
    const empresasMws = map.get('/empresas/*');
    expect(empresasMws).toContain('firebaseAuthMiddleware');
    expect(empresasMws).toContain('demoExpiresMiddleware');
    expect(empresasMws).toContain('isDemoEnforcementMiddleware');
  });

  it('múltiples app.use sobre el mismo path → middlewares acumulados', () => {
    const map = collectMiddlewaresPerPath(SPLIT_USE_BLOCKS);
    const certMws = map.get('/certificates/*');
    expect(certMws).toContain('isDemoEnforcementMiddleware');
    // El wrapper inline NO conta como firebaseAuthMiddleware identifier directo,
    // pero el grep busca textualmente identifier.
  });
});
