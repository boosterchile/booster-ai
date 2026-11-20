import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { pgErrorCode } from '../../src/db/pg-error.js';
import * as schema from '../../src/db/schema.js';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { hashActivationPin } from '../../src/services/activation-pin.js';
import { hashClaveNumerica } from '../../src/services/clave-numerica.js';
import type { EmailMessage, EmailSender } from '../../src/services/notifications/email-sender.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T7 de `.specs/confirmar-acceso-booster/spec.md` (SC15): la confirmación del
 * acceso al panel contra Postgres real.
 *
 *   1. Persona con clave y membresía en una empresa → sin acceso (403).
 *   2. `POST /admin/personal-booster`              → código de confirmación,
 *                                                     sin marca ni correo.
 *   3. Sigue sin acceso; la lista la muestra por confirmar.
 *   4. Impersonando, la confirmación se bloquea.
 *   5. «Generar código nuevo»                       → el anterior deja de servir.
 *   6. `POST /me/confirmar-acceso-booster`          → marcada; `/me` en true y
 *                                                     `/admin/*` en 200; aviso.
 *   7. Cinco códigos malos dejan la confirmación sin uso; un código vencido no
 *      sirve; quitar acceso de una persona por confirmar borra su código.
 *   8. En paralelo (SC6, SC10): un código se consume una sola vez, los intentos
 *      cuentan todos, y la baja y la re-emisión esperan la fila de la cuenta.
 *
 * La lista de respaldo tiene solo al admin; las personas entran por la marca.
 * `requirePlatformAdmin` y `/me` leen la lista de `config` al importar (por
 * eso el env se fija en `vi.hoisted`). El middleware de idToken se reemplaza
 * por un shim que toma el uid del header `x-test-uid` (y `impersonated_by` de
 * `x-test-impersonado-por`); userContext, el guard de impersonación y el gate
 * del panel son los reales.
 */

const ADMIN_EMAIL = 'admin-confirmar-it@test.invalid';
const LISTA = [ADMIN_EMAIL];

vi.hoisted(() => {
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'admin-confirmar-it@test.invalid';
});

function senderEnMemoria() {
  const enviados: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(msg) {
      enviados.push(msg);
      return { enviado: true, id: `m-${enviados.length}` };
    },
  };
  return { sender, enviados };
}

async function cargarRutas() {
  const [personal, confirmar, me, userContext, guard] = await Promise.all([
    import('../../src/routes/admin-personal-booster.js'),
    import('../../src/routes/me-confirmar-acceso-booster.js'),
    import('../../src/routes/me.js'),
    import('../../src/middleware/user-context.js'),
    import('../../src/middleware/impersonation-write-guard.js'),
  ]);
  return {
    createAdminPersonalBoosterRoutes: personal.createAdminPersonalBoosterRoutes,
    createMeConfirmarAccesoBoosterRoutes: confirmar.createMeConfirmarAccesoBoosterRoutes,
    createMeRoutes: me.createMeRoutes,
    createUserContextMiddleware: userContext.createUserContextMiddleware,
    createImpersonationWriteGuardMiddleware: guard.createImpersonationWriteGuardMiddleware,
  };
}

/** Un código de 6 dígitos distinto del dado. */
function otroCodigo(codigo: string): string {
  return String((Number(codigo) + 1) % 1_000_000).padStart(6, '0');
}

describe('integration: la persona confirma desde su sesión el acceso al panel', () => {
  let handle: TestDbHandle;
  /**
   * Pool propio para las requests en paralelo: el de `createTestDb` tiene dos
   * conexiones, y una queda tomada por la transacción que se deja en curso.
   */
  let poolConcurrente: pg.Pool;
  let dbConcurrente: Db;
  let rutas: Awaited<ReturnType<typeof cargarRutas>>;
  let correo: ReturnType<typeof senderEnMemoria>;
  let adminUid = '';
  let adminId = '';
  let empresaId = '';
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as never;

  async function crearEmpresa() {
    const s = randomUUID().slice(0, 6);
    await handle.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'p', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await handle.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.slug, 'gratis'));
    const [empresa] = await handle.db
      .insert(schema.empresas)
      .values({
        legalName: `Empresa confirmar ${s}`,
        rut: rutAleatorio(),
        contactEmail: `confirmar-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: true,
        status: 'activa',
        planId: plan?.id ?? '',
      })
      .returning();
    if (!empresa) {
      throw new Error('fixture: empresa');
    }
    return empresa.id;
  }

  type Vinculo = 'membresia_activa' | 'membresia_removida' | 'conductor' | 'ninguno';

  /** Persona con clave propia (cuenta activa) y el vínculo pedido con la empresa. */
  async function crearPersonaActiva(tag: string, vinculo: Vinculo) {
    const s = randomUUID().slice(0, 8);
    const [u] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-${tag}-${s}`,
        email: `${tag}-${s}@test.invalid`,
        fullName: `Persona ${tag}`,
        rut: rutAleatorio(),
        claveNumericaHash: hashClaveNumerica('583920'),
        status: 'activo',
      })
      .returning();
    if (!u) {
      throw new Error('fixture: persona');
    }
    if (vinculo === 'membresia_activa' || vinculo === 'membresia_removida') {
      await handle.db.insert(schema.memberships).values({
        userId: u.id,
        empresaId,
        role: 'despachador',
        status: vinculo === 'membresia_activa' ? 'activa' : 'removida',
        joinedAt: new Date(),
      });
    }
    if (vinculo === 'conductor') {
      await handle.db.insert(schema.conductores).values({
        userId: u.id,
        empresaId,
        licenseClass: 'A4',
        licenseNumber: `L${s}`,
        licenseExpiry: '2028-09-22',
      });
    }
    return u;
  }

  beforeAll(async () => {
    handle = createTestDb();
    poolConcurrente = new pg.Pool({ connectionString: handle.url, max: 10 });
    dbConcurrente = drizzle(poolConcurrente, { schema });
    rutas = await cargarRutas();
    correo = senderEnMemoria();
    adminUid = `fb-admin-${randomUUID().slice(0, 8)}`;
    const [admin] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: adminUid,
        email: ADMIN_EMAIL,
        fullName: 'Admin Plataforma',
        isPlatformAdmin: true,
        status: 'activo',
      })
      .onConflictDoUpdate({ target: schema.users.email, set: { firebaseUid: adminUid } })
      .returning();
    adminId = admin?.id ?? '';
    empresaId = await crearEmpresa();
  });
  afterAll(async () => {
    await poolConcurrente.end();
    await handle.pool.end();
  });

  function app(db: Db = handle.db) {
    // Shim del idToken: el uid y la impersonación viajan en headers.
    const sesion: MiddlewareHandler = async (c, next) => {
      const uid = c.req.header('x-test-uid');
      if (!uid) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const impersonador = c.req.header('x-test-impersonado-por');
      const claims: FirebaseClaims = {
        uid,
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: impersonador ? { impersonated_by: impersonador } : {},
      };
      c.set('firebaseClaims', claims);
      await next();
    };
    const userContext = rutas.createUserContextMiddleware({ db, logger });
    const guard = rutas.createImpersonationWriteGuardMiddleware({
      logger,
      db,
      platformAdminEmails: LISTA,
    });
    const a = new Hono();
    // Mismo orden que server.ts: en /me el guard corre antes del userContext.
    a.use('/admin/*', sesion, userContext, guard);
    a.use('/me', sesion, guard);
    a.use('/me/*', sesion, guard);
    a.use('/me/confirmar-acceso-booster', userContext);
    a.route(
      '/admin/personal-booster',
      rutas.createAdminPersonalBoosterRoutes({
        db,
        logger,
        platformAdminEmails: LISTA,
        emailSender: correo.sender,
        webAppUrl: 'https://app.test.invalid',
      }),
    );
    const me = rutas.createMeRoutes({ db, logger });
    me.route(
      '/confirmar-acceso-booster',
      rutas.createMeConfirmarAccesoBoosterRoutes({
        db,
        logger,
        platformAdminEmails: LISTA,
        emailSender: correo.sender,
        webAppUrl: 'https://app.test.invalid',
      }),
    );
    a.route('/me', me);
    return a;
  }

  function req(method: string, body: unknown, uid?: string, extra: Record<string, string> = {}) {
    return {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(uid ? { 'x-test-uid': uid } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  /** Alta en el panel del personal; por defecto la hace el admin de la lista. */
  async function alta(p: { email: string; fullName: string; rut: string | null }, uid = adminUid) {
    const res = await app().request(
      '/admin/personal-booster',
      req('POST', { email: p.email, full_name: p.fullName, rut: p.rut }, uid),
    );
    const body = (await res.json()) as {
      user_id: string;
      vinculo: string;
      codigo_activacion: string | null;
      expira_en: string | null;
    };
    return { status: res.status, body };
  }

  function confirmar(uid: string, codigo: string, extra: Record<string, string> = {}) {
    return app().request('/me/confirmar-acceso-booster', req('POST', { codigo }, uid, extra));
  }

  /** La misma confirmación, por el pool de las requests en paralelo. */
  function confirmarEnParalelo(uid: string, codigo: string) {
    return app(dbConcurrente).request('/me/confirmar-acceso-booster', req('POST', { codigo }, uid));
  }

  function quitarAccesoEnParalelo(userId: string) {
    return app(dbConcurrente).request(
      `/admin/personal-booster/${userId}/quitar-acceso`,
      req('POST', undefined, adminUid),
    );
  }

  /** Espera a que alguna sesión de la base esté esperando un bloqueo. */
  async function esperarBloqueo() {
    const limite = Date.now() + 5_000;
    for (;;) {
      const r = await handle.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      );
      if (Number(r.rows[0]?.n ?? '0') > 0) {
        return;
      }
      if (Date.now() > limite) {
        throw new Error('ninguna request llegó a esperar un bloqueo');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Deja en curso una transacción con los pasos dados (sin commit), lanza la
   * request, espera a que quede esperando un bloqueo, comitea y devuelve la
   * respuesta.
   */
  async function conTransaccionEnCurso(
    pasos: (cliente: pg.PoolClient) => Promise<void>,
    request: () => Promise<Response>,
  ): Promise<Response> {
    const cliente = await handle.pool.connect();
    try {
      await cliente.query('BEGIN');
      await pasos(cliente);
      const respuesta = request();
      await esperarBloqueo();
      await cliente.query('COMMIT');
      return await respuesta;
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    } finally {
      cliente.release();
    }
  }

  /** La persona confirma su código: bloquea su cuenta y su confirmación, consume y marca. */
  async function confirmacionEnCurso(cliente: pg.PoolClient, userId: string) {
    await cliente.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [userId]);
    await cliente.query(
      'SELECT id FROM confirmaciones_acceso_booster WHERE usuario_id = $1 AND consumido_en IS NULL FOR UPDATE',
      [userId],
    );
    await cliente.query(
      'UPDATE confirmaciones_acceso_booster SET consumido_en = now() WHERE usuario_id = $1 AND consumido_en IS NULL',
      [userId],
    );
    await cliente.query('UPDATE usuarios SET es_admin_plataforma = true WHERE id = $1', [userId]);
  }

  /**
   * Un admin emite otro código: bloquea la cuenta, borra la pendiente e inserta
   * la nueva. `emisorId` es quien lo emite (por defecto, el admin marcado).
   */
  async function reemisionEnCurso(
    cliente: pg.PoolClient,
    userId: string,
    codigo: string,
    emisorId: string = adminId,
  ) {
    await cliente.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [userId]);
    await cliente.query(
      'DELETE FROM confirmaciones_acceso_booster WHERE usuario_id = $1 AND consumido_en IS NULL',
      [userId],
    );
    await cliente.query(
      "INSERT INTO confirmaciones_acceso_booster (usuario_id, codigo_hash, vence_en, emitido_por_usuario_id) VALUES ($1, $2, now() + interval '24 hours', $3)",
      [userId, hashActivationPin(codigo), emisorId],
    );
  }

  /**
   * Un admin que entra solo por la lista de respaldo: su cuenta no está
   * marcada, así que la baja no la bloquea junto con las cuentas marcadas.
   */
  async function adminSoloPorLaLista() {
    const s = randomUUID().slice(0, 8);
    const [u] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-lista-${s}`,
        email: `lista-${s}@test.invalid`,
        fullName: 'Admin por la lista',
        status: 'activo',
      })
      .returning();
    if (!u) {
      throw new Error('fixture: admin por la lista');
    }
    return u.id;
  }

  async function pendientes(userId: string) {
    return handle.db
      .select()
      .from(schema.confirmacionesAccesoBooster)
      .where(
        and(
          eq(schema.confirmacionesAccesoBooster.usuarioId, userId),
          isNull(schema.confirmacionesAccesoBooster.consumidoEn),
        ),
      );
  }

  async function cuenta(userId: string) {
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u) {
      throw new Error('fixture: la cuenta no está');
    }
    return u;
  }

  async function esPlatformAdmin(uid: string) {
    const me = await app().request('/me', { headers: { 'x-test-uid': uid } });
    const perfil = (await me.json()) as { user: { is_platform_admin: boolean } };
    return perfil.user.is_platform_admin;
  }

  async function panel(uid: string) {
    return app().request('/admin/personal-booster', { headers: { 'x-test-uid': uid } });
  }

  async function listaDelPersonal() {
    const res = await panel(adminUid);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      personal: Array<{
        email: string;
        user_id: string | null;
        estado: string;
        expira_en: string | null;
        ultimo_login_en: string | null;
      }>;
    };
    return json.personal;
  }

  test('la migración de confirmaciones_acceso_booster creó la tabla y deja una sola pendiente por persona', async () => {
    const tabla = await handle.pool.query<{ regclass: string | null }>(
      "SELECT to_regclass('public.confirmaciones_acceso_booster')::text AS regclass",
    );
    expect(tabla.rows[0]?.regclass).toBe('confirmaciones_acceso_booster');
    const indice = await handle.pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_confirmaciones_acceso_booster_pendiente'",
    );
    expect(indice.rows[0]?.indexdef).toContain('UNIQUE');
    expect(indice.rows[0]?.indexdef).toContain('WHERE (consumido_en IS NULL)');

    const p = await crearPersonaActiva('indice', 'ninguno');
    const fila = {
      usuarioId: p.id,
      codigoHash: 'x',
      venceEn: new Date(Date.now() + 60_000),
      emitidoPorUsuarioId: adminId,
    };
    await handle.db.insert(schema.confirmacionesAccesoBooster).values(fila);
    const duplicada = await handle.db
      .insert(schema.confirmacionesAccesoBooster)
      .values(fila)
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(pgErrorCode(duplicada)).toBe('23505');
    // Una consumida no cuenta como pendiente.
    await handle.db
      .update(schema.confirmacionesAccesoBooster)
      .set({ consumidoEn: new Date() })
      .where(eq(schema.confirmacionesAccesoBooster.usuarioId, p.id));
    await handle.db.insert(schema.confirmacionesAccesoBooster).values(fila);
    expect(await pendientes(p.id)).toHaveLength(1);
  });

  describe('cadena: cuenta activa en una empresa', () => {
    let persona: Awaited<ReturnType<typeof crearPersonaActiva>>;
    let primerCodigo = '';
    let codigo = '';

    test('1. con una membresía en una empresa, la persona no tiene acceso al panel', async () => {
      persona = await crearPersonaActiva('cadena', 'membresia_activa');
      expect((await panel(persona.firebaseUid)).status).toBe(403);
      expect(await esPlatformAdmin(persona.firebaseUid)).toBe(false);
    });

    test('2. el alta no la marca: emite un código de confirmación de 24 horas, sin correo ni aviso', async () => {
      const enviadosAntes = correo.enviados.length;
      const r = await alta({ email: persona.email, fullName: persona.fullName, rut: persona.rut });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.vinculo).toBe('cuenta_activa_por_confirmar');
      expect(r.body.user_id).toBe(persona.id);
      expect(r.body.codigo_activacion).toMatch(/^\d{6}$/);
      primerCodigo = r.body.codigo_activacion ?? '';
      const vence = new Date(r.body.expira_en ?? '').getTime();
      expect(Math.abs(vence - (Date.now() + 24 * 60 * 60 * 1000))).toBeLessThan(60_000);

      const u = await cuenta(persona.id);
      expect(u.isPlatformAdmin).toBe(false);
      expect(u.activationPinHash).toBeNull();
      expect(u.activacionVenceEn).toBeNull();
      expect(u.claveNumericaHash).toBe(persona.claveNumericaHash);

      const filas = await pendientes(persona.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.codigoHash).not.toBe(primerCodigo);
      expect(filas[0]?.intentosFallidos).toBe(0);
      expect(filas[0]?.emitidoPorUsuarioId).toBe(adminId);
      expect(filas[0]?.venceEn.getTime()).toBe(vence);

      expect(correo.enviados.length).toBe(enviadosAntes);
    });

    test('3. sigue sin acceso y la lista del personal la muestra por confirmar', async () => {
      expect((await panel(persona.firebaseUid)).status).toBe(403);
      expect(await esPlatformAdmin(persona.firebaseUid)).toBe(false);
      const lista = await listaDelPersonal();
      expect(lista).toContainEqual(
        expect.objectContaining({
          email: persona.email,
          user_id: persona.id,
          estado: 'pendiente_confirmacion',
          ultimo_login_en: null,
        }),
      );
      const item = lista.find((p) => p.user_id === persona.id);
      expect(item?.expira_en).toBeTruthy();
    });

    test('4. en una sesión de impersonación la confirmación se bloquea y nada cambia', async () => {
      const res = await confirmar(persona.firebaseUid, primerCodigo, {
        'x-test-impersonado-por': adminId,
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('forbidden_impersonation_write');
      const filas = await pendientes(persona.id);
      expect(filas[0]?.intentosFallidos).toBe(0);
      expect((await cuenta(persona.id)).isPlatformAdmin).toBe(false);
    });

    test('5. dos códigos malos suman intentos; «Generar código nuevo» invalida el anterior', async () => {
      for (let i = 0; i < 2; i++) {
        const malo = await confirmar(persona.firebaseUid, otroCodigo(primerCodigo));
        expect(malo.status).toBe(400);
        expect(await malo.json()).toEqual({ error: 'codigo_invalido', code: 'codigo_invalido' });
      }
      expect((await pendientes(persona.id))[0]?.intentosFallidos).toBe(2);

      const res = await app().request(
        `/admin/personal-booster/${persona.id}/codigo`,
        req('POST', undefined, adminUid),
      );
      const body = (await res.json()) as {
        vinculo: string;
        codigo_activacion: string;
        expira_en: string;
      };
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.vinculo).toBe('cuenta_activa_por_confirmar');
      codigo = body.codigo_activacion;
      expect(codigo).toMatch(/^\d{6}$/);
      const filas = await pendientes(persona.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.intentosFallidos).toBe(0);

      if (codigo !== primerCodigo) {
        const viejo = await confirmar(persona.firebaseUid, primerCodigo);
        expect(viejo.status).toBe(400);
      }
      expect((await cuenta(persona.id)).isPlatformAdmin).toBe(false);
    });

    test('6. confirma con su sesión: queda marcada, /me en true, /admin/* en 200 y la lista recibe el aviso', async () => {
      const res = await confirmar(persona.firebaseUid, codigo);
      const body = (await res.json()) as { ok: boolean; user_id: string };
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body).toEqual({ ok: true, user_id: persona.id });

      const u = await cuenta(persona.id);
      expect(u.isPlatformAdmin).toBe(true);
      expect(u.claveNumericaHash).toBe(persona.claveNumericaHash);
      expect(await pendientes(persona.id)).toEqual([]);
      const consumidas = await handle.db
        .select()
        .from(schema.confirmacionesAccesoBooster)
        .where(eq(schema.confirmacionesAccesoBooster.usuarioId, persona.id));
      expect(consumidas).toHaveLength(1);
      expect(consumidas[0]?.consumidoEn).toBeInstanceOf(Date);

      expect(await esPlatformAdmin(persona.firebaseUid)).toBe(true);
      const acceso = await panel(persona.firebaseUid);
      expect(acceso.status).toBe(200);

      const aviso = correo.enviados.filter(
        (m) => m.to === ADMIN_EMAIL && m.subject.startsWith('Booster: acceso al panel otorgado'),
      );
      expect(aviso).toHaveLength(1);
      expect(aviso[0]?.text).toContain(persona.email);
      expect(aviso[0]?.text).toContain(ADMIN_EMAIL);
      expect(aviso[0]?.text).not.toContain(codigo);
      expect(correo.enviados.some((m) => m.to === persona.email)).toBe(false);
    });

    test('7. el código ya consumido no sirve de nuevo', async () => {
      const res = await confirmar(persona.firebaseUid, codigo);
      expect(res.status).toBe(400);
    });
  });

  test('cinco códigos malos dejan la confirmación sin uso, también para el código correcto', async () => {
    const p = await crearPersonaActiva('intentos', 'membresia_removida');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
    expect(r.body.vinculo).toBe('cuenta_activa_por_confirmar');
    const bueno = r.body.codigo_activacion ?? '';

    for (let i = 0; i < 5; i++) {
      expect((await confirmar(p.firebaseUid, otroCodigo(bueno))).status).toBe(400);
    }
    expect((await pendientes(p.id))[0]?.intentosFallidos).toBe(5);

    const res = await confirmar(p.firebaseUid, bueno);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'codigo_invalido', code: 'codigo_invalido' });
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    expect((await panel(p.firebaseUid)).status).toBe(403);
    // Un intento más no suma: la confirmación ya no sirve.
    expect((await pendientes(p.id))[0]?.intentosFallidos).toBe(5);

    const lista = await listaDelPersonal();
    expect(lista.find((x) => x.user_id === p.id)).toMatchObject({
      estado: 'pendiente_confirmacion',
      expira_en: null,
    });
  });

  test('un código vencido no sirve', async () => {
    const p = await crearPersonaActiva('vencido', 'membresia_activa');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
    const bueno = r.body.codigo_activacion ?? '';
    await handle.db
      .update(schema.confirmacionesAccesoBooster)
      .set({ venceEn: new Date(Date.now() - 60_000) })
      .where(eq(schema.confirmacionesAccesoBooster.usuarioId, p.id));

    const res = await confirmar(p.firebaseUid, bueno);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'codigo_invalido', code: 'codigo_invalido' });
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    expect((await pendientes(p.id))[0]?.intentosFallidos).toBe(0);
  });

  test('sin confirmación pendiente, la misma respuesta', async () => {
    const p = await crearPersonaActiva('sin-codigo', 'membresia_activa');
    const res = await confirmar(p.firebaseUid, '123456');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'codigo_invalido', code: 'codigo_invalido' });
  });

  test('una fila de conductores cuenta como vínculo con una empresa', async () => {
    const p = await crearPersonaActiva('conductor', 'conductor');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
    expect(r.status).toBe(200);
    expect(r.body.vinculo).toBe('cuenta_activa_por_confirmar');
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
  });

  test('una cuenta activa sin vínculos queda marcada al darla de alta, como en #893', async () => {
    const p = await crearPersonaActiva('sin-vinculos', 'ninguno');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
    expect(r.status).toBe(200);
    expect(r.body.vinculo).toBe('cuenta_activa');
    expect(r.body.codigo_activacion).toBeNull();
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(true);
    expect(await pendientes(p.id)).toEqual([]);
    expect((await panel(p.firebaseUid)).status).toBe(200);
  });

  test('«Quitar acceso» de una persona por confirmar borra su código y la saca de la lista', async () => {
    const p = await crearPersonaActiva('quitar', 'membresia_activa');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
    const bueno = r.body.codigo_activacion ?? '';

    const res = await app().request(
      `/admin/personal-booster/${p.id}/quitar-acceso`,
      req('POST', undefined, adminUid),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: p.id });
    expect(await pendientes(p.id)).toEqual([]);

    expect((await confirmar(p.firebaseUid, bueno)).status).toBe(400);
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    const lista = await listaDelPersonal();
    expect(lista.find((x) => x.user_id === p.id)).toBeUndefined();

    const reemision = await app().request(
      `/admin/personal-booster/${p.id}/codigo`,
      req('POST', undefined, adminUid),
    );
    expect(reemision.status).toBe(404);
  });

  /** Un segundo admin: marcado, activo y fuera de la lista de respaldo. */
  async function adminMarcado(tag: string) {
    const s = randomUUID().slice(0, 8);
    const [u] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-${tag}-${s}`,
        email: `${tag}-${s}@test.invalid`,
        fullName: 'Admin que emite',
        isPlatformAdmin: true,
        status: 'activo',
      })
      .returning();
    if (!u) {
      throw new Error('fixture: admin marcado');
    }
    return u;
  }

  test('el código vale mientras quien lo emitió tiene acceso al panel: la confirmación lo nombra en el aviso', async () => {
    const emisor = await adminMarcado('emisor-con-acceso');
    const p = await crearPersonaActiva('emisor-con-acceso', 'membresia_activa');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut }, emisor.firebaseUid);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.vinculo).toBe('cuenta_activa_por_confirmar');
    expect((await pendientes(p.id))[0]?.emitidoPorUsuarioId).toBe(emisor.id);
    const antes = correo.enviados.length;

    const res = await confirmar(p.firebaseUid, r.body.codigo_activacion ?? '');

    expect(res.status).toBe(200);
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(true);
    expect((await panel(p.firebaseUid)).status).toBe(200);
    const avisos = correo.enviados.slice(antes);
    expect(avisos.map((m) => m.to)).toEqual(LISTA);
    expect(avisos[0]?.text).toContain(`el código que le entregó ${emisor.email}.`);
  });

  test('si a quien emitió el código le quitan el acceso, el código deja de servir hasta que se emita otro', async () => {
    const emisor = await adminMarcado('emisor-sin-acceso');
    const p = await crearPersonaActiva('emisor-sin-acceso', 'membresia_activa');
    const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut }, emisor.firebaseUid);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.vinculo).toBe('cuenta_activa_por_confirmar');
    const bueno = r.body.codigo_activacion ?? '';
    expect((await pendientes(p.id))[0]?.emitidoPorUsuarioId).toBe(emisor.id);

    const baja = await app().request(
      `/admin/personal-booster/${emisor.id}/quitar-acceso`,
      req('POST', undefined, adminUid),
    );
    expect(baja.status).toBe(200);

    const res = await confirmar(p.firebaseUid, bueno);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'codigo_invalido', code: 'codigo_invalido' });
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    expect((await panel(p.firebaseUid)).status).toBe(403);
    const filas = await pendientes(p.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.intentosFallidos).toBe(0);

    const reemision = await app().request(
      `/admin/personal-booster/${p.id}/codigo`,
      req('POST', undefined, adminUid),
    );
    const nuevo = ((await reemision.json()) as { codigo_activacion: string }).codigo_activacion;
    expect(reemision.status).toBe(200);
    expect((await pendientes(p.id))[0]?.emitidoPorUsuarioId).toBe(adminId);
    expect((await confirmar(p.firebaseUid, nuevo)).status).toBe(200);
    expect((await cuenta(p.id)).isPlatformAdmin).toBe(true);
  });

  describe('en paralelo contra Postgres (SC6, SC10)', () => {
    test('varias confirmaciones con el código correcto: exactamente una marca la cuenta', async () => {
      const p = await crearPersonaActiva('paralelo-bueno', 'membresia_activa');
      const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
      const bueno = r.body.codigo_activacion ?? '';
      const avisosAntes = correo.enviados.filter((m) => m.text.includes(p.email)).length;

      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => confirmarEnParalelo(p.firebaseUid, bueno)),
      );

      const estados = respuestas.map((res) => res.status).sort();
      expect(estados).toEqual([200, 400, 400, 400, 400]);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(true);
      const filas = await handle.db
        .select()
        .from(schema.confirmacionesAccesoBooster)
        .where(eq(schema.confirmacionesAccesoBooster.usuarioId, p.id));
      expect(filas).toHaveLength(1);
      expect(filas[0]?.consumidoEn).toBeInstanceOf(Date);
      const avisos = correo.enviados.filter((m) => m.text.includes(p.email)).length;
      expect(avisos - avisosAntes).toBe(LISTA.length);
    });

    test('varios códigos incorrectos en paralelo dejan exactamente cinco intentos', async () => {
      const p = await crearPersonaActiva('paralelo-malo', 'membresia_activa');
      const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
      const bueno = r.body.codigo_activacion ?? '';

      const respuestas = await Promise.all(
        Array.from({ length: 8 }, () => confirmarEnParalelo(p.firebaseUid, otroCodigo(bueno))),
      );

      expect(respuestas.map((res) => res.status)).toEqual(Array(8).fill(400));
      expect((await pendientes(p.id))[0]?.intentosFallidos).toBe(5);
      expect((await confirmar(p.firebaseUid, bueno)).status).toBe(400);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    });

    test('el código anterior no marca la cuenta mientras se emite otro', async () => {
      const p = await crearPersonaActiva('paralelo-reemision', 'membresia_activa');
      const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
      const viejo = r.body.codigo_activacion ?? '';
      const nuevo = otroCodigo(viejo);

      const res = await conTransaccionEnCurso(
        (cliente) => reemisionEnCurso(cliente, p.id, nuevo),
        () => confirmarEnParalelo(p.firebaseUid, viejo),
      );

      expect(res.status).toBe(400);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
      const filas = await pendientes(p.id);
      expect(filas).toHaveLength(1);
      expect(filas[0]?.intentosFallidos).toBe(1);
      expect((await confirmar(p.firebaseUid, nuevo)).status).toBe(200);
    });

    test('«Quitar acceso» mientras la persona confirma: la cuenta queda sin acceso y la baja responde ok', async () => {
      const p = await crearPersonaActiva('paralelo-quitar-confirma', 'membresia_activa');
      await alta({ email: p.email, fullName: p.fullName, rut: p.rut });

      const res = await conTransaccionEnCurso(
        (cliente) => confirmacionEnCurso(cliente, p.id),
        () => quitarAccesoEnParalelo(p.id),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, user_id: p.id });
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
      expect((await panel(p.firebaseUid)).status).toBe(403);
      const aviso = correo.enviados.filter(
        (m) => m.subject === `Booster: acceso al panel quitado a ${p.fullName}`,
      );
      expect(aviso).toHaveLength(LISTA.length);
    });

    test('«Quitar acceso» mientras se emite otro código: el código nuevo tampoco queda', async () => {
      const p = await crearPersonaActiva('paralelo-quitar-reemite', 'membresia_activa');
      const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
      const nuevo = otroCodigo(r.body.codigo_activacion ?? '');
      const emisor = await adminSoloPorLaLista();

      const res = await conTransaccionEnCurso(
        (cliente) => reemisionEnCurso(cliente, p.id, nuevo, emisor),
        () => quitarAccesoEnParalelo(p.id),
      );

      expect(res.status).toBe(200);
      expect(await pendientes(p.id)).toEqual([]);
      expect((await confirmar(p.firebaseUid, nuevo)).status).toBe(400);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    });

    test('quitar el acceso a una cuenta marcada también anula su código de confirmación', async () => {
      const p = await crearPersonaActiva('marcada-con-codigo', 'membresia_activa');
      const r = await alta({ email: p.email, fullName: p.fullName, rut: p.rut });
      const bueno = r.body.codigo_activacion ?? '';
      // La cuenta queda marcada por otro camino mientras su confirmación sigue pendiente.
      await handle.db
        .update(schema.users)
        .set({ isPlatformAdmin: true })
        .where(eq(schema.users.id, p.id));

      const res = await app().request(
        `/admin/personal-booster/${p.id}/quitar-acceso`,
        req('POST', undefined, adminUid),
      );

      expect(res.status).toBe(200);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
      expect(await pendientes(p.id)).toEqual([]);
      expect((await confirmar(p.firebaseUid, bueno)).status).toBe(400);
      expect((await cuenta(p.id)).isPlatformAdmin).toBe(false);
    });
  });
});
