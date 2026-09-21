/**
 * Seed T2 del E2E conductor (Slot 3 paso 6).
 *
 * Idempotente: upsert de empresas/usuarios/membresía/vehículo por RUT
 * canónico; cancela asignaciones E2E viejas (`codigo_seguimiento` LIKE
 * 'E2E%'); inserta un viaje `asignado` sin Teltonika.
 *
 * Credenciales (referencia smoke del PO):
 *   Gen 72727272-0 · Tra 70707070-6 · Cond 71717171-3 · clave 482913
 *
 * Requiere:
 *   DATABASE_URL
 *   FIREBASE_AUTH_EMULATOR_HOST (default 127.0.0.1:9099)
 *   FIREBASE_PROJECT_ID (default booster-ai-dev)
 *
 * Uso:
 *   pnpm --filter @booster-ai/api seed:conductor-e2e
 */
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

import { createLogger } from '@booster-ai/logger';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  assignments,
  empresas,
  memberships,
  offers,
  plans,
  trips,
  users,
  vehicles,
} from '../src/db/schema.js';
import { hashClaveNumerica } from '../src/services/clave-numerica.js';

const CLAVE = '482913';
const RUT_GEN = '72727272-0';
const RUT_TRA = '70707070-6';
const RUT_COND = '71717171-3';
const PLATE = 'E2EC01';

const logger = createLogger({
  service: 'seed-conductor-e2e',
  version: '0.0.0-e2e',
  level: 'info',
  pretty: true,
});

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL (o TEST_DATABASE_URL) no está definido. El seed T2 no corre contra una URL implícita.',
    );
  }
  if (/prod|staging/i.test(url)) {
    throw new Error(
      `DATABASE_URL parece prod/staging. Aborto. URL: ${url.replace(/:[^:@]*@/, ':***@')}`,
    );
  }
  return url;
}

function trackingCode(): string {
  const raw = `E2E${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return raw.slice(0, 12);
}

async function upsertFirebaseUser(opts: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<string> {
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  try {
    const existing = await auth.getUser(opts.uid);
    return existing.uid;
  } catch {
    const created = await auth.createUser({
      uid: opts.uid,
      email: opts.email,
      displayName: opts.displayName,
      disabled: false,
    });
    return created.uid;
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireDatabaseUrl();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? 'booster-ai-dev';

  const { initializeApp } = await import('firebase-admin/app');
  initializeApp({ projectId });

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const db = drizzle(pool);

  try {
    const planRows = await db.select({ id: plans.id }).from(plans).limit(1);
    const firstPlan = planRows[0];
    if (!firstPlan) {
      throw new Error('sin planes seedeados; la migración 0002 debería haberlos creado');
    }
    const planId = firstPlan.id;

    const claveHash = hashClaveNumerica(CLAVE);

    async function upsertEmpresa(opts: {
      rut: string;
      legalName: string;
      isGeneradorCarga: boolean;
      isTransportista: boolean;
      email: string;
    }): Promise<string> {
      const found = await db
        .select({ id: empresas.id })
        .from(empresas)
        .where(eq(empresas.rut, opts.rut))
        .limit(1);
      if (found[0]) {
        await db
          .update(empresas)
          .set({
            status: 'activa',
            isGeneradorCarga: opts.isGeneradorCarga,
            isTransportista: opts.isTransportista,
            carbonMeasurementEnabled: true,
          })
          .where(eq(empresas.id, found[0].id));
        return found[0].id;
      }
      const inserted = await db
        .insert(empresas)
        .values({
          planId,
          legalName: opts.legalName,
          rut: opts.rut,
          contactEmail: opts.email,
          contactPhone: '+56911111111',
          addressStreet: 'Calle E2E 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: opts.isGeneradorCarga,
          isTransportista: opts.isTransportista,
          carbonMeasurementEnabled: true,
          status: 'activa',
        })
        .returning({ id: empresas.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error(`no se insertó empresa ${opts.rut}`);
      }
      return id;
    }

    async function upsertUser(opts: {
      rut: string;
      uid: string;
      email: string;
      fullName: string;
    }): Promise<string> {
      await upsertFirebaseUser({
        uid: opts.uid,
        email: opts.email,
        displayName: opts.fullName,
      });
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.rut, opts.rut))
        .limit(1);
      if (found[0]) {
        await db
          .update(users)
          .set({
            firebaseUid: opts.uid,
            email: opts.email,
            claveNumericaHash: claveHash,
            status: 'activo',
          })
          .where(eq(users.id, found[0].id));
        return found[0].id;
      }
      const inserted = await db
        .insert(users)
        .values({
          firebaseUid: opts.uid,
          email: opts.email,
          fullName: opts.fullName,
          phone: '+56922222222',
          rut: opts.rut,
          status: 'activo',
          claveNumericaHash: claveHash,
        })
        .returning({ id: users.id });
      const id = inserted[0]?.id;
      if (!id) {
        throw new Error(`no se insertó usuario ${opts.rut}`);
      }
      return id;
    }

    const empGenId = await upsertEmpresa({
      rut: RUT_GEN,
      legalName: 'Generador E2E SpA',
      isGeneradorCarga: true,
      isTransportista: false,
      email: 'gen-e2e@boosterchile.invalid',
    });
    const empTraId = await upsertEmpresa({
      rut: RUT_TRA,
      legalName: 'Transportes E2E SpA',
      isGeneradorCarga: false,
      isTransportista: true,
      email: 'tra-e2e@boosterchile.invalid',
    });

    const genId = await upsertUser({
      rut: RUT_GEN,
      uid: 'e2e-gen-72727272-0',
      email: 'users+727272720@boosterchile.invalid',
      fullName: 'Dueño Generador E2E',
    });
    const traId = await upsertUser({
      rut: RUT_TRA,
      uid: 'e2e-tra-70707070-6',
      email: 'users+707070706@boosterchile.invalid',
      fullName: 'Dueño Transportista E2E',
    });
    const condId = await upsertUser({
      rut: RUT_COND,
      uid: 'e2e-cond-71717171-3',
      email: 'users+717171713@boosterchile.invalid',
      fullName: 'Conductor E2E',
    });

    async function upsertMembership(opts: {
      userId: string;
      empresaId: string;
      role: 'dueno' | 'conductor';
    }): Promise<void> {
      const found = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, opts.userId));
      const same = found.length > 0;
      if (same) {
        await db
          .update(memberships)
          .set({
            empresaId: opts.empresaId,
            role: opts.role,
            status: 'activa',
            joinedAt: new Date(),
          })
          .where(eq(memberships.userId, opts.userId));
        return;
      }
      await db.insert(memberships).values({
        userId: opts.userId,
        empresaId: opts.empresaId,
        role: opts.role,
        status: 'activa',
        joinedAt: new Date(),
      });
    }

    await upsertMembership({ userId: genId, empresaId: empGenId, role: 'dueno' });
    await upsertMembership({ userId: traId, empresaId: empTraId, role: 'dueno' });
    await upsertMembership({ userId: condId, empresaId: empTraId, role: 'conductor' });

    const vehFound = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.plate, PLATE))
      .limit(1);
    let vehicleId = vehFound[0]?.id;
    if (!vehicleId) {
      const inserted = await db
        .insert(vehicles)
        .values({
          empresaId: empTraId,
          plate: PLATE,
          vehicleType: 'camion_mediano',
          capacityKg: 12_000,
          fuelType: 'diesel',
          unitCategory: 'motriz',
          unitType: 'camion_rigido',
          vehicleStatus: 'activo',
        })
        .returning({ id: vehicles.id });
      vehicleId = inserted[0]?.id;
    }
    if (!vehicleId) {
      throw new Error('no se insertó vehículo E2E');
    }
    // Sin Teltonika: el teléfono reporta posición.
    await db
      .update(vehicles)
      .set({ teltonikaImei: null, empresaId: empTraId, vehicleStatus: 'activo' })
      .where(eq(vehicles.id, vehicleId));

    const e2eTrips = await db
      .select({ id: trips.id })
      .from(trips)
      .where(like(trips.trackingCode, 'E2E%'));
    const e2eTripIds = e2eTrips.map((t) => t.id);
    if (e2eTripIds.length > 0) {
      await db
        .update(assignments)
        .set({ status: 'cancelado' })
        .where(inArray(assignments.tripId, e2eTripIds));
    }

    const code = trackingCode();
    const insertedTrip = await db
      .insert(trips)
      .values({
        trackingCode: code,
        generadorCargaEmpresaId: empGenId,
        createdByUserId: genId,
        originAddressRaw: 'Av. Libertador Bernardo OHiggins 123, Santiago',
        originRegionCode: 'RM',
        originLatitude: '-33.4372000',
        originLongitude: '-70.6506000',
        destinationAddressRaw: 'Ruta 5 Norte km 12, Colina',
        destinationRegionCode: 'RM',
        cargoType: 'carga_seca',
        cargoWeightKg: 4_000,
        pickupDateRaw: 'hoy',
        status: 'asignado',
      })
      .returning({ id: trips.id });
    const tripId = insertedTrip[0]?.id;
    if (!tripId) {
      throw new Error('no se insertó viaje E2E');
    }

    const insertedOffer = await db
      .insert(offers)
      .values({
        tripId,
        empresaId: empTraId,
        suggestedVehicleId: vehicleId,
        score: 900,
        status: 'aceptada',
        proposedPriceClp: 150_000,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        respondedAt: new Date(),
        responseChannel: 'api',
      })
      .returning({ id: offers.id });
    const offerId = insertedOffer[0]?.id;
    if (!offerId) {
      throw new Error('no se insertó oferta E2E');
    }

    const insertedAssignment = await db
      .insert(assignments)
      .values({
        tripId,
        offerId,
        empresaId: empTraId,
        vehicleId,
        driverUserId: condId,
        status: 'asignado',
        agreedPriceClp: 150_000,
        publicTrackingToken: crypto.randomUUID(),
      })
      .returning({ id: assignments.id });
    const assignmentId = insertedAssignment[0]?.id;
    if (!assignmentId) {
      throw new Error('no se insertó asignación E2E');
    }

    logger.info(
      { assignmentId, tripId, trackingCode: code, conductor: RUT_COND },
      'seed T2 conductor E2E listo',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, 'seed T2 conductor E2E falló');
  process.exit(1);
});
