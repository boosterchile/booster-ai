/**
 * Seed de los flujos críticos E2E (T10-10): generador publica carga,
 * transportista acepta oferta, tracking público, admin crea organización
 * stakeholder, stakeholder activa y consulta zonas, login con RUT y clave.
 *
 * Idempotente y separado del seed T2 del conductor: usa RUTs propios para
 * no gastar el límite de login por RUT (5 cada 15 min, cuenta los éxitos).
 *
 *   Gen F   77777777-7 · clave 482913 · empresa generadora activa
 *   Tra F   78787878-4 · clave 482913 · empresa transportista con zona
 *                        XIII (ambos) y un camión de 20 t activo
 *   Admin   79797979-1 · clave 482913 · email en BOOSTER_PLATFORM_ADMIN_EMAILS
 *   Stake   75757575-2 · sin cuenta: el admin la invita en el E2E
 *
 * Además:
 *   - borra la cuenta del stakeholder de una corrida anterior (usuario,
 *     membresías y usuario del emulador) para que la invitación devuelva un
 *     código nuevo;
 *   - borra las claves de rate limit de login y activación en Redis.
 *
 * Requiere DATABASE_URL, Redis (REDIS_HOST/REDIS_PORT) y el emulador de
 * Auth (FIREBASE_AUTH_EMULATOR_HOST, default 127.0.0.1:9099).
 *
 * Uso: pnpm --filter @booster-ai/api seed:flujos-e2e
 */
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

import { createLogger } from '@booster-ai/logger';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import pg from 'pg';
import * as schema from '../src/db/schema.js';
import { empresas, memberships, plans, users, vehicles, zones } from '../src/db/schema.js';
import { hashClaveNumerica } from '../src/services/clave-numerica.js';
import { requireSafeDatabaseUrl } from './seed-conductor-e2e-cleanup.js';

const CLAVE = '482913';
export const RUT_GEN_F = '77777777-7';
export const RUT_TRA_F = '78787878-4';
export const RUT_ADMIN_F = '79797979-1';
export const RUT_STAKE_F = '75757575-2';
/** Debe coincidir con `BOOSTER_PLATFORM_ADMIN_EMAILS` del API del E2E. */
export const EMAIL_ADMIN_F = 'e2e-admin@boosterchile.invalid';
const PLATE_F = 'E2EF01';

const logger = createLogger({
  service: 'seed-flujos-e2e',
  version: '0.0.0-e2e',
  level: 'info',
  pretty: true,
});

/** Convención de `/auth/activar`: `users+<dígitos del RUT>@boosterchile.invalid`. */
function emailSintetico(rut: string): string {
  return `users+${rut.replace(/[^0-9kK]/g, '').toLowerCase()}@boosterchile.invalid`;
}

async function upsertFirebaseUser(opts: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<void> {
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  try {
    await auth.getUser(opts.uid);
  } catch {
    await auth.createUser({
      uid: opts.uid,
      email: opts.email,
      displayName: opts.displayName,
      disabled: false,
    });
  }
}

/** Borra del emulador la cuenta que `/auth/activar` creó en una corrida anterior. */
async function borrarFirebasePorEmail(email: string): Promise<void> {
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  try {
    const u = await auth.getUserByEmail(email);
    await auth.deleteUser(u.uid);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') {
      throw err;
    }
  }
}

async function limpiarRateLimits(): Promise<number> {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  try {
    let borradas = 0;
    for (const patron of ['rl:login-rut:*', 'rl:activar-cuenta:*']) {
      const claves = await redis.keys(patron);
      if (claves.length > 0) {
        borradas += await redis.del(...claves);
      }
    }
    return borradas;
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireSafeDatabaseUrl(
    process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  );
  const { initializeApp } = await import('firebase-admin/app');
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-dev' });

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool, { schema });

  try {
    const plan = (await db.select({ id: plans.id }).from(plans).limit(1))[0];
    if (!plan) {
      throw new Error('sin planes seedeados; la migración 0002 debería haberlos creado');
    }
    const planId = plan.id;
    const claveHash = hashClaveNumerica(CLAVE);

    async function upsertEmpresa(opts: {
      rut: string;
      legalName: string;
      generador: boolean;
      transportista: boolean;
    }): Promise<string> {
      const datos = {
        status: 'activa' as const,
        isGeneradorCarga: opts.generador,
        isTransportista: opts.transportista,
      };
      const found = await db
        .select({ id: empresas.id })
        .from(empresas)
        .where(eq(empresas.rut, opts.rut))
        .limit(1);
      if (found[0]) {
        await db.update(empresas).set(datos).where(eq(empresas.id, found[0].id));
        return found[0].id;
      }
      const inserted = await db
        .insert(empresas)
        .values({
          ...datos,
          planId,
          legalName: opts.legalName,
          rut: opts.rut,
          contactEmail: `${opts.rut}@boosterchile.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle E2E 2',
          addressCity: 'Santiago',
          addressRegion: 'RM',
        })
        .returning({ id: empresas.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error(`no se insertó empresa ${opts.rut}`);
      }
      return id;
    }

    async function upsertUsuario(opts: {
      rut: string;
      uid: string;
      email: string;
      fullName: string;
    }): Promise<string> {
      await upsertFirebaseUser({ uid: opts.uid, email: opts.email, displayName: opts.fullName });
      const datos = {
        firebaseUid: opts.uid,
        email: opts.email,
        claveNumericaHash: claveHash,
        status: 'activo' as const,
      };
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rut, opts.rut))
        .limit(1);
      if (found[0]) {
        await db.update(users).set(datos).where(eq(users.id, found[0].id));
        return found[0].id;
      }
      const inserted = await db
        .insert(users)
        .values({ ...datos, fullName: opts.fullName, phone: '+56922222222', rut: opts.rut })
        .returning({ id: users.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error(`no se insertó usuario ${opts.rut}`);
      }
      return id;
    }

    async function membresiaDueno(userId: string, empresaId: string): Promise<void> {
      await db.delete(memberships).where(eq(memberships.userId, userId));
      await db.insert(memberships).values({
        userId,
        empresaId,
        role: 'dueno',
        status: 'activa',
        joinedAt: new Date(),
      });
    }

    const empGen = await upsertEmpresa({
      rut: RUT_GEN_F,
      legalName: 'Generador Flujos E2E SpA',
      generador: true,
      transportista: false,
    });
    const empTra = await upsertEmpresa({
      rut: RUT_TRA_F,
      legalName: 'Transportes Flujos E2E SpA',
      generador: false,
      transportista: true,
    });
    await membresiaDueno(
      await upsertUsuario({
        rut: RUT_GEN_F,
        uid: `e2e-gen-${RUT_GEN_F}`,
        email: emailSintetico(RUT_GEN_F),
        fullName: 'Dueña Generador Flujos',
      }),
      empGen,
    );
    await membresiaDueno(
      await upsertUsuario({
        rut: RUT_TRA_F,
        uid: `e2e-tra-${RUT_TRA_F}`,
        email: emailSintetico(RUT_TRA_F),
        fullName: 'Dueño Transportista Flujos',
      }),
      empTra,
    );
    // El admin de plataforma no pertenece a ninguna empresa: su permiso es
    // el email en la allowlist (`usuarios.email`), no una membresía.
    const adminId = await upsertUsuario({
      rut: RUT_ADMIN_F,
      uid: `e2e-admin-${RUT_ADMIN_F}`,
      email: EMAIL_ADMIN_F,
      fullName: 'Admin Plataforma E2E',
    });
    await db.delete(memberships).where(eq(memberships.userId, adminId));

    // Matching: zona de recogida en la RM (código romano) y un camión activo.
    const zonaFound = await db
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.empresaId, empTra), eq(zones.regionCode, 'XIII')))
      .limit(1);
    if (zonaFound[0]) {
      await db
        .update(zones)
        .set({ zoneType: 'ambos', isActive: true })
        .where(eq(zones.id, zonaFound[0].id));
    } else {
      await db
        .insert(zones)
        .values({ empresaId: empTra, regionCode: 'XIII', zoneType: 'ambos', isActive: true });
    }
    const vehFound = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plate, PLATE_F))
      .limit(1);
    if (vehFound[0]) {
      await db
        .update(vehicles)
        .set({ empresaId: empTra, vehicleStatus: 'activo', capacityKg: 20_000 })
        .where(eq(vehicles.id, vehFound[0].id));
    } else {
      await db.insert(vehicles).values({
        empresaId: empTra,
        plate: PLATE_F,
        vehicleType: 'camion_pesado',
        capacityKg: 20_000,
        fuelType: 'diesel',
        unitCategory: 'motriz',
        unitType: 'camion_rigido',
        vehicleStatus: 'activo',
      });
    }

    // Stakeholder: sin cuenta, para que la invitación del E2E entregue código.
    const stake = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.rut, RUT_STAKE_F))
      .limit(1);
    if (stake[0]) {
      await db.delete(memberships).where(eq(memberships.userId, stake[0].id));
      await db.delete(users).where(eq(users.id, stake[0].id));
    }
    await borrarFirebasePorEmail(emailSintetico(RUT_STAKE_F));

    const borradas = await limpiarRateLimits();
    logger.info(
      { gen: RUT_GEN_F, tra: RUT_TRA_F, admin: RUT_ADMIN_F, stake: RUT_STAKE_F, borradas },
      'seed flujos E2E listo',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'seed flujos E2E falló');
  process.exit(1);
});
