import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { PRICING_METHODOLOGY_VERSION_V3 } from '@booster-ai/pricing-engine';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { leerConfiguracionPublicada } from '../../src/services/configuracion-comercial.js';
import { liquidarTrip } from '../../src/services/liquidar-trip.js';
import {
  aceptarSolicitudCambio,
  crearSolicitudCambio,
} from '../../src/services/solicitud-cambio-carga.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas §7 (PR8) contra Postgres real: aceptar un cambio de
 * precio o modalidad recalcula precio acordado y comisión con la versión de
 * configuración congelada al publicar, y la liquidación lo refleja.
 */
const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: cambio de precio y modalidad tras el match (§7)', () => {
  let handle: TestDbHandle;
  let congelada: typeof schema.configuracionComercial.$inferSelect;

  beforeAll(async () => {
    handle = createTestDb();
    const vigente = await leerConfiguracionPublicada(handle.db);
    // Una versión anterior, distinta de la vigente: spot 15 %, programada 8 %.
    const [maximo] = await handle.db
      .select({ version: schema.configuracionComercial.version })
      .from(schema.configuracionComercial)
      .orderBy(schema.configuracionComercial.version);
    congelada = uno(
      await handle.db
        .insert(schema.configuracionComercial)
        .values({
          version: (maximo?.version ?? 0) + 1000 + Math.floor(Math.random() * 1000),
          config: {
            ...vigente.config,
            comisiones: { ...vigente.config.comisiones, spot_pct: 15, programada_pct: 8 },
          },
          publicada: false,
          notaCambio: 'fixture: versión congelada de un viaje',
          creadoPorEmail: 'fixture@test.invalid',
        })
        .returning(),
      'configuración congelada',
    );
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function viajeAsignado(opts: { congelar: boolean; contrato: boolean }) {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `P ${s}`,
            description: 'f',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-c8-${s}`,
          email: `c8-${s}@test.invalid`,
          fullName: 'C8',
          rut: rutAleatorio(),
        })
        .returning(),
      'user',
    );
    const empresa = async (generador: boolean) =>
      uno(
        await db
          .insert(schema.empresas)
          .values({
            legalName: `${generador ? 'Gen' : 'Tra'} ${s}`,
            rut: rutAleatorio(),
            contactEmail: `${generador ? 'g' : 't'}-${s}@test.invalid`,
            contactPhone: '+56911111111',
            addressStreet: 'C 1',
            addressCity: 'Santiago',
            addressRegion: 'RM',
            isGeneradorCarga: generador,
            isTransportista: !generador,
            status: 'activa',
            planId: plan.id,
            ...(generador && opts.contrato ? { contratoProgramadoActivadoEn: new Date() } : {}),
          })
          .returning(),
        'empresa',
      );
    const generador = await empresa(true);
    const transportista = await empresa(false);
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: transportista.id,
          plate: `C8${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generador.id,
          createdByUserId: user.id,
          originAddressRaw: 'Origen 123',
          destinationAddressRaw: 'Destino 456',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          proposedPriceClp: 700_000,
          modalidadCarga: 'spot',
          status: 'asignado',
          ...(opts.congelar
            ? { comisionPctAplicada: '15.00', configuracionComercialId: congelada.id }
            : {}),
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: transportista.id,
          score: 900,
          proposedPriceClp: 700_000,
          expiresAt: new Date(Date.now() + 3_600_000),
          status: 'aceptada',
        })
        .returning(),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: transportista.id,
          vehicleId: vehiculo.id,
          driverUserId: user.id,
          agreedPriceClp: 700_000,
          status: 'asignado',
          acceptedAt: new Date(Date.now() - 7_200_000),
        })
        .returning(),
      'asignación',
    );
    return { viaje, oferta, asignacion, generador, transportista, user };
  }

  async function proponerYAceptar(
    f: Awaited<ReturnType<typeof viajeAsignado>>,
    cambios: Parameters<typeof crearSolicitudCambio>[1]['cambios'],
  ) {
    const deps = { db: handle.db, logger };
    const creada = await crearSolicitudCambio(deps, {
      tripId: f.viaje.id,
      empresaId: f.generador.id,
      userId: f.user.id,
      cambios,
    });
    if (!creada.ok) {
      throw new Error(`no se creó la solicitud: ${creada.code}`);
    }
    const aceptada = await aceptarSolicitudCambio(deps, {
      assignmentId: f.asignacion.id,
      empresaId: f.transportista.id,
      userId: f.user.id,
      solicitudId: creada.solicitud.id,
    });
    return { creada, aceptada };
  }

  const leer = async (f: Awaited<ReturnType<typeof viajeAsignado>>) => ({
    viaje: uno(
      await handle.db.select().from(schema.trips).where(eq(schema.trips.id, f.viaje.id)),
      'viaje',
    ),
    asignacion: uno(
      await handle.db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.id, f.asignacion.id)),
      'asignación',
    ),
    oferta: uno(
      await handle.db.select().from(schema.offers).where(eq(schema.offers.id, f.oferta.id)),
      'oferta',
    ),
  });

  test('precio y modalidad: viaje y asignación con el precio nuevo, tasa congelada, oferta intacta; la liquidación lo refleja', async () => {
    const f = await viajeAsignado({ congelar: true, contrato: true });
    const { creada, aceptada } = await proponerYAceptar(f, {
      proposed_price_clp: 900_000,
      modalidad_carga: 'programada',
    });
    expect(creada.ok && creada.desglosePropuesto).toMatchObject({
      precio_transportista_clp: 900_000,
      comision_pct: 8,
      comision_clp: 72_000,
    });
    expect(aceptada.ok).toBe(true);

    const despues = await leer(f);
    expect(despues.viaje).toMatchObject({
      proposedPriceClp: 900_000,
      modalidadCarga: 'programada',
      comisionPctAplicada: '8.00',
      configuracionComercialId: congelada.id,
    });
    expect(despues.asignacion.agreedPriceClp).toBe(900_000);
    expect(despues.oferta.proposedPriceClp).toBe(700_000);

    const [evento] = await handle.db
      .select({ payload: schema.tripEvents.payload })
      .from(schema.tripEvents)
      .where(eq(schema.tripEvents.tripId, f.viaje.id))
      .orderBy(schema.tripEvents.recordedAt);
    expect(evento).toBeDefined();
    const editada = (
      await handle.db
        .select({ tipo: schema.tripEvents.eventType, payload: schema.tripEvents.payload })
        .from(schema.tripEvents)
        .where(eq(schema.tripEvents.tripId, f.viaje.id))
    ).find((e) => e.tipo === 'carga_editada');
    expect(editada?.payload).toMatchObject({
      comercial: {
        precio_acordado_antes: 700_000,
        precio_acordado_despues: 900_000,
        comision_pct_antes: '15.00',
        comision_pct_despues: '8.00',
      },
    });

    // Entrega → liquidación con el precio y la tasa nuevos, IVA de la versión congelada.
    await handle.db
      .update(schema.trips)
      .set({ status: 'entregado' })
      .where(eq(schema.trips.id, f.viaje.id));
    await handle.db
      .update(schema.assignments)
      .set({ status: 'entregado', deliveredAt: new Date() })
      .where(eq(schema.assignments.id, f.asignacion.id));
    const r = await liquidarTrip({
      db: handle.db,
      logger,
      assignmentId: f.asignacion.id,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(r.status).toBe('liquidacion_creada');
    const liq = uno(
      await handle.db
        .select()
        .from(schema.liquidaciones)
        .where(eq(schema.liquidaciones.asignacionId, f.asignacion.id)),
      'liquidación',
    );
    const iva = congelada.config.impuestos.iva_pct;
    expect(liq).toMatchObject({
      pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
      precioTransportistaClp: 900_000,
      comisionClp: 72_000,
      ivaComisionClp: Math.round(72_000 * (iva / 100)),
      modalidadCarga: 'programada',
      configuracionComercialId: congelada.id,
    });
  });

  test('un viaje sin tasa congelada no gana tasa al cambiar de modalidad', async () => {
    const f = await viajeAsignado({ congelar: false, contrato: true });
    const { creada, aceptada } = await proponerYAceptar(f, { modalidad_carga: 'programada' });
    expect(creada.ok && creada.desglosePropuesto).toBeNull();
    expect(aceptada.ok).toBe(true);
    const despues = await leer(f);
    expect(despues.viaje).toMatchObject({
      modalidadCarga: 'programada',
      comisionPctAplicada: null,
    });
    expect(despues.asignacion.agreedPriceClp).toBe(700_000);
  });

  test('con liquidación existente, aceptar invalida la solicitud y no escribe el cambio', async () => {
    const f = await viajeAsignado({ congelar: true, contrato: true });
    const deps = { db: handle.db, logger };
    const creada = await crearSolicitudCambio(deps, {
      tripId: f.viaje.id,
      empresaId: f.generador.id,
      userId: f.user.id,
      cambios: { proposed_price_clp: 900_000 },
    });
    if (!creada.ok) {
      throw new Error(creada.code);
    }
    await handle.db.insert(schema.liquidaciones).values({
      asignacionId: f.asignacion.id,
      empresaCarrierId: f.transportista.id,
      tierSlugAplicado: 'free',
      montoBrutoClp: 700_000,
      comisionPct: '15.00',
      comisionClp: 105_000,
      montoNetoCarrierClp: 595_000,
      ivaComisionClp: 19_950,
      totalFacturaBoosterClp: 124_950,
      pricingMethodologyVersion: 'test',
      status: 'pending_consent',
    });
    const r = await aceptarSolicitudCambio(deps, {
      assignmentId: f.asignacion.id,
      empresaId: f.transportista.id,
      userId: f.user.id,
      solicitudId: creada.solicitud.id,
    });
    expect(r).toEqual({ ok: false, code: 'solicitud_invalidada', motivo: 'viaje_no_asignado' });
    const despues = await leer(f);
    expect(despues.viaje.proposedPriceClp).toBe(700_000);
    expect(despues.asignacion.agreedPriceClp).toBe(700_000);
  });

  test('si el contrato programado se desactivó antes de responder: 422 y la solicitud sigue pendiente', async () => {
    const f = await viajeAsignado({ congelar: true, contrato: true });
    const deps = { db: handle.db, logger };
    const creada = await crearSolicitudCambio(deps, {
      tripId: f.viaje.id,
      empresaId: f.generador.id,
      userId: f.user.id,
      cambios: { modalidad_carga: 'programada' },
    });
    if (!creada.ok) {
      throw new Error(creada.code);
    }
    await handle.db
      .update(schema.empresas)
      .set({ contratoProgramadoActivadoEn: null })
      .where(eq(schema.empresas.id, f.generador.id));
    const r = await aceptarSolicitudCambio(deps, {
      assignmentId: f.asignacion.id,
      empresaId: f.transportista.id,
      userId: f.user.id,
      solicitudId: creada.solicitud.id,
    });
    expect(r).toEqual({ ok: false, code: 'contrato_programado_no_habilitado' });
    const [sol] = await handle.db
      .select({ status: schema.tripChangeRequests.status })
      .from(schema.tripChangeRequests)
      .where(eq(schema.tripChangeRequests.id, creada.solicitud.id));
    expect(sol?.status).toBe('pendiente');
  });

  test('proponer programada sin contrato → contrato_programado_no_habilitado', async () => {
    const f = await viajeAsignado({ congelar: true, contrato: false });
    const r = await crearSolicitudCambio(
      { db: handle.db, logger },
      {
        tripId: f.viaje.id,
        empresaId: f.generador.id,
        userId: f.user.id,
        cambios: { modalidad_carga: 'programada' },
      },
    );
    expect(r).toEqual({ ok: false, code: 'contrato_programado_no_habilitado' });
  });
});
