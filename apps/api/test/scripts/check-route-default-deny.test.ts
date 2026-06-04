import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ROUTE_CLASSIFICATION,
  enumerateRouteMounts,
  evaluateRoutes,
  findMissingRationale,
  findStaleClassifications,
  findUnclassifiedMounts,
} from '../../scripts/check-route-default-deny.js';

/**
 * Tests para T2 / SC-G1b — harness CI default-deny (spec T15).
 *
 * El check enumera CADA mount de server.ts (`app.route()` + los sub-mounts
 * `<router>.route()`, que es donde viven las rutas privilegio-relevantes
 * fuera de userContext: `meRouter.route('/consents', …)`,
 * `meRouter.route('/', …clave-numerica)`) y asserta que cada factory/router
 * enumerado esté clasificado en ROUTE_CLASSIFICATION. Un mount nuevo sin
 * clasificar → exit 1 (default-deny). Reemplaza el backstop creation-time
 * (blocking function, ADR-054 → ADR-057) por una invariante de wiring durable.
 *
 * Distinción clave vs check-is-demo-wire-completeness.ts (P1-1 del DA R2):
 * aquél escanea SOLO `app.use('/path', …)` (line-based) → no ve `app.route()`
 * ni los sub-mounts `<router>.route()`. Éste enumera por factory (multi-línea).
 */

const REAL_SERVER_SOURCE = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf-8');

describe('check-route-default-deny — enumerateRouteMounts', () => {
  it('single-line app.route con factory → key = factory', () => {
    const mounts = enumerateRouteMounts(
      "app.route('/feature-flags', createFeatureFlagsRoutes({ logger }));",
    );
    expect(mounts).toEqual([{ path: '/feature-flags', key: 'createFeatureFlagsRoutes' }]);
  });

  it('multi-línea app.route (path y factory en líneas distintas) → enumerado', () => {
    const source = `
      app.route(
        '/webpush',
        createWebpushPublicRoutes({
          vapidPublicKey: 'x',
        }),
      );
    `;
    const mounts = enumerateRouteMounts(source);
    expect(mounts).toEqual([{ path: '/webpush', key: 'createWebpushPublicRoutes' }]);
  });

  it('router-var mount app.route("/me", meRouter) → key = meRouter', () => {
    const mounts = enumerateRouteMounts("app.route('/me', meRouter);");
    expect(mounts).toEqual([{ path: '/me', key: 'meRouter' }]);
  });

  it('sub-mount <router>.route("/consents", createMeConsentsRoutes(…)) → enumerado', () => {
    const mounts = enumerateRouteMounts(
      "meRouter.route('/consents', createMeConsentsRoutes({ db: opts.db, logger }));",
    );
    expect(mounts).toEqual([{ path: '/consents', key: 'createMeConsentsRoutes' }]);
  });

  it('sub-mount con router-var como handler (assignmentsRouter.route("/", chatRouter)) → key = chatRouter', () => {
    const mounts = enumerateRouteMounts("assignmentsRouter.route('/', chatRouter);");
    expect(mounts).toEqual([{ path: '/', key: 'chatRouter' }]);
  });

  it('NO confunde app.use con app.route', () => {
    const mounts = enumerateRouteMounts("app.use('/me/*', firebaseAuthMiddleware);");
    expect(mounts).toEqual([]);
  });
});

describe('check-route-default-deny — default-deny (T15)', () => {
  it('server.ts real → todos los mounts clasificados (0 sin clasificar)', () => {
    expect(findUnclassifiedMounts(REAL_SERVER_SOURCE, ROUTE_CLASSIFICATION)).toEqual([]);
  });

  it('un factory ficticio montado sin clasificar → flagged (falla el build)', () => {
    const tampered = `${REAL_SERVER_SOURCE}
      app.route('/backdoor', createBackdoorRoutes({ db: opts.db, logger }));`;
    expect(findUnclassifiedMounts(tampered, ROUTE_CLASSIFICATION)).toEqual([
      'createBackdoorRoutes',
    ]);
  });

  it('un sub-mount <router>.route() nuevo sin clasificar → flagged (la clase de riesgo)', () => {
    const tampered = `${REAL_SERVER_SOURCE}
      meRouter.route('/shadow-admin', createShadowAdminRoutes({ db: opts.db, logger }));`;
    expect(findUnclassifiedMounts(tampered, ROUTE_CLASSIFICATION)).toEqual([
      'createShadowAdminRoutes',
    ]);
  });

  it('mismo factory sin clasificar montado dos veces → reportado una sola vez (dedup)', () => {
    const source = `
      app.route('/dup', createDupRoutes({ logger }));
      app.route('/dup-prefix', createDupRoutes({ logger }));`;
    expect(findUnclassifiedMounts(source, {})).toEqual(['createDupRoutes']);
  });
});

describe('check-route-default-deny — evaluateRoutes (agregación pura)', () => {
  it('server.ts real → ok=true, sin findings', () => {
    const result = evaluateRoutes(REAL_SERVER_SOURCE, ROUTE_CLASSIFICATION);
    expect(result.ok).toBe(true);
    expect(result.unclassified).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.missingRationale).toEqual([]);
    expect(result.totalMounts).toBeGreaterThan(0);
  });

  it('factory sin clasificar → ok=false con unclassified poblado', () => {
    const tampered = `${REAL_SERVER_SOURCE}
      app.route('/backdoor', createBackdoorRoutes({ logger }));`;
    const result = evaluateRoutes(tampered, ROUTE_CLASSIFICATION);
    expect(result.ok).toBe(false);
    expect(result.unclassified).toContain('createBackdoorRoutes');
  });

  it('entrada stale en la tabla → ok=false con stale poblado', () => {
    const classificationWithGhost = {
      ...ROUTE_CLASSIFICATION,
      createGhostRoutes: { category: 'ENFORCED' as const, rationale: '' },
    };
    const result = evaluateRoutes(REAL_SERVER_SOURCE, classificationWithGhost);
    expect(result.ok).toBe(false);
    expect(result.stale).toContain('createGhostRoutes');
  });

  it('entrada no-ENFORCED sin rationale → ok=false con missingRationale poblado', () => {
    const source = "app.route('/x', createXRoutes({ logger }));";
    const classification = {
      createXRoutes: { category: 'INTENTIONAL-OPEN' as const, rationale: '' },
    };
    const result = evaluateRoutes(source, classification);
    expect(result.ok).toBe(false);
    expect(result.missingRationale).toEqual(['createXRoutes']);
  });
});

describe('check-route-default-deny — findMissingRationale', () => {
  it('ENFORCED sin rationale NO se flagea (userContext da la propiedad)', () => {
    const classification = {
      createEnforcedRoutes: { category: 'ENFORCED' as const, rationale: '' },
    };
    expect(findMissingRationale(classification)).toEqual([]);
  });

  it('rationale solo whitespace cuenta como vacío', () => {
    const classification = {
      createWsRoutes: { category: 'INTERNAL' as const, rationale: '   ' },
    };
    expect(findMissingRationale(classification)).toEqual(['createWsRoutes']);
  });
});

describe('check-route-default-deny — integridad de la tabla', () => {
  it('server.ts real → 0 entradas stale (toda clasificación sigue montada)', () => {
    expect(findStaleClassifications(REAL_SERVER_SOURCE, ROUTE_CLASSIFICATION)).toEqual([]);
  });

  it('toda entrada no-ENFORCED tiene rationale no vacío', () => {
    expect(findMissingRationale(ROUTE_CLASSIFICATION)).toEqual([]);
  });
});

describe('check-route-default-deny — los 6 mounts verificados (INTENTIONAL-OPEN)', () => {
  // Verificados línea-a-línea contra server.ts al codear T2: ninguno tiene
  // firebaseAuth/userContext app.use precediéndolos; son emisores de auth o
  // endpoints demo/público por diseño.
  it.each([
    'createAuthUniversalRoutes',
    'createDriverAuthRoutes',
    'createDemoLoginRoutes',
    'createDemoCacheWarmRoutes',
    'createPublicTrackingRoutes',
    'createWebpushPublicRoutes',
  ])('%s clasificado INTENTIONAL-OPEN', (factory) => {
    expect(ROUTE_CLASSIFICATION[factory]?.category).toBe('INTENTIONAL-OPEN');
  });
});
