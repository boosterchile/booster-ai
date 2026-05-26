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

export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [];
