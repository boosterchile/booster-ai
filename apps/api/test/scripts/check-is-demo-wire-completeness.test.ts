import { describe, expect, it } from 'vitest';
import {
  collectMiddlewaresPerPath,
  findMissingEnforcement,
} from '../../scripts/check-is-demo-wire-completeness.js';

/**
 * Tests para T3 SC-1.3.2 audit-completeness CI gate.
 *
 * Parser scan server.ts → collect middleware chains per path → identify
 * paths con firebaseAuthMiddleware pero SIN isDemoEnforcementMiddleware.
 * Exit 1 si missing.
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

const MISSING_ENFORCEMENT = `
app.use('/me', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
app.use(
  '/empresas/*',
  firebaseAuthMiddleware,
  demoExpiresMiddleware,
);
`;

const SPLIT_USE_BLOCKS = `
// Pattern: firebaseAuth + isDemo en use blocks separados (válido pq se
// suman en la chain del path).
app.use('/certificates/*', async (c, next) => firebaseAuthMiddleware(c, next));
app.use('/certificates/*', isDemoEnforcementMiddleware);
`;

const PUBLIC_PATH_NO_CHECK = `
// Path público sin firebaseAuth — no debe ser flagged.
app.route('/feature-flags', createFeatureFlagsRoutes({ logger }));
app.use('/public/*', async (c, next) => next());
`;

const CRON_AUTH_NOT_FIREBASE = `
// /admin/jobs usa cronAuthMiddleware (OIDC SA), no firebaseAuth — no
// debe requerir isDemoEnforcementMiddleware.
app.use('/admin/jobs/*', cronAuthMiddleware);
app.route('/admin/jobs', createAdminJobsRoutes({ db, logger }));
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

describe('check-is-demo-wire-completeness — findMissingEnforcement', () => {
  it('todos los paths con firebase tienen isDemo → 0 missing', () => {
    const missing = findMissingEnforcement(WELL_WIRED);
    expect(missing).toEqual([]);
  });

  it('path con firebase pero sin isDemo → flagged', () => {
    const missing = findMissingEnforcement(MISSING_ENFORCEMENT);
    expect(missing).toEqual(['/empresas/*']);
  });

  it('split use-blocks con firebase + isDemo en distintos statements → 0 missing', () => {
    const missing = findMissingEnforcement(SPLIT_USE_BLOCKS);
    expect(missing).toEqual([]);
  });

  it('path público sin firebase → no flagged', () => {
    const missing = findMissingEnforcement(PUBLIC_PATH_NO_CHECK);
    expect(missing).toEqual([]);
  });

  it('path con cronAuth (no firebase) → no flagged (OIDC SA paths)', () => {
    const missing = findMissingEnforcement(CRON_AUTH_NOT_FIREBASE);
    expect(missing).toEqual([]);
  });

  it('múltiples app.use sobre mismo path con isDemo en al menos uno → coverage satisfied', () => {
    // Semantic correcta: Hono ejecuta todos los middlewares declarados
    // para un path. Si isDemoEnforcement está en CUALQUIER app.use para
    // el path, coverage está satisfied (el middleware fires).
    const combined = WELL_WIRED + MISSING_ENFORCEMENT;
    const missing = findMissingEnforcement(combined);
    expect(missing).toEqual([]); // /empresas/* tiene isDemo en WELL_WIRED block.
  });

  it('path con firebase en chain pero isDemo SOLO en use diferente → coverage satisfied', () => {
    const source = `
      app.use('/widgets/*', firebaseAuthMiddleware, demoExpiresMiddleware);
      app.use('/widgets/*', userContextMiddleware);
      app.use('/widgets/*', isDemoEnforcementMiddleware);
    `;
    expect(findMissingEnforcement(source)).toEqual([]);
  });
});
