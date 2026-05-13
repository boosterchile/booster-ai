import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import type { Db } from '../db/client.js';
import {
  assignments,
  chatMessages,
  conductores,
  empresas,
  greenDrivingEvents,
  memberships,
  offers,
  plans,
  posicionesMovilConductor,
  sucursalesEmpresa,
  telemetryPoints,
  tripEvents,
  tripMetrics,
  trips,
  users,
  vehicles,
  zones,
} from '../db/schema.js';
import { generateActivationPin, hashActivationPin } from './activation-pin.js';

/**
 * D1 — Seed demo Booster AI.
 *
 * Crea un set sintético end-to-end de empresas, users, sucursales,
 * vehículos y conductores en producción, marcados con `is_demo=true` para
 * poder filtrarse de métricas/billing y borrarse en bloque.
 *
 * Decisiones:
 *
 * - **Sintético excepto IMEI**: el carrier demo tiene un vehículo que
 *   "mira" la telemetría del Teltonika real `863238075489155` via la
 *   columna `teltonika_imei_espejo` introducida en este sprint. El
 *   device físico sigue siendo de Van Oosterwyk (sin contaminación).
 *
 * - **Idempotencia**: si los emails sintéticos ya existen en Firebase
 *   (corrida previa del seed), los reusamos. Si las empresas demo
 *   existen (is_demo=true), devolvemos su info sin re-crearlas.
 *
 * - **Firebase Admin necesario**: creamos users reales en Firebase para
 *   los dueños (login email/password). El conductor sigue el flujo D9
 *   con PIN de activación (consistente con creación desde UI carrier).
 *
 * - **No oferta + asignación en este seed**: el flujo de aceptar oferta
 *   requiere data adicional (matching, polyline eco-route) que añade
 *   complejidad. Lo dejamos para que el demo lo cree manualmente desde
 *   la UI — es justamente lo que se quiere mostrar.
 */

export interface DemoCredentials {
  shipper_owner: { email: string; password: string };
  carrier_owner: { email: string; password: string };
  stakeholder: { email: string; password: string };
  conductor: { rut: string; activation_pin: string | null };
  carrier_empresa_id: string;
  shipper_empresa_id: string;
  vehicle_with_mirror_id: string;
  vehicle_without_device_id: string;
}

// RUTs en canónico (sin puntos). El rutSchema acepta input con o sin
// puntos y siempre normaliza al canónico — así que la BD almacena
// siempre el mismo formato sin importar cómo se tipea.
const DEMO_SHIPPER_RUT = '76999111-1';
const DEMO_CARRIER_RUT = '77888222-K';
const DEMO_CONDUCTOR_RUT = '12345678-5';
const DEMO_STAKEHOLDER_USER_RUT = '11999003-3';
const DEMO_SHIPPER_OWNER_RUT = '11999001-7';
const DEMO_CARRIER_OWNER_RUT = '11999002-5';

const DEMO_TELTONIKA_MIRROR = '863238075489155';

const SHIPPER_OWNER_EMAIL = 'demo-shipper@boosterchile.com';
const CARRIER_OWNER_EMAIL = 'demo-carrier@boosterchile.com';
const STAKEHOLDER_EMAIL = 'demo-stakeholder@boosterchile.com';
const DEMO_PASSWORD = 'BoosterDemo2026!';

/**
 * Crea (o reusa) el set demo completo. Idempotente: corridas sucesivas
 * devuelven el estado actual sin duplicar.
 */
export async function seedDemo(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
}): Promise<DemoCredentials> {
  const { db, firebaseAuth, logger } = opts;

  // 1. Resolver plan (estándar). Buscamos el plan_id ya existente.
  const planRows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, 'estandar'))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    throw new Error('Seed: plan "estandar" no existe — corre Drizzle migrations primero.');
  }
  const planId = plan.id;

  // 2. Empresa shipper.
  const shipperEmpresaId = await ensureEmpresa({
    db,
    planId,
    rut: DEMO_SHIPPER_RUT,
    legalName: 'Andina Demo S.A.',
    contactEmail: 'contacto@andinademo.cl',
    isGeneradorCarga: true,
    isTransportista: false,
  });

  // 3. Empresa carrier.
  const carrierEmpresaId = await ensureEmpresa({
    db,
    planId,
    rut: DEMO_CARRIER_RUT,
    legalName: 'Transportes Demo Sur S.A.',
    contactEmail: 'contacto@transportesdemosur.cl',
    isGeneradorCarga: false,
    isTransportista: true,
  });

  // 4. Users: dueño shipper + dueño carrier (Firebase Auth + DB).
  const shipperOwnerUserId = await ensureFirebaseUser({
    db,
    firebaseAuth,
    logger,
    email: SHIPPER_OWNER_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'Dueño Andina Demo',
    rut: DEMO_SHIPPER_OWNER_RUT,
    isPlatformAdmin: false,
  });
  const carrierOwnerUserId = await ensureFirebaseUser({
    db,
    firebaseAuth,
    logger,
    email: CARRIER_OWNER_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'Dueño Transportes Demo Sur',
    rut: DEMO_CARRIER_OWNER_RUT,
    isPlatformAdmin: false,
  });
  // D11 — Stakeholder demo. Login normal email/password, accede a
  // /app/stakeholder/zonas. Tiene membership rol stakeholder_sostenibilidad
  // en la empresa carrier (lo audita externamente).
  const stakeholderUserId = await ensureFirebaseUser({
    db,
    firebaseAuth,
    logger,
    email: STAKEHOLDER_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'Stakeholder Demo (Mesa pública sostenibilidad)',
    rut: DEMO_STAKEHOLDER_USER_RUT,
    isPlatformAdmin: false,
  });

  // 5. Memberships.
  await ensureMembership({
    db,
    userId: shipperOwnerUserId,
    empresaId: shipperEmpresaId,
    role: 'dueno',
  });
  await ensureMembership({
    db,
    userId: carrierOwnerUserId,
    empresaId: carrierEmpresaId,
    role: 'dueno',
  });
  // El stakeholder está enlazado al CARRIER (audita su operación). En
  // futuro podría tener su propia empresa "Mesa pública demo"; por ahora
  // mantener el modelo simple.
  await ensureMembership({
    db,
    userId: stakeholderUserId,
    empresaId: carrierEmpresaId,
    role: 'stakeholder_sostenibilidad',
  });

  // 6. Sucursales del shipper.
  await ensureSucursal({
    db,
    empresaId: shipperEmpresaId,
    nombre: 'Bodega Maipú',
    addressStreet: 'Av. Pajaritos 1234',
    addressCity: 'Maipú',
    addressRegion: 'XIII',
    latitude: '-33.5111',
    longitude: '-70.7575',
  });
  await ensureSucursal({
    db,
    empresaId: shipperEmpresaId,
    nombre: 'CD Quilicura',
    addressStreet: 'Av. Lo Echevers 555',
    addressCity: 'Quilicura',
    addressRegion: 'XIII',
    latitude: '-33.3500',
    longitude: '-70.7333',
  });

  // 7. Vehículos del carrier:
  //    A) Con teltonika_imei_espejo apuntando a Van Oosterwyk (data real).
  //    B) Sin device (preparado para D2 GPS móvil).
  const vehicleWithMirrorId = await ensureVehicle({
    db,
    empresaId: carrierEmpresaId,
    plate: 'DEMO01',
    vehicleType: 'camion_pesado',
    capacityKg: 14_000,
    brand: 'Volvo',
    model: 'FH 460',
    year: 2024,
    fuelType: 'diesel',
    teltonikaImeiEspejo: DEMO_TELTONIKA_MIRROR,
  });
  const vehicleWithoutDeviceId = await ensureVehicle({
    db,
    empresaId: carrierEmpresaId,
    plate: 'DEMO02',
    vehicleType: 'camion_pequeno',
    capacityKg: 5_500,
    brand: 'Ford',
    model: 'Cargo 815',
    year: 2022,
    fuelType: 'diesel',
  });

  // 8. Zonas operativas del carrier. Sin zonas, el matching engine no
  //    encuentra al carrier como candidato (filtro de zona/región es el
  //    primer paso en runMatching). Cubrimos región XIII (RM) donde el
  //    shipper tiene sucursales — y de paso V (Valparaíso) y VI (O'Higgins)
  //    para que el carrier aparezca como candidato si la demo crea trips
  //    interregionales típicos (RM → V, V → VI, etc.).
  //
  //    Tipo 'ambos' = el carrier recoge Y entrega en esa región. Es la
  //    opción más permisiva, alineada con un transportista real que opera
  //    multi-región. Si el operador quiere afinar (solo pickup vs solo
  //    delivery), puede editar desde la UI carrier.
  await ensureZone({
    db,
    empresaId: carrierEmpresaId,
    regionCode: 'XIII',
    zoneType: 'ambos',
  });
  await ensureZone({
    db,
    empresaId: carrierEmpresaId,
    regionCode: 'V',
    zoneType: 'ambos',
  });
  await ensureZone({
    db,
    empresaId: carrierEmpresaId,
    regionCode: 'VI',
    zoneType: 'ambos',
  });

  // 9. Conductor del carrier — flujo placeholder + PIN (D9).
  const driverResult = await ensureConductor({
    db,
    firebaseAuth,
    logger,
    empresaId: carrierEmpresaId,
    rut: DEMO_CONDUCTOR_RUT,
    fullName: 'Pedro González (Demo)',
    licenseClass: 'A5',
    licenseNumber: 'LIC-DEMO-001',
    licenseExpiry: '2028-12-31',
  });

  return {
    shipper_owner: { email: SHIPPER_OWNER_EMAIL, password: DEMO_PASSWORD },
    carrier_owner: { email: CARRIER_OWNER_EMAIL, password: DEMO_PASSWORD },
    stakeholder: { email: STAKEHOLDER_EMAIL, password: DEMO_PASSWORD },
    conductor: { rut: DEMO_CONDUCTOR_RUT, activation_pin: driverResult.activationPin },
    carrier_empresa_id: carrierEmpresaId,
    shipper_empresa_id: shipperEmpresaId,
    vehicle_with_mirror_id: vehicleWithMirrorId,
    vehicle_without_device_id: vehicleWithoutDeviceId,
  };
}

/**
 * Borra todo lo creado por el seed: empresas demo + cascada de FKs.
 */
/**
 * Borra todas las entidades creadas (o derivadas) del seed demo.
 *
 * Las empresas demo (`is_demo=true`) tienen FKs `ON DELETE RESTRICT` desde
 * múltiples tablas (viajes, ofertas, asignaciones, chat, telemetría…), así
 * que un simple `DELETE FROM empresas` falla con FK constraint error si
 * durante la demo se generó cualquier flujo (viaje, oferta, asignación,
 * mensaje, GPS). Acá hacemos la cascada manual en el orden correcto:
 *
 *   1. Para cada empresa demo (shipper Y/O carrier):
 *      - Encontrar todos los viajes donde la empresa es shipper, O donde
 *        recibió oferta como carrier, O donde aceptó como carrier.
 *      - Para cada viaje, borrar en orden: chat_messages → trip_events →
 *        trip_metrics → assignments → offers → trip.
 *   2. Telemetría de los vehículos de la empresa: posiciones_movil,
 *      telemetry_points, green_driving_events.
 *   3. Conductores, vehículos, sucursales, memberships, empresa (orden
 *      original).
 *   4. Usuarios conductores huérfanos (sin otras memberships).
 *
 * Idempotente — si no hay nada que borrar, no falla.
 *
 * **Decisión de scope**: borramos TODA la actividad de las empresas demo,
 * no solo lo "creado por el seed". Razón: una empresa marcada `is_demo`
 * no debería tener datos reales mezclados; cualquier flujo que hayan
 * generado en demo se asume desechable. Si en el futuro queremos
 * preservar "demos históricas" para auditoría post-pitch, hay que marcar
 * los trips también con `is_demo` y filtrar acá. Por ahora, scorched
 * earth para empresas demo.
 */
export async function deleteDemo(opts: { db: Db; logger: Logger }): Promise<{
  empresas_eliminadas: number;
  viajes_eliminados: number;
}> {
  const { db, logger } = opts;

  // Encontramos las empresas demo.
  const demoEmpresas = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.isDemo, true));

  if (demoEmpresas.length === 0) {
    return { empresas_eliminadas: 0, viajes_eliminados: 0 };
  }

  const demoEmpresaIds = demoEmpresas.map((e) => e.id);
  let totalViajesEliminados = 0;

  await db.transaction(async (tx) => {
    // 1. Identificar todos los viajes que tocan alguna empresa demo
    //    (como shipper o vía ofertas/asignaciones al carrier).
    const tripsAsShipper = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(inArray(trips.generadorCargaEmpresaId, demoEmpresaIds));
    const tripsViaOffers = await tx
      .select({ tripId: offers.tripId })
      .from(offers)
      .where(inArray(offers.empresaId, demoEmpresaIds));
    const tripsViaAssignments = await tx
      .select({ tripId: assignments.tripId })
      .from(assignments)
      .where(inArray(assignments.empresaId, demoEmpresaIds));

    const allTripIds = [
      ...new Set([
        ...tripsAsShipper.map((r) => r.id),
        ...tripsViaOffers.map((r) => r.tripId),
        ...tripsViaAssignments.map((r) => r.tripId),
      ]),
    ];
    totalViajesEliminados = allTripIds.length;

    if (allTripIds.length > 0) {
      // 2. Asignaciones de esos viajes → necesitamos sus IDs para chat.
      const assignmentRows = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(inArray(assignments.tripId, allTripIds));
      const assignmentIds = assignmentRows.map((r) => r.id);

      // 3. Chat messages primero (apuntan a assignments).
      if (assignmentIds.length > 0) {
        await tx.delete(chatMessages).where(inArray(chatMessages.assignmentId, assignmentIds));
      }

      // 4. Trip events (apuntan a trip).
      await tx.delete(tripEvents).where(inArray(tripEvents.tripId, allTripIds));

      // 5. Trip metrics (apuntan a trip).
      await tx.delete(tripMetrics).where(inArray(tripMetrics.tripId, allTripIds));

      // 6. Assignments (apuntan a trip + carrier empresa + vehicle).
      if (assignmentIds.length > 0) {
        await tx.delete(assignments).where(inArray(assignments.tripId, allTripIds));
      }

      // 7. Offers (apuntan a trip + carrier empresa + suggested vehicle).
      await tx.delete(offers).where(inArray(offers.tripId, allTripIds));

      // 8. El trip mismo (apunta a shipper empresa).
      await tx.delete(trips).where(inArray(trips.id, allTripIds));
    }

    // 9. Por cada empresa demo, limpiar vehículos + telemetría + el resto
    //    (orden conservado del flujo original).
    for (const emp of demoEmpresas) {
      // 9a. Vehículos de la empresa → necesitamos sus IDs para telemetría.
      const vehicleRows = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.empresaId, emp.id));
      const vehicleIds = vehicleRows.map((r) => r.id);

      if (vehicleIds.length > 0) {
        // Telemetría / GPS móvil / driving events apuntan a vehicle_id RESTRICT.
        await tx
          .delete(posicionesMovilConductor)
          .where(inArray(posicionesMovilConductor.vehicleId, vehicleIds));
        await tx.delete(telemetryPoints).where(inArray(telemetryPoints.vehicleId, vehicleIds));
        await tx
          .delete(greenDrivingEvents)
          .where(inArray(greenDrivingEvents.vehicleId, vehicleIds));
      }

      // 9b. Conductores → users via cascada manual (driverUserIds para
      //     borrar al final si no tienen otras memberships).
      const driverRows = await tx
        .select({ id: conductores.id, userId: conductores.userId })
        .from(conductores)
        .where(eq(conductores.empresaId, emp.id));
      const driverUserIds = driverRows.map((d) => d.userId);

      if (driverRows.length > 0) {
        await tx.delete(conductores).where(eq(conductores.empresaId, emp.id));
      }

      await tx.delete(vehicles).where(eq(vehicles.empresaId, emp.id));
      await tx.delete(zones).where(eq(zones.empresaId, emp.id));
      await tx.delete(sucursalesEmpresa).where(eq(sucursalesEmpresa.empresaId, emp.id));
      await tx.delete(memberships).where(eq(memberships.empresaId, emp.id));
      await tx.delete(empresas).where(eq(empresas.id, emp.id));

      // 9c. Borrar los user-conductores que solo existían para este demo
      //     (no tienen otras memberships).
      for (const uid of driverUserIds) {
        const otherMemberships = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, uid))
          .limit(1);
        if (otherMemberships.length === 0) {
          await tx.delete(users).where(eq(users.id, uid));
        }
      }
    }
  });

  logger.info(
    {
      empresasEliminadas: demoEmpresas.length,
      viajesEliminados: totalViajesEliminados,
    },
    'seed-demo: cleanup completo',
  );

  return {
    empresas_eliminadas: demoEmpresas.length,
    viajes_eliminados: totalViajesEliminados,
  };
}

// ---------------------------------------------------------------------------
// Helpers internos (idempotentes — solo crean si no existe).
// ---------------------------------------------------------------------------

async function ensureEmpresa(opts: {
  db: Db;
  planId: string;
  rut: string;
  legalName: string;
  contactEmail: string;
  isGeneradorCarga: boolean;
  isTransportista: boolean;
}): Promise<string> {
  const { db, planId, rut, legalName, contactEmail, isGeneradorCarga, isTransportista } = opts;
  const existing = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.rut, rut))
    .limit(1);
  if (existing.length > 0 && existing[0]) {
    return existing[0].id;
  }
  const inserted = await db
    .insert(empresas)
    .values({
      legalName,
      rut,
      contactEmail,
      contactPhone: '+56221234567',
      addressStreet: 'Av. Apoquindo 6275',
      addressCity: 'Las Condes',
      addressRegion: 'XIII',
      isGeneradorCarga,
      isTransportista,
      planId,
      status: 'activa',
      isDemo: true,
    })
    .returning({ id: empresas.id });
  const row = inserted[0];
  if (!row) {
    throw new Error('empresa insert returned no row');
  }
  return row.id;
}

async function ensureFirebaseUser(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
  email: string;
  password: string;
  fullName: string;
  rut: string;
  isPlatformAdmin: boolean;
}): Promise<string> {
  const { db, firebaseAuth, logger, email, password, fullName, rut, isPlatformAdmin } = opts;

  // 1. Firebase user (crear si no existe; reusar si existe).
  let firebaseUid: string;
  const existingFb = await firebaseAuth.getUserByEmail(email).catch(() => null);
  if (existingFb) {
    firebaseUid = existingFb.uid;
    // Reset password al conocido por idempotencia.
    await firebaseAuth.updateUser(firebaseUid, { password });
  } else {
    const created = await firebaseAuth.createUser({
      email,
      emailVerified: false,
      password,
      displayName: fullName,
      disabled: false,
    });
    firebaseUid = created.uid;
    logger.info({ email, firebaseUid }, 'Demo Firebase user created');
  }

  // 2. DB user (insert si no existe; update si sí — para sincronizar UID).
  const existingDbUser = await db
    .select({ id: users.id, firebaseUid: users.firebaseUid })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingDbUser.length > 0 && existingDbUser[0]) {
    const existing = existingDbUser[0];
    // Si el firebase_uid en BD no matchea el real (puede pasar tras
    // resets), lo actualizamos.
    if (existing.firebaseUid !== firebaseUid) {
      await db
        .update(users)
        .set({ firebaseUid, updatedAt: sql`now()` })
        .where(eq(users.id, existing.id));
    }
    return existing.id;
  }

  const inserted = await db
    .insert(users)
    .values({
      firebaseUid,
      email,
      fullName,
      rut,
      status: 'activo',
      isPlatformAdmin,
    })
    .returning({ id: users.id });
  const row = inserted[0];
  if (!row) {
    throw new Error('user insert returned no row');
  }
  return row.id;
}

async function ensureMembership(opts: {
  db: Db;
  userId: string;
  empresaId: string;
  role:
    | 'dueno'
    | 'admin'
    | 'despachador'
    | 'conductor'
    | 'visualizador'
    | 'stakeholder_sostenibilidad';
}): Promise<void> {
  const { db, userId, empresaId, role } = opts;
  // Si ya existe membership con ese (user, empresa, role) → no-op.
  const existing = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(50);
  const alreadyHasRole = existing.some(() => false); // necesita full row; simplificamos
  void alreadyHasRole;

  // Approach simple: try insert; si choca por UNIQUE composite, ignore.
  try {
    await db.insert(memberships).values({
      userId,
      empresaId,
      role,
      status: 'activa',
      joinedAt: sql`now()`,
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '23505') {
      throw err;
    }
  }
}

async function ensureSucursal(opts: {
  db: Db;
  empresaId: string;
  nombre: string;
  addressStreet: string;
  addressCity: string;
  addressRegion: string;
  latitude: string;
  longitude: string;
}): Promise<void> {
  const { db, empresaId, nombre } = opts;
  // Check por (empresa_id, nombre) — no unique en BD, así que solo evitamos
  // duplicar visualmente.
  const existing = await db
    .select({ id: sucursalesEmpresa.id })
    .from(sucursalesEmpresa)
    .where(eq(sucursalesEmpresa.empresaId, empresaId))
    .limit(50);
  // Lookup nombre en memoria (chico, ok para seed).
  // Si ya está esa empresa con esa misma sucursal nombre activa, skip.
  const existingByName = await db
    .select({ id: sucursalesEmpresa.id, nombre: sucursalesEmpresa.nombre })
    .from(sucursalesEmpresa)
    .where(eq(sucursalesEmpresa.empresaId, empresaId));
  if (existingByName.some((s) => s.nombre === nombre)) {
    return;
  }
  void existing;
  await db.insert(sucursalesEmpresa).values({
    empresaId,
    nombre,
    addressStreet: opts.addressStreet,
    addressCity: opts.addressCity,
    addressRegion: opts.addressRegion,
    latitude: opts.latitude,
    longitude: opts.longitude,
  });
}

/**
 * Idempotente: si ya existe una zona activa con la misma terna
 * (empresa, region, tipo), no la duplica. Las zonas son críticas para
 * que el matching engine considere al carrier candidato — sin una zona
 * en la región del origen del trip, `runMatching` falla en el primer
 * filtro con `no_carrier_in_origin_region`.
 */
async function ensureZone(opts: {
  db: Db;
  empresaId: string;
  regionCode: string;
  zoneType: 'recogida' | 'entrega' | 'ambos';
}): Promise<void> {
  const { db, empresaId, regionCode, zoneType } = opts;
  const existing = await db
    .select({ id: zones.id })
    .from(zones)
    .where(eq(zones.empresaId, empresaId));
  // Lookup en memoria por terna (empresa, region, tipo). Set chico.
  const existingByKey = await db
    .select({
      id: zones.id,
      regionCode: zones.regionCode,
      zoneType: zones.zoneType,
    })
    .from(zones)
    .where(eq(zones.empresaId, empresaId));
  if (existingByKey.some((z) => z.regionCode === regionCode && z.zoneType === zoneType)) {
    return;
  }
  void existing;
  await db.insert(zones).values({
    empresaId,
    regionCode,
    zoneType,
    isActive: true,
  });
}

async function ensureVehicle(opts: {
  db: Db;
  empresaId: string;
  plate: string;
  vehicleType:
    | 'camioneta'
    | 'furgon_pequeno'
    | 'furgon_mediano'
    | 'camion_pequeno'
    | 'camion_mediano'
    | 'camion_pesado'
    | 'semi_remolque'
    | 'refrigerado'
    | 'tanque';
  capacityKg: number;
  brand?: string;
  model?: string;
  year?: number;
  fuelType?:
    | 'diesel'
    | 'gasolina'
    | 'gas_glp'
    | 'gas_gnc'
    | 'electrico'
    | 'hibrido_diesel'
    | 'hibrido_gasolina'
    | 'hidrogeno';
  teltonikaImeiEspejo?: string;
}): Promise<string> {
  const { db, empresaId, plate } = opts;
  const existing = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.plate, plate))
    .limit(1);
  if (existing.length > 0 && existing[0]) {
    return existing[0].id;
  }
  const inserted = await db
    .insert(vehicles)
    .values({
      empresaId,
      plate,
      vehicleType: opts.vehicleType,
      capacityKg: opts.capacityKg,
      brand: opts.brand ?? null,
      model: opts.model ?? null,
      year: opts.year ?? null,
      fuelType: opts.fuelType ?? null,
      teltonikaImeiEspejo: opts.teltonikaImeiEspejo ?? null,
      vehicleStatus: 'activo',
    })
    .returning({ id: vehicles.id });
  const row = inserted[0];
  if (!row) {
    throw new Error('vehicle insert returned no row');
  }
  return row.id;
}

async function ensureConductor(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
  empresaId: string;
  rut: string;
  fullName: string;
  licenseClass: 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B' | 'C' | 'D' | 'E' | 'F';
  licenseNumber: string;
  licenseExpiry: string;
}): Promise<{ conductorId: string; activationPin: string | null }> {
  const { db, empresaId, rut, fullName } = opts;

  // 1. Find or create placeholder user (path D9 normal).
  const placeholderUid = `pending-rut:${rut}`;
  let userId: string;
  let activationPin: string | null = null;

  const existingUser = await db
    .select({ id: users.id, firebaseUid: users.firebaseUid })
    .from(users)
    .where(eq(users.rut, rut))
    .limit(1);

  if (existingUser.length > 0 && existingUser[0]) {
    userId = existingUser[0].id;
    // Si el UID sigue siendo placeholder, regeneramos el PIN para el demo
    // (idempotente: el dueño del demo siempre puede activar de nuevo).
    if (existingUser[0].firebaseUid.startsWith('pending-rut:')) {
      activationPin = generateActivationPin();
      await db
        .update(users)
        .set({ activationPinHash: hashActivationPin(activationPin), updatedAt: sql`now()` })
        .where(eq(users.id, userId));
    }
  } else {
    activationPin = generateActivationPin();
    const inserted = await db
      .insert(users)
      .values({
        firebaseUid: placeholderUid,
        email: `pending-rut-${rut.replace(/[.\-]/g, '')}@boosterchile.invalid`,
        fullName,
        rut,
        status: 'pendiente_verificacion',
        activationPinHash: hashActivationPin(activationPin),
      })
      .returning({ id: users.id });
    const row = inserted[0];
    if (!row) {
      throw new Error('user (conductor) insert returned no row');
    }
    userId = row.id;
  }

  // 2. Find or create conductor (UNIQUE user_id).
  const existingDriver = await db
    .select({ id: conductores.id, deletedAt: conductores.deletedAt })
    .from(conductores)
    .where(eq(conductores.userId, userId))
    .limit(1);
  if (existingDriver.length > 0 && existingDriver[0] && existingDriver[0].deletedAt == null) {
    return { conductorId: existingDriver[0].id, activationPin };
  }

  const inserted = await db
    .insert(conductores)
    .values({
      userId,
      empresaId,
      licenseClass: opts.licenseClass,
      licenseNumber: opts.licenseNumber,
      licenseExpiry: new Date(`${opts.licenseExpiry}T00:00:00.000Z`),
      isExtranjero: false,
      driverStatus: 'activo',
    })
    .returning({ id: conductores.id });
  const row = inserted[0];
  if (!row) {
    throw new Error('conductor insert returned no row');
  }

  // 3. Crear membership con rol='conductor' si no existe ya. Invariante
  //    del modelo (migration 0029): todo conductor activo tiene
  //    membership en la misma empresa con role=conductor.
  //    Estado: 'pendiente_invitacion' mientras el firebase_uid es
  //    placeholder; cuando el conductor activa via D9 (driver-activate)
  //    se promueve a 'activa'.
  const existingMembership = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.empresaId, empresaId)))
    .limit(1);
  if (existingMembership.length === 0) {
    await db.insert(memberships).values({
      userId,
      empresaId,
      role: 'conductor',
      // El user del conductor recién creado siempre arranca pending —
      // activationPin presente significa que aún no se activó.
      status: activationPin ? 'pendiente_invitacion' : 'activa',
    });
  }

  return { conductorId: row.id, activationPin };
}
