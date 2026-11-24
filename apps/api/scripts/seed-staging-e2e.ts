/**
 * Siembra de los usuarios de prueba del E2E en STAGING (.specs/e2e-staging).
 *
 * Crea dos empresas de prueba con su dueño, para que la suite `apps/web/e2e/`
 * pueda iniciar sesión contra el entorno desplegado:
 *
 *   Transportes Van Oosterwyk   transportista · zona XIII · un camión activo
 *   Prueba Generador SpA        generador de carga
 *
 * Los nombres son los que pidió el PO; los RUT son ficticios (dígito
 * verificador válido) y no corresponden a las empresas reales de prod.
 *
 * A diferencia de `seed-conductor-e2e.ts` y `seed-flujos-e2e.ts`, que abortan
 * contra una base desplegada y usan claves escritas en el repo:
 *   - exige `SEED_E2E_DESTINO=staging` y `GOOGLE_CLOUD_PROJECT=booster-ai-stg-494222`;
 *   - crea las cuentas en Identity Platform real (rechaza el emulador de Auth);
 *   - toma las claves del entorno y rechaza las publicadas en el repo;
 *   - aborta si la base tiene alguna de esas razones sociales con otro RUT,
 *     que es como se ve prod.
 *
 * Idempotente. No borra nada que no haya creado: solo reemplaza la membresía
 * de sus dos usuarios.
 *
 * Variables:
 *   SEED_E2E_DESTINO=staging
 *   GOOGLE_CLOUD_PROJECT=booster-ai-stg-494222      (credenciales: ADC)
 *   DATABASE_URL                                     base de staging, por el túnel del bastion
 *   SEED_E2E_CLAVE_TRANSPORTISTA                     seis dígitos
 *   SEED_E2E_CLAVE_GENERADOR                         seis dígitos
 *
 * Uso: pnpm --filter @booster-ai/api seed:staging-e2e
 */
import { createLogger } from '@booster-ai/logger';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/db/schema.js';
import { empresas, memberships, plans, users, vehicles, zones } from '../src/db/schema.js';
import { hashClaveNumerica } from '../src/services/clave-numerica.js';
import {
  esBaseDeProd,
  exigirClaveNoPublicada,
  exigirDestinoStaging,
} from './seed-staging-e2e-guardas.js';

export const EMPRESA_TRANSPORTISTA = {
  razonSocial: 'Transportes Van Oosterwyk',
  rut: '76900001-1',
  rutDueno: '19900001-2',
  uid: 'stg-e2e-transportista',
  nombreDueno: 'Dueño Transportista E2E',
} as const;

export const EMPRESA_GENERADOR = {
  razonSocial: 'Prueba Generador SpA',
  rut: '76900002-K',
  rutDueno: '19900002-0',
  uid: 'stg-e2e-generador',
  nombreDueno: 'Dueña Generador E2E',
} as const;

const PATENTE = 'STGE01';

const logger = createLogger({
  service: 'seed-staging-e2e',
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
    await auth.updateUser(opts.uid, {
      email: opts.email,
      displayName: opts.displayName,
      disabled: false,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/user-not-found') {
      throw err;
    }
    await auth.createUser({
      uid: opts.uid,
      email: opts.email,
      displayName: opts.displayName,
      disabled: false,
    });
  }
}

async function main(): Promise<void> {
  const destino = exigirDestinoStaging(process.env);
  const claveTransportista = exigirClaveNoPublicada(
    process.env.SEED_E2E_CLAVE_TRANSPORTISTA,
    'SEED_E2E_CLAVE_TRANSPORTISTA',
  );
  const claveGenerador = exigirClaveNoPublicada(
    process.env.SEED_E2E_CLAVE_GENERADOR,
    'SEED_E2E_CLAVE_GENERADOR',
  );

  const { initializeApp } = await import('firebase-admin/app');
  initializeApp({ projectId: destino.projectId });

  const pool = new pg.Pool({ connectionString: destino.databaseUrl, max: 2 });
  const db = drizzle(pool, { schema });

  try {
    const existentes = await db
      .select({ razonSocial: empresas.legalName, rut: empresas.rut })
      .from(empresas)
      .where(
        inArray(empresas.legalName, [
          EMPRESA_TRANSPORTISTA.razonSocial,
          EMPRESA_GENERADOR.razonSocial,
        ]),
      );
    if (esBaseDeProd(existentes, [EMPRESA_TRANSPORTISTA.rut, EMPRESA_GENERADOR.rut])) {
      throw new Error(
        'La base ya tiene una de estas razones sociales con otro RUT: parece prod. Aborto sin escribir.',
      );
    }

    const plan = (await db.select({ id: plans.id }).from(plans).limit(1))[0];
    if (!plan) {
      throw new Error('sin planes en la base; la migración 0002 debería haberlos creado');
    }
    const planId = plan.id;

    async function upsertEmpresa(opts: {
      rut: string;
      razonSocial: string;
      generador: boolean;
      transportista: boolean;
    }): Promise<string> {
      const datos = {
        status: 'activa' as const,
        isGeneradorCarga: opts.generador,
        isTransportista: opts.transportista,
        legalName: opts.razonSocial,
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
          rut: opts.rut,
          contactEmail: `${opts.rut.toLowerCase()}@boosterchile.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle E2E 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
        })
        .returning({ id: empresas.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error(`no se insertó la empresa ${opts.rut}`);
      }
      return id;
    }

    async function upsertDueno(opts: {
      rut: string;
      uid: string;
      nombre: string;
      clave: string;
      empresaId: string;
    }): Promise<void> {
      const email = emailSintetico(opts.rut);
      await upsertFirebaseUser({ uid: opts.uid, email, displayName: opts.nombre });
      const datos = {
        firebaseUid: opts.uid,
        email,
        claveNumericaHash: hashClaveNumerica(opts.clave),
        status: 'activo' as const,
      };
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rut, opts.rut))
        .limit(1);
      let userId = found[0]?.id;
      if (userId) {
        await db.update(users).set(datos).where(eq(users.id, userId));
      } else {
        const inserted = await db
          .insert(users)
          .values({ ...datos, fullName: opts.nombre, phone: '+56922222222', rut: opts.rut })
          .returning({ id: users.id });
        userId = inserted[0]?.id;
      }
      if (!userId) {
        throw new Error(`no se insertó el usuario ${opts.rut}`);
      }
      await db.delete(memberships).where(eq(memberships.userId, userId));
      await db.insert(memberships).values({
        userId,
        empresaId: opts.empresaId,
        role: 'dueno',
        status: 'activa',
        joinedAt: new Date(),
      });
    }

    const transportistaId = await upsertEmpresa({
      rut: EMPRESA_TRANSPORTISTA.rut,
      razonSocial: EMPRESA_TRANSPORTISTA.razonSocial,
      generador: false,
      transportista: true,
    });
    const generadorId = await upsertEmpresa({
      rut: EMPRESA_GENERADOR.rut,
      razonSocial: EMPRESA_GENERADOR.razonSocial,
      generador: true,
      transportista: false,
    });

    await upsertDueno({
      rut: EMPRESA_TRANSPORTISTA.rutDueno,
      uid: EMPRESA_TRANSPORTISTA.uid,
      nombre: EMPRESA_TRANSPORTISTA.nombreDueno,
      clave: claveTransportista,
      empresaId: transportistaId,
    });
    await upsertDueno({
      rut: EMPRESA_GENERADOR.rutDueno,
      uid: EMPRESA_GENERADOR.uid,
      nombre: EMPRESA_GENERADOR.nombreDueno,
      clave: claveGenerador,
      empresaId: generadorId,
    });

    // Matching: zona de la RM (código romano) y un camión activo.
    const zona = await db
      .select({ id: zones.id })
      .from(zones)
      .where(and(eq(zones.empresaId, transportistaId), eq(zones.regionCode, 'XIII')))
      .limit(1);
    if (zona[0]) {
      await db
        .update(zones)
        .set({ zoneType: 'ambos', isActive: true })
        .where(eq(zones.id, zona[0].id));
    } else {
      await db.insert(zones).values({
        empresaId: transportistaId,
        regionCode: 'XIII',
        zoneType: 'ambos',
        isActive: true,
      });
    }
    const vehiculo = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plate, PATENTE))
      .limit(1);
    if (vehiculo[0]) {
      await db
        .update(vehicles)
        .set({ empresaId: transportistaId, vehicleStatus: 'activo', capacityKg: 20_000 })
        .where(eq(vehicles.id, vehiculo[0].id));
    } else {
      await db.insert(vehicles).values({
        empresaId: transportistaId,
        plate: PATENTE,
        vehicleType: 'camion_pesado',
        capacityKg: 20_000,
        fuelType: 'diesel',
        unitCategory: 'motriz',
        unitType: 'camion_rigido',
        vehicleStatus: 'activo',
      });
    }

    // Las claves nunca se registran: solo los RUT con que se inicia sesión.
    logger.info(
      {
        proyecto: destino.projectId,
        transportista: EMPRESA_TRANSPORTISTA.rutDueno,
        generador: EMPRESA_GENERADOR.rutDueno,
      },
      'siembra E2E de staging lista',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'siembra E2E de staging falló');
  process.exit(1);
});
