import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { tieneAccesoPlataforma } from '../auth/acceso-plataforma.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { UserContext } from '../services/user-context.js';
import type { FirebaseClaims } from './firebase-auth.js';

/**
 * impersonation-write-guard middleware (Hono) — impersonación auditada.
 *
 * Enforcement de authorization
 * (NO auth) sobre el custom claim `impersonated_by`. Asume que
 * `firebaseAuthMiddleware` ya verificó el token y publicó `firebaseClaims`, y
 * — donde aplica — que `userContextMiddleware` resolvió `userContext`.
 *
 * Decisión SELLADA con el PO:
 *   - Sesión impersonada = el custom claim `impersonated_by` está presente
 *     (lo emite el endpoint `POST /auth/impersonate` sobre el UID del target).
 *   - Puede LEER cualquier empresa del target: GET/HEAD/OPTIONS passthrough.
 *   - Solo puede ESCRIBIR (POST/PUT/PATCH/DELETE) cuando la empresa activa
 *     (`userContext.activeMembership.empresa.isTestUser` = `es_usuario_prueba`)
 *     es de usuarios de prueba (ADR-053).
 *   - Empresa real (o sin empresa activa resoluble) + método
 *     mutante → 403. **Fail-closed**: si no se puede confirmar
 *     `es_usuario_prueba`, se bloquea. Esto cubre rutas user-level sin
 *     userContext (p.ej. `/me` raíz — cambiar la clave del target mientras se
 *     impersona debe bloquearse).
 *   - Sesión normal (sin `impersonated_by`) → passthrough SIEMPRE: no toca la
 *     escritura de usuarios reales.
 *   - La impersonación vale mientras quien impersona tenga acceso al panel
 *     (`.specs/bordes-autenticacion` SC4): en cada request impersonada, de
 *     lectura o de escritura, se lee a quien impersona y se le aplica la regla
 *     única de acceso (`auth/acceso-plataforma.ts`). Si ya no la cumple, no
 *     existe o el claim no es un id válido → 401 `impersonation_revoked`. Una
 *     sesión normal no consulta nada.
 *
 * Atribución: emite un log estructurado con `impersonated_by` en CADA mutación
 * impersonada — bloqueada (`auth.impersonation.write_blocked`) o permitida
 * sobre empresa de prueba (`auth.impersonation.write_allowed`) — para que toda
 * mutación impersonada sea atribuible al admin en Cloud Logging.
 *
 * Wire: per-group en `server.ts`, DESPUÉS de `userContextMiddleware` (necesita
 * `activeMembership.empresa.isTestUser` para permitir escrituras). En grupos
 * sin userContext se monta post-firebase-auth y bloquea toda mutación
 * impersonada (fail-closed). La cobertura la garantiza el CI gate
 * `check-impersonation-wire-completeness.ts`.
 */

const FORBIDDEN_RESPONSE = {
  error: 'forbidden_impersonation_write',
  code: 'forbidden_impersonation_write',
} as const;
const REVOKED_RESPONSE = { error: 'unauthorized', code: 'impersonation_revoked' } as const;
const REVOKED_LOG_EVENT = 'auth.impersonation.revoked';
const adminIdSchema = z.string().uuid();
const IDEMPOTENT_SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

const BLOCKED_LOG_EVENT = 'auth.impersonation.write_blocked';
const ALLOWED_LOG_EVENT = 'auth.impersonation.write_allowed';

export interface ImpersonationWriteGuardOptions {
  logger: Logger;
  /** Para volver a leer a quien impersona en cada request impersonada. */
  db: Db;
  /** `config.BOOSTER_PLATFORM_ADMIN_EMAILS`: la lista de respaldo. */
  platformAdminEmails: readonly string[];
}

/**
 * Devuelve el admin que impersona (string no vacío) o null si la sesión no es
 * impersonada. El claim solo RESTRINGE (nunca otorga), así que es seguro
 * confiar en él para el guard: un cliente que forjara `impersonated_by` solo
 * lograría auto-bloquearse sus propias escrituras.
 */
function impersonatedBy(claims: FirebaseClaims | undefined): string | null {
  if (!claims) {
    return null;
  }
  const custom = claims.custom as Record<string, unknown> | undefined;
  const value = custom?.impersonated_by;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractCorrelationId(headerValue: string | undefined): string {
  if (!headerValue) {
    return 'unknown';
  }
  const traceId = headerValue.split('/')[0];
  return traceId && traceId.length > 0 ? traceId : 'unknown';
}

export function createImpersonationWriteGuardMiddleware(
  opts: ImpersonationWriteGuardOptions,
): MiddlewareHandler {
  return async function impersonationWriteGuard(c, next) {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    const admin = impersonatedBy(claims);

    // Sesión normal: passthrough absoluto (no tocar escritura de users reales).
    if (!admin) {
      await next();
      return;
    }

    // Quien impersona tiene que seguir con acceso al panel (SC4).
    const adminId = adminIdSchema.safeParse(admin);
    const filas = adminId.success
      ? // rls-allowlist: lookup del admin que impersona, por su id; no es dato de empresa.
        await opts.db
          .select({
            email: users.email,
            isPlatformAdmin: users.isPlatformAdmin,
            status: users.status,
          })
          .from(users)
          .where(eq(users.id, adminId.data))
          .limit(1)
      : [];
    const impersonador = filas[0];
    if (!impersonador || !tieneAccesoPlataforma(impersonador, opts.platformAdminEmails)) {
      opts.logger.warn(
        {
          event: REVOKED_LOG_EVENT,
          correlationId: extractCorrelationId(c.req.header('x-cloud-trace-context')),
          uid: claims?.uid ?? 'unknown',
          impersonated_by: admin,
          path: c.req.path,
        },
        'impersonation session revoked: the admin no longer has panel access',
      );
      return c.json(REVOKED_RESPONSE, 401);
    }

    const method = c.req.method.toUpperCase();

    // Lecturas: cualquier empresa del target (read-only safe).
    if (IDEMPOTENT_SAFE_METHODS.has(method)) {
      await next();
      return;
    }

    const path = c.req.path;
    const correlationId = extractCorrelationId(c.req.header('x-cloud-trace-context'));
    const uid = claims?.uid ?? 'unknown';

    const userContext = c.get('userContext') as UserContext | undefined;
    const empresa = userContext?.activeMembership?.empresa;
    // DESACOPLE ADR-053: la escritura impersonada se autoriza SOLO sobre
    // empresas `es_usuario_prueba` (una empresa real de cliente → bloqueada). Ver
    // .specs/impersonacion-auditada/findings.md.
    const empresaIsTestUser = empresa?.isTestUser === true;

    if (!empresaIsTestUser) {
      // Fail-closed: empresa no-prueba o no resoluble →
      // bloquear la mutación.
      opts.logger.warn(
        {
          event: BLOCKED_LOG_EVENT,
          correlationId,
          uid,
          impersonated_by: admin,
          empresa_id: empresa?.id ?? null,
          path,
          method,
        },
        'impersonation write blocked',
      );
      return c.json(FORBIDDEN_RESPONSE, 403);
    }

    // Escritura permitida sobre empresa de usuarios de prueba: se audita.
    opts.logger.info(
      {
        event: ALLOWED_LOG_EVENT,
        correlationId,
        uid,
        impersonated_by: admin,
        empresa_id: empresa?.id ?? null,
        path,
        method,
      },
      'impersonation write allowed on test-user empresa',
    );
    await next();
    return;
  };
}
