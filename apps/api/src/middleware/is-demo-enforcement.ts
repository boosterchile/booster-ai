import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type { FirebaseClaims } from './firebase-auth.js';

/**
 * T1 SEC-001 Sprint 2b — is-demo-enforcement middleware (Hono).
 *
 * Defense-in-depth structural enforcement del claim `is_demo` (Sprint 2a
 * Firebase custom claim) en el plano de **authorization**. NO es auth:
 * asume que `firebaseAuthMiddleware` ya verificó el token y publicó
 * `firebaseClaims` en el Hono context. Si el claim no está, este
 * middleware passthrough (no-op) — el caller decidirá si requiere auth.
 *
 * Diseño per spec sec-001-cierre §3 H1.3 (SC-1.3.1 ... SC-1.3.8 v3.4) +
 * plan-sprint-2b §3 T1:
 *
 *   1. 3 modos vía factory `createIsDemoEnforcementMiddleware({mode, ...})`:
 *
 *      - `requireNotDemo`: si `is_demo:true` y método es write
 *        (POST/PUT/PATCH/DELETE) → 403. GET/HEAD/OPTIONS pasan
 *        (read-only safe).
 *
 *      - `requireNotDemoOrSandbox`: si `is_demo:true` y persona !=
 *        `stakeholder` → 403. Stakeholder es read-only por contrato
 *        (ADR-034 sustainability stakeholder); demo-stakeholder es
 *        sandbox legítima.
 *
 *      - `explicitAllow`: si `is_demo:true` y `(path, method)` matchea
 *        entry en allowlist → passthrough; else → 403. Default-deny.
 *
 *   2. Response 403: `{error:'forbidden_demo', code:'forbidden_demo'}`.
 *      Shape estable para frontend handling y para
 *      `auth.is_demo.blocked` metric label (T4).
 *
 *   3. T1 NO emite structured log on block — eso entra en T4 con la
 *      log-based metric. T1 ships scaffolding sin observability footprint
 *      activo (interrupt-safe: T1 mergeado sin wire = 0 impacto runtime).
 *
 * Wire: per-group en `server.ts` post-`firebaseAuthMiddleware` per spec
 * v3.4 amendment A1 (SC-1.3.2). T3 lo aplica a ~20 mount points.
 */

export type IsDemoEnforcementMode = 'requireNotDemo' | 'requireNotDemoOrSandbox' | 'explicitAllow';

export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Entry de allowlist consumido por mode `explicitAllow`. La forma viene de
 * `is-demo-allowlist.ts` (T2a) — duplicada acá como tipo para que el
 * middleware no dependa del archivo allowlist (mantiene el módulo
 * testeable en aislamiento). `is-demo-allowlist.ts` la re-exporta.
 */
export interface IsDemoAllowlistEntry {
  path: string;
  methods: HttpMethod[];
  /** Razón por la que `is_demo:true` puede acceder a este path. */
  rationale: string;
  /** ISO date (YYYY-MM-DD) hasta la cual la entry es válida sin re-review. */
  reviewBy: string;
}

export interface IsDemoEnforcementOptions {
  mode: IsDemoEnforcementMode;
  /** Solo consumido si `mode === 'explicitAllow'`. Default `[]`. */
  allowlist?: IsDemoAllowlistEntry[];
  logger: Logger;
}

const FORBIDDEN_RESPONSE = { error: 'forbidden_demo', code: 'forbidden_demo' } as const;
const IDEMPOTENT_SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const STAKEHOLDER_PERSONA = 'stakeholder';

function isDemoTrueClaim(claims: FirebaseClaims | undefined): boolean {
  if (!claims) {
    return false;
  }
  const custom = claims.custom as Record<string, unknown> | undefined;
  return Boolean(custom && custom.is_demo === true);
}

function personaFromClaims(claims: FirebaseClaims): string | undefined {
  const custom = claims.custom as Record<string, unknown>;
  const persona = custom.persona;
  return typeof persona === 'string' ? persona : undefined;
}

function isAllowlisted(allowlist: IsDemoAllowlistEntry[], path: string, method: string): boolean {
  for (const entry of allowlist) {
    if (entry.path === path && entry.methods.includes(method as HttpMethod)) {
      return true;
    }
  }
  return false;
}

export function createIsDemoEnforcementMiddleware(
  opts: IsDemoEnforcementOptions,
): MiddlewareHandler {
  const allowlist = opts.allowlist ?? [];

  return async function isDemoEnforcement(c, next) {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;

    if (!isDemoTrueClaim(claims)) {
      await next();
      return;
    }

    const method = c.req.method.toUpperCase();
    const path = c.req.path;

    switch (opts.mode) {
      case 'requireNotDemo': {
        if (IDEMPOTENT_SAFE_METHODS.has(method)) {
          await next();
          return;
        }
        return c.json(FORBIDDEN_RESPONSE, 403);
      }
      case 'requireNotDemoOrSandbox': {
        const persona = personaFromClaims(claims as FirebaseClaims);
        if (persona === STAKEHOLDER_PERSONA) {
          await next();
          return;
        }
        return c.json(FORBIDDEN_RESPONSE, 403);
      }
      case 'explicitAllow': {
        if (isAllowlisted(allowlist, path, method)) {
          await next();
          return;
        }
        return c.json(FORBIDDEN_RESPONSE, 403);
      }
      default: {
        const _exhaustive: never = opts.mode;
        return _exhaustive;
      }
    }
  };
}
