import type { IsDemoAllowlistEntry } from './is-demo-enforcement.js';

/**
 * T2a SEC-001 Sprint 2b — allowlist canónica para mode `explicitAllow`
 * del middleware `is-demo-enforcement`.
 *
 * Cada entry representa un (path, method) que **debe ser accesible** para
 * sesiones con claim `is_demo:true`. Default es deny — si una request no
 * matchea ninguna entry, retorna 403 `forbidden_demo`.
 *
 * Reglas para nuevas entries (validadas por CI gate T2b `T6c` +
 * `T6d`):
 *   1. `rationale` non-empty con razón clara por qué demo session puede
 *      acceder a este path.
 *   2. `reviewBy` formato `YYYY-MM-DD` con fecha en futuro (≤90 días por
 *      defecto). Re-review obligatoria al expirar.
 *   3. Modificar este archivo en un PR requiere el guard CI T6d que
 *      verifica que la entry nueva trae justificación inline.
 *
 * Sprint 2b shipping path:
 *   - T2a (este archivo): array vacío inicial.
 *   - T3: populated con entries iniciales (`POST /demo/login`,
 *         `POST /demo/cache-warm/:persona`, `GET /feature-flags`,
 *         `POST /api/v1/signup-request` preempty para T8) — cada una
 *         con `rationale` + `reviewBy` +90d.
 */

export type { IsDemoAllowlistEntry } from './is-demo-enforcement.js';

export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale:
      'demo login endpoint mintea custom token Firebase para personas demo; sesión demo requiere este path por diseño (no auth previa, no claim is_demo)',
    reviewBy: '2026-08-25',
  },
  {
    path: '/api/v1/demo/cache-warm/:persona',
    methods: ['POST'],
    rationale:
      'Sprint 2a T5 pre-warm cache fire-and-forget desde landing demo (rate-limited 10/min/IP, sin firebase auth, sin claim is_demo); preempty defense',
    reviewBy: '2026-08-25',
  },
  {
    path: '/feature-flags',
    methods: ['GET'],
    rationale:
      'flags fetch read-only boot path para decidir UI (selector RUT vs email/password); público sin firebase auth, sin claim is_demo; preempty defense',
    reviewBy: '2026-08-25',
  },
  {
    path: '/api/v1/signup-request',
    methods: ['POST'],
    rationale:
      'Sprint 2b T8 signup-request endpoint público sin auth previa (admin-approval flow ADR-052); sin claim is_demo, preempty defense para evitar 403 si wire global aplica',
    reviewBy: '2026-08-25',
  },
];
