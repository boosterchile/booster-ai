import { describe, expect, it } from 'vitest';
import { collectMiddlewaresPerPath } from '../../scripts/collect-middlewares-per-path.js';

/** Parser de `app.use` que usa el gate de impersonación. */

const WELL_WIRED = `
app.use('/me', firebaseAuthMiddleware, rateLimitMiddleware, impersonationWriteGuardMiddleware);
app.use('/me/*', firebaseAuthMiddleware, rateLimitMiddleware, impersonationWriteGuardMiddleware);
app.use(
  '/empresas/*',
  firebaseAuthMiddleware,
  rateLimitMiddleware,
  impersonationWriteGuardMiddleware,
);
`;

const SPLIT_USE_BLOCKS = `
// Pattern: firebaseAuth + rateLimit + impersonationWriteGuard en use blocks separados
// (válido pq se suman en la chain del path).
app.use('/certificates/*', async (c, next) => firebaseAuthMiddleware(c, next));
app.use('/certificates/*', async (c, next) => rateLimitMiddleware(c, next));
app.use('/certificates/*', impersonationWriteGuardMiddleware);
`;

describe('collectMiddlewaresPerPath', () => {
  it('single-line app.use con múltiples middlewares → todos asociados al path', () => {
    const map = collectMiddlewaresPerPath(WELL_WIRED);
    expect(map.get('/me')).toEqual([
      'firebaseAuthMiddleware',
      'rateLimitMiddleware',
      'impersonationWriteGuardMiddleware',
    ]);
  });

  it('multi-line app.use → middlewares correctamente asociados', () => {
    const map = collectMiddlewaresPerPath(WELL_WIRED);
    const empresasMws = map.get('/empresas/*');
    expect(empresasMws).toContain('firebaseAuthMiddleware');
    expect(empresasMws).toContain('rateLimitMiddleware');
    expect(empresasMws).toContain('impersonationWriteGuardMiddleware');
  });

  it('múltiples app.use sobre el mismo path → middlewares acumulados', () => {
    const map = collectMiddlewaresPerPath(SPLIT_USE_BLOCKS);
    const certMws = map.get('/certificates/*');
    expect(certMws).toContain('impersonationWriteGuardMiddleware');
    // El wrapper inline NO conta como firebaseAuthMiddleware identifier directo,
    // pero el grep busca textualmente identifier.
  });
});
