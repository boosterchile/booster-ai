/**
 * Siembra de la prueba «una sola verdad por dato» (`.specs/una-sola-verdad-por-dato`,
 * criterio 4). Una sola empresa con camiones, conductores, documentos y
 * certificados conocidos. El modo cambia solo las banderas de la empresa,
 * para que la misma empresa se vea en pantallas que se excluyen entre sí:
 *
 *   completo  transportista que recibe ofertas → Inicio con servicio completo
 *   fleet     transportista sin ofertas        → Inicio con Booster Fleet solo
 *   mixta     transportista y generadora       → Certificados
 *
 *   Dueño  74747474-5 · clave 482913 · empresa 76767676-K
 *
 * Lo sembrado, que la prueba no compara contra valores fijos sino entre
 * pantallas (solo exige que no sea cero):
 *   - 3 camiones activos y 1 retirado (el retirado no cuenta en ninguna parte);
 *   - documentos: UVEA01 con SOAP vencido, revisión técnica por vencer y sin
 *     permiso; UVEB02 al día; UVEC03 sin ningún documento; el conductor
 *     Benito con licencia vencida y sin psicotécnico; Ana al día;
 *   - 3 certificados emitidos de viajes de la empresa como generadora.
 *
 * Idempotente. Requiere DATABASE_URL, Redis y el emulador de Auth.
 * Uso: pnpm --filter @booster-ai/api seed:una-verdad-e2e -- --modo=completo
 */
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

import { createLogger } from '@booster-ai/logger';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import pg from 'pg';
import { z } from 'zod';
import * as schema from '../src/db/schema.js';
import {
  conductores,
  documentosConductor,
  documentosVehiculo,
  empresas,
  memberships,
  plans,
  tripMetrics,
  trips,
  users,
  vehicles,
} from '../src/db/schema.js';
import { hashClaveNumerica } from '../src/services/clave-numerica.js';
import { requireSafeDatabaseUrl } from './seed-conductor-e2e-cleanup.js';

export const RUT_EMPRESA_UV = '76767676-K';
export const RUT_DUENO_UV = '74747474-5';
export const NOMBRE_EMPRESA_UV = 'Transportes Una Verdad E2E SpA';
const CLAVE = '482913';
const CONDUCTORES = [
  { rut: '73737373-8', nombre: 'Ana Rojas E2E', licencia: '2099-01-01', alDia: true },
  { rut: '69696969-8', nombre: 'Benito Díaz E2E', licencia: '2020-03-01', alDia: false },
] as const;
const CAMIONES = [
  { plate: 'UVEA01', estado: 'activo' },
  { plate: 'UVEB02', estado: 'activo' },
  { plate: 'UVEC03', estado: 'activo' },
  { plate: 'UVER04', estado: 'retirado' },
] as const;
const CERTIFICADOS = [
  { codigo: 'UVE-000001', kg: '375.200', nivel: 'primario_verificable' },
  { codigo: 'UVE-000002', kg: '820.500', nivel: 'secundario_modeled' },
  { codigo: 'UVE-000003', kg: '112.300', nivel: 'secundario_default' },
] as const;

const modoSchema = z.enum(['completo', 'fleet', 'mixta']);
type Modo = z.infer<typeof modoSchema>;

const BANDERAS: Record<Modo, { generador: boolean; recibeOfertas: boolean }> = {
  completo: { generador: false, recibeOfertas: true },
  fleet: { generador: false, recibeOfertas: false },
  mixta: { generador: true, recibeOfertas: true },
};

const logger = createLogger({
  service: 'seed-una-verdad-e2e',
  version: '0.0.0-e2e',
  level: 'info',
  pretty: true,
});

function emailSintetico(rut: string): string {
  return `users+${rut.replace(/[^0-9kK]/g, '').toLowerCase()}@boosterchile.invalid`;
}

function enDias(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

function leerModo(): Modo {
  const arg = process.argv.find((a) => a.startsWith('--modo='))?.slice('--modo='.length);
  return modoSchema.parse(arg ?? process.env.UNA_VERDAD_MODO ?? 'completo');
}

async function upsertFirebase(uid: string, email: string, displayName: string): Promise<void> {
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  try {
    await auth.getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') {
      throw err;
    }
    await auth.createUser({ uid, email, displayName });
  }
}

async function limpiarRateLimitsLogin(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  try {
    const claves = await redis.keys('rl:login-rut:*');
    if (claves.length > 0) {
      await redis.del(...claves);
    }
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const modo = leerModo();
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
    const banderas = BANDERAS[modo];
    const datosEmpresa = {
      status: 'activa' as const,
      isTransportista: true,
      isGeneradorCarga: banderas.generador,
      recibeOfertasCarga: banderas.recibeOfertas,
    };
    let empresaId = (
      await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.rut, RUT_EMPRESA_UV))
    )[0]?.id;
    if (empresaId) {
      await db.update(empresas).set(datosEmpresa).where(eq(empresas.id, empresaId));
    } else {
      empresaId = (
        await db
          .insert(empresas)
          .values({
            ...datosEmpresa,
            planId: plan.id,
            legalName: NOMBRE_EMPRESA_UV,
            rut: RUT_EMPRESA_UV,
            contactEmail: `${RUT_EMPRESA_UV}@boosterchile.invalid`,
            contactPhone: '+56911111111',
            addressStreet: 'Calle E2E 3',
            addressCity: 'Santiago',
            addressRegion: 'RM',
          })
          .returning({ id: empresas.id })
      )[0]?.id;
    }
    if (!empresaId) {
      throw new Error('no se pudo crear la empresa de la prueba');
    }

    async function upsertUsuario(rut: string, nombre: string, firebase: boolean): Promise<string> {
      const uid = `e2e-uv-${rut}`;
      const email = emailSintetico(rut);
      if (firebase) {
        await upsertFirebase(uid, email, nombre);
      }
      const datos = {
        firebaseUid: uid,
        email,
        claveNumericaHash: hashClaveNumerica(CLAVE),
        status: 'activo' as const,
      };
      const found = (await db.select({ id: users.id }).from(users).where(eq(users.rut, rut)))[0];
      if (found) {
        await db.update(users).set(datos).where(eq(users.id, found.id));
        return found.id;
      }
      const id = (
        await db
          .insert(users)
          .values({ ...datos, fullName: nombre, phone: '+56922222222', rut })
          .returning({ id: users.id })
      )[0]?.id;
      if (!id) {
        throw new Error(`no se insertó el usuario ${rut}`);
      }
      return id;
    }

    const duenoId = await upsertUsuario(RUT_DUENO_UV, 'Dueña Una Verdad E2E', true);
    await db.delete(memberships).where(eq(memberships.userId, duenoId));
    await db.insert(memberships).values({
      userId: duenoId,
      empresaId,
      role: 'dueno',
      status: 'activa',
      joinedAt: new Date(),
    });

    // Camiones y sus documentos: se rehacen en cada corrida.
    const idPorPatente = new Map<string, string>();
    for (const camion of CAMIONES) {
      const found = (
        await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.plate, camion.plate))
      )[0];
      if (found) {
        await db
          .update(vehicles)
          .set({ empresaId, vehicleStatus: camion.estado, teltonikaImei: null })
          .where(eq(vehicles.id, found.id));
        idPorPatente.set(camion.plate, found.id);
      } else {
        const id = (
          await db
            .insert(vehicles)
            .values({
              empresaId,
              plate: camion.plate,
              vehicleType: 'camion_pesado',
              capacityKg: 20_000,
              fuelType: 'diesel',
              unitCategory: 'motriz',
              unitType: 'camion_rigido',
              vehicleStatus: camion.estado,
            })
            .returning({ id: vehicles.id })
        )[0]?.id;
        if (!id) {
          throw new Error(`no se insertó el camión ${camion.plate}`);
        }
        idPorPatente.set(camion.plate, id);
      }
    }
    const idsCamiones = [...idPorPatente.values()];
    await db.delete(documentosVehiculo).where(inArray(documentosVehiculo.vehicleId, idsCamiones));
    const a = idPorPatente.get('UVEA01') ?? '';
    const b = idPorPatente.get('UVEB02') ?? '';
    await db.insert(documentosVehiculo).values([
      { vehicleId: a, tipo: 'soap', fechaVencimiento: '2020-04-01', estado: 'vencido' },
      {
        vehicleId: a,
        tipo: 'revision_tecnica',
        fechaVencimiento: enDias(10),
        estado: 'por_vencer',
      },
      { vehicleId: b, tipo: 'soap', fechaVencimiento: '2099-01-01' },
      { vehicleId: b, tipo: 'revision_tecnica', fechaVencimiento: '2099-01-01' },
      { vehicleId: b, tipo: 'permiso_circulacion', fechaVencimiento: '2099-01-01' },
    ]);

    // Conductores: la licencia de Benito está vencida en su ficha y no tiene
    // psicotécnico; Ana tiene todo vigente.
    for (const conductor of CONDUCTORES) {
      const userId = await upsertUsuario(conductor.rut, conductor.nombre, false);
      let conductorId = (
        await db
          .select({ id: conductores.id })
          .from(conductores)
          .where(eq(conductores.userId, userId))
      )[0]?.id;
      const ficha = {
        empresaId,
        licenseClass: 'A5' as const,
        licenseNumber: `E2E-${conductor.rut}`,
        licenseExpiry: conductor.licencia,
        deletedAt: null,
      };
      if (conductorId) {
        await db.update(conductores).set(ficha).where(eq(conductores.id, conductorId));
      } else {
        conductorId = (
          await db
            .insert(conductores)
            .values({ ...ficha, userId })
            .returning({ id: conductores.id })
        )[0]?.id;
      }
      if (!conductorId) {
        throw new Error(`no se insertó el conductor ${conductor.rut}`);
      }
      await db.delete(documentosConductor).where(eq(documentosConductor.conductorId, conductorId));
      if (conductor.alDia) {
        await db.insert(documentosConductor).values([
          { conductorId, tipo: 'licencia_conducir', fechaVencimiento: conductor.licencia },
          { conductorId, tipo: 'examen_psicotecnico', fechaVencimiento: '2099-01-01' },
        ]);
      }
    }

    // Certificados: viajes de la empresa como generadora con certificado emitido.
    for (const cert of CERTIFICADOS) {
      let tripId = (
        await db.select({ id: trips.id }).from(trips).where(eq(trips.trackingCode, cert.codigo))
      )[0]?.id;
      if (tripId) {
        await db
          .update(trips)
          .set({ generadorCargaEmpresaId: empresaId })
          .where(eq(trips.id, tripId));
      } else {
        tripId = (
          await db
            .insert(trips)
            .values({
              trackingCode: cert.codigo,
              generadorCargaEmpresaId: empresaId,
              originAddressRaw: 'Av. Origen 100, Santiago',
              destinationAddressRaw: 'Av. Destino 200, Valparaíso',
              cargoType: 'carga_seca',
              pickupDateRaw: '2026-11-20',
              status: 'entregado',
            })
            .returning({ id: trips.id })
        )[0]?.id;
      }
      if (!tripId) {
        throw new Error(`no se insertó el viaje ${cert.codigo}`);
      }
      const metricas = {
        carbonEmissionsKgco2eEstimated: cert.kg,
        carbonEmissionsKgco2eActual: null,
        certificationLevel: cert.nivel,
        certificateIssuedAt: new Date('2026-11-21T12:00:00.000Z'),
        certificateSha256: `${'0'.repeat(54)}${cert.codigo.slice(-6)}0000`,
      };
      await db
        .insert(tripMetrics)
        .values({ tripId, ...metricas })
        .onConflictDoUpdate({ target: tripMetrics.tripId, set: metricas });
    }

    await limpiarRateLimitsLogin();
    logger.info({ modo, empresa: RUT_EMPRESA_UV, dueno: RUT_DUENO_UV }, 'seed una-verdad listo');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'seed una-verdad falló');
  process.exit(1);
});
