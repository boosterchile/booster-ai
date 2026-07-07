import { createLogger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { solicitudesRegistro, users } from '../../src/db/schema.js';
import { createAdminSignupRequestsRoutes } from '../../src/routes/admin-signup-requests.js';
import { createAuthUniversalRoutes } from '../../src/routes/auth-universal.js';
import {
  NotInAllowlistError,
  RutConflictError,
  RutImmutableError,
  bootstrapPlatformAdmin,
} from '../../src/services/bootstrap-platform-admin.js';
import { verifyClaveNumerica } from '../../src/services/clave-numerica.js';
import { LoggingSignupRequestNotifier } from '../../src/services/notifications/signup-request-email.js';
import { resolveUserContext } from '../../src/services/user-context.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Gap A (diagnóstico alta de usuarios §7, hito CORFO) — bootstrap reproducible
 * del platform admin. `.specs/bootstrap-platform-admin/spec.md`.
 *
 * Materializa los criterios de éxito 1-3 de la spec contra código REAL:
 * Postgres real (TEST_DATABASE_URL + migraciones de globalSetup), Drizzle
 * real, scrypt real, rutas Hono reales (`createAuthUniversalRoutes`,
 * `createAdminSignupRequestsRoutes`) y `resolveUserContext` real.
 *
 * **Único doble declarado**: Firebase `Auth` es un stub in-memory (mismo
 * patrón `as unknown as Auth` de `admin-signup-requests.test.ts:33`). El
 * middleware de idToken se sustituye por un shim que inyecta el uid vía
 * header `x-test-uid` y resuelve el contexto con el `resolveUserContext`
 * REAL — el gate `requirePlatformAdmin` (allowlist) es el de producción.
 * El tramo Firebase real (createCustomToken/verifyIdToken vivos) lo cubre
 * el smoke de prod del Workstream 3; test con Auth emulator = hardening
 * fechado (spec §Riesgos).
 */

// Flags que las rutas admin leen del singleton `config` en import-time.
// vi.hoisted corre ANTES de los imports estáticos de este archivo (y los
// setupFiles ya corrieron), así que el módulo config parsea ESTOS valores.
// pool 'forks' + isolate default ⇒ proceso propio por archivo: no contamina
// el config de otras suites integration.
vi.hoisted(() => {
  process.env.SIGNUP_REQUEST_FLOW_ACTIVATED = 'true';
  process.env.ADMIN_PROVISIONED_ONBOARDING_ENABLED = 'true';
  process.env.ONBOARDING_TOKEN_SIGNING_SECRET = 'integration-bootstrap-admin-secret-0123456789';
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'bootstrap-admin-it@boosterchile.com';
});

const logger = createLogger({
  service: 'bootstrap-platform-admin-integration',
  version: '0',
  level: 'silent',
  pretty: false,
});

const ALLOWLIST = ['bootstrap-admin-it@boosterchile.com'];

const ADMIN_INPUT = {
  email: 'bootstrap-admin-it@boosterchile.com',
  fullName: 'Admin Bootstrap IT',
  // Formato "sucio" a propósito: el service debe canonicalizar a 11111111-1
  // (sin puntos, guión, K mayúscula) — la MISMA forma que login-rut busca.
  rut: '11.111.111-1',
  clave: '654321',
};

const RUT_CANONICO = '11111111-1';

/**
 * Stub in-memory del subset de `Auth` que usan el service (getUserByEmail/
 * createUser), el route login-rut (createCustomToken) y el approve
 * (createUser del solicitante). Los errores replican los `code` reales del
 * Admin SDK que el código de producción inspecciona.
 */
function makeAuthStub() {
  const byEmail = new Map<string, { uid: string; email: string; displayName?: string }>();
  let seq = 0;
  const stub = {
    getUserByEmail: vi.fn(async (email: string) => {
      const found = byEmail.get(email);
      if (!found) {
        throw Object.assign(new Error(`no user for ${email}`), { code: 'auth/user-not-found' });
      }
      return found;
    }),
    createUser: vi.fn(async (props: { email: string; displayName?: string }) => {
      if (byEmail.has(props.email)) {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      }
      seq += 1;
      const user = { uid: `fb-uid-${seq}`, email: props.email, displayName: props.displayName };
      byEmail.set(props.email, user);
      return user;
    }),
    createCustomToken: vi.fn(async (uid: string) => `custom-token:${uid}`),
  };
  return { auth: stub as unknown as Auth, stub };
}

describe('integration: bootstrap-platform-admin (Gap A, spec criterios 1-3)', () => {
  let dbHandle: TestDbHandle;

  beforeAll(() => {
    dbHandle = createTestDb();
  });

  afterAll(async () => {
    await dbHandle?.pool.end();
  });

  beforeEach(async () => {
    await dbHandle.pool.query('DELETE FROM solicitudes_registro');
    await dbHandle.pool.query(
      "DELETE FROM usuarios WHERE email LIKE '%-it@boosterchile.com' OR email LIKE '%-it@example.com'",
    );
  });

  // -------------------------------------------------------------------------
  // Criterio 1a — desde cero: crea Firebase user + fila usuarios operable.
  // -------------------------------------------------------------------------
  it('desde cero: crea cuenta Firebase y fila usuarios con RUT canónico + clave scrypt verificable', async () => {
    const { auth } = makeAuthStub();

    const result = await bootstrapPlatformAdmin({
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
      input: ADMIN_INPUT,
    });

    expect(result.firebase).toBe('created');
    expect(result.user).toBe('created');

    const rows = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email))
      .limit(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    expect(row.rut).toBe(RUT_CANONICO);
    expect(row.isPlatformAdmin).toBe(true);
    expect(row.status).toBe('activo');
    expect(row.firebaseUid).toBe(result.firebaseUid);
    expect(row.claveNumericaHash).not.toBeNull();
    expect(verifyClaveNumerica(ADMIN_INPUT.clave, row.claveNumericaHash ?? '')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Criterio 1b — el binario del PO: tras el bootstrap, el admin autentica
  // por el contrato de LoginUniversal (login-rut 200 + custom_token) y pasa
  // requirePlatformAdmin real para aprobar una solicitud sembrada.
  // -------------------------------------------------------------------------
  it('cadena real: login-rut 200 con RUT+clave → requirePlatformAdmin pasa → approve 200 con onboarding_link', async () => {
    const { auth } = makeAuthStub();

    await bootstrapPlatformAdmin({
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
      input: ADMIN_INPUT,
    });

    // App con las rutas REALES. Shim declarado: x-test-uid reemplaza el
    // round-trip signInWithCustomToken→idToken→verifyIdToken; el contexto
    // se resuelve con resolveUserContext REAL (fila BD) y el gate de
    // allowlist dentro del route es el de producción.
    const app = new Hono();
    app.route(
      '/auth',
      createAuthUniversalRoutes({
        db: dbHandle.db,
        firebaseAuth: auth,
        logger,
        rateLimitLogin: async (_c, next) => {
          await next();
        },
      }),
    );
    app.use('/admin/*', async (c, next) => {
      const uid = c.req.header('x-test-uid');
      if (uid) {
        c.set(
          'userContext',
          await resolveUserContext({
            db: dbHandle.db,
            firebaseUid: uid,
            requestedEmpresaId: undefined,
          }),
        );
      }
      await next();
    });
    app.route(
      '/admin/signup-requests',
      createAdminSignupRequestsRoutes({
        db: dbHandle.db,
        logger,
        auth,
        notifier: new LoggingSignupRequestNotifier(logger),
      }),
    );

    // 1. Login por el contrato exacto de LoginUniversal.
    const loginRes = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: RUT_CANONICO, clave: ADMIN_INPUT.clave, tipo: 'booster' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { custom_token: string };
    expect(loginBody.custom_token).toMatch(/^custom-token:/);
    const uid = loginBody.custom_token.replace('custom-token:', '');

    // 2. Sembrar una solicitud pendiente (mismo INSERT del service público).
    const inserted = await dbHandle.db
      .insert(solicitudesRegistro)
      .values({ email: 'piloto-smoke-it@example.com', nombreCompleto: 'Piloto Smoke IT' })
      .returning({ id: solicitudesRegistro.id });
    const solicitudId = inserted[0]?.id;
    expect(solicitudId).toBeDefined();

    // 3. Approve con la sesión del admin bootstrapeado.
    const approveRes = await app.request(`/admin/signup-requests/${solicitudId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-uid': uid },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as {
      ok: boolean;
      outcome: string;
      onboarding_link?: string;
    };
    expect(approveBody.ok).toBe(true);
    expect(approveBody.outcome).toBe('approved');
    // Flag admin-provisioned ON + secret presente ⇒ link one-shot emitido.
    expect(approveBody.onboarding_link).toContain('token=');
  });

  // -------------------------------------------------------------------------
  // Criterio 2 — idempotencia: segunda corrida idéntica no escribe nada.
  // -------------------------------------------------------------------------
  it('idempotencia: segunda corrida con la misma entrada → unchanged, cero escrituras', async () => {
    const { auth } = makeAuthStub();
    const opts = {
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
      input: ADMIN_INPUT,
    };

    await bootstrapPlatformAdmin(opts);
    const before = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email))
      .limit(1);

    const second = await bootstrapPlatformAdmin(opts);
    expect(second.firebase).toBe('existing');
    expect(second.user).toBe('unchanged');

    const after = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email))
      .limit(1);
    expect(after[0]?.claveNumericaHash).toBe(before[0]?.claveNumericaHash);
    expect(after[0]?.updatedAt?.toISOString()).toBe(before[0]?.updatedAt?.toISOString());
  });

  // -------------------------------------------------------------------------
  // Criterio 3 — aborts no destructivos.
  // -------------------------------------------------------------------------
  it('aborta si el RUT pertenece a OTRO usuario, sin escribir nada', async () => {
    const { auth, stub } = makeAuthStub();
    await dbHandle.db.insert(users).values({
      firebaseUid: 'fb-uid-otro',
      email: 'otro-usuario-it@boosterchile.com',
      fullName: 'Otro Usuario IT',
      rut: '12345678-5',
      status: 'activo',
      isPlatformAdmin: false,
    });

    await expect(
      bootstrapPlatformAdmin({
        db: dbHandle.db,
        firebaseAuth: auth,
        logger,
        allowlist: [...ALLOWLIST],
        input: { ...ADMIN_INPUT, rut: '12345678-5' },
      }),
    ).rejects.toThrow(RutConflictError);

    const adminRows = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email));
    expect(adminRows).toHaveLength(0);
    // El abort ocurre en la fase BD: la cuenta Firebase puede haberse creado
    // antes (mismo orden Firebase→BD del approve de producción); lo que NO
    // puede pasar es una fila usuarios a medias.
    expect(stub.createUser).toHaveBeenCalledTimes(1);
  });

  it('aborta si la fila ya declara un RUT distinto (inmutabilidad, espejo de /me/profile)', async () => {
    const { auth } = makeAuthStub();
    await bootstrapPlatformAdmin({
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
      input: ADMIN_INPUT,
    });

    await expect(
      bootstrapPlatformAdmin({
        db: dbHandle.db,
        firebaseAuth: auth,
        logger,
        allowlist: ALLOWLIST,
        input: { ...ADMIN_INPUT, rut: '12345678-5' },
      }),
    ).rejects.toThrow(RutImmutableError);

    const rows = await dbHandle.db
      .select({ rut: users.rut })
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email));
    expect(rows[0]?.rut).toBe(RUT_CANONICO);
  });

  it('aborta si el email no está en la allowlist, sin tocar Firebase ni BD', async () => {
    const { auth, stub } = makeAuthStub();

    await expect(
      bootstrapPlatformAdmin({
        db: dbHandle.db,
        firebaseAuth: auth,
        logger,
        allowlist: ALLOWLIST,
        input: { ...ADMIN_INPUT, email: 'intruso-it@boosterchile.com' },
      }),
    ).rejects.toThrow(NotInAllowlistError);

    expect(stub.createUser).not.toHaveBeenCalled();
    const rows = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.email, 'intruso-it@boosterchile.com'));
    expect(rows).toHaveLength(0);
  });

  it('clave existente: no-op sin rotateClave; reemplaza solo con rotateClave explícito', async () => {
    const { auth } = makeAuthStub();
    const base = {
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
    };
    await bootstrapPlatformAdmin({ ...base, input: ADMIN_INPUT });

    // Sin rotateClave: la clave distinta NO se aplica.
    await bootstrapPlatformAdmin({ ...base, input: { ...ADMIN_INPUT, clave: '111222' } });
    let rows = await dbHandle.db
      .select({ hash: users.claveNumericaHash })
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email));
    expect(verifyClaveNumerica(ADMIN_INPUT.clave, rows[0]?.hash ?? '')).toBe(true);
    expect(verifyClaveNumerica('111222', rows[0]?.hash ?? '')).toBe(false);

    // Con rotateClave: reemplaza.
    await bootstrapPlatformAdmin({
      ...base,
      input: { ...ADMIN_INPUT, clave: '111222', rotateClave: true },
    });
    rows = await dbHandle.db
      .select({ hash: users.claveNumericaHash })
      .from(users)
      .where(eq(users.email, ADMIN_INPUT.email));
    expect(verifyClaveNumerica('111222', rows[0]?.hash ?? '')).toBe(true);
    expect(verifyClaveNumerica(ADMIN_INPUT.clave, rows[0]?.hash ?? '')).toBe(false);
  });

  it('dry-run: reporta acciones sin escribir en Firebase ni BD', async () => {
    const { auth, stub } = makeAuthStub();

    const result = await bootstrapPlatformAdmin({
      db: dbHandle.db,
      firebaseAuth: auth,
      logger,
      allowlist: ALLOWLIST,
      input: { ...ADMIN_INPUT, dryRun: true },
    });

    expect(result.dryRun).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(stub.createUser).not.toHaveBeenCalled();
    const rows = await dbHandle.db.select().from(users).where(eq(users.email, ADMIN_INPUT.email));
    expect(rows).toHaveLength(0);
  });
});
