import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { PRICING_METHODOLOGY_VERSION_V3 } from '@booster-ai/pricing-engine';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { leerConfiguracionPublicada } from '../../src/services/configuracion-comercial.js';
import { liquidarTrip } from '../../src/services/liquidar-trip.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-079 §6 contra Postgres real: con PRICING_V3_ACTIVATED, un viaje
 * publicado con tasa congelada se liquida v3 (el generador paga la comisión
 * encima; el transportista recibe su precio íntegro; sin exigir membresía);
 * un viaje publicado bajo v2 no se liquida v3.
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

describe('integration: liquidación v3 (ADR-079 §6)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function asignacionEntregada(congelar: boolean) {
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
        .values({ firebaseUid: `fb-l3-${s}`, email: `l3-${s}@test.invalid`, fullName: 'L3' })
        .returning(),
      'user',
    );
    const empresa = async (generador: boolean) =>
      uno(
        await db
          .insert(schema.empresas)
          .values({
            legalName: `${generador ? 'Gen' : 'Tra'} ${s}`,
            rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
            contactEmail: `${generador ? 'g' : 't'}-${s}@test.invalid`,
            contactPhone: '+56911111111',
            addressStreet: 'C 1',
            addressCity: 'Santiago',
            addressRegion: 'RM',
            isGeneradorCarga: generador,
            isTransportista: !generador,
            planId: plan.id,
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
          plate: `L3${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    const vigente = await leerConfiguracionPublicada(db);
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generador.id,
          createdByUserId: user.id,
          originAddressRaw: 'Origen',
          destinationAddressRaw: 'Destino',
          cargoType: 'carga_seca',
          pickupDateRaw: '2026-10-08',
          proposedPriceClp: 700_000,
          status: 'entregado',
          ...(congelar
            ? { comisionPctAplicada: '20.00', configuracionComercialId: vigente.id }
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
          status: 'entregado',
          acceptedAt: new Date(Date.now() - 7_200_000),
          deliveredAt: new Date(),
        })
        .returning(),
      'asignación',
    );
    return { asignacion, transportista, vigente };
  }

  test('viaje con tasa congelada → liquidación v3, sin membresía, transportista íntegro', async () => {
    const { asignacion, transportista, vigente } = await asignacionEntregada(true);
    const r = await liquidarTrip({
      db: handle.db,
      logger,
      assignmentId: asignacion.id,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(r.status).toBe('liquidacion_creada');
    const fila = uno(
      await handle.db
        .select()
        .from(schema.liquidaciones)
        .where(eq(schema.liquidaciones.asignacionId, asignacion.id)),
      'liquidación',
    );
    const iva = vigente.config.impuestos.iva_pct;
    const ivaComision = Math.round(140_000 * (iva / 100));
    expect(fila).toMatchObject({
      empresaCarrierId: transportista.id,
      tierSlugAplicado: null,
      pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
      precioTransportistaClp: 700_000,
      montoNetoCarrierClp: 700_000,
      comisionClp: 140_000,
      ivaComisionClp: ivaComision,
      precioGeneradorClp: 840_000,
      totalFacturaGeneradorClp: 140_000 + ivaComision,
      modalidadCarga: 'spot',
      configuracionComercialId: vigente.id,
      status: 'lista_para_dte',
    });

    const otra = await liquidarTrip({
      db: handle.db,
      logger,
      assignmentId: asignacion.id,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(otra).toEqual({ status: 'ya_liquidada', liquidacionId: fila.id });
  });

  test('viaje publicado bajo v2 (sin tasa congelada) con v2 apagado → no se liquida', async () => {
    const { asignacion } = await asignacionEntregada(false);
    const r = await liquidarTrip({
      db: handle.db,
      logger,
      assignmentId: asignacion.id,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(r.status).toBe('skipped_flag_disabled');
  });
});
