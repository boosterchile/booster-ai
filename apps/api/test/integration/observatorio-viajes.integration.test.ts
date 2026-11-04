import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { leerViajesEntregados } from '../../src/services/observatorio/viajes-entregados.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T10-24 — la fuente del observatorio contra Postgres real: solo viajes
 * entregados, con vehículo y emisiones, y nunca de empresas demo o de prueba.
 */
const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: fuente del observatorio (ADR-012 Capa 2)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function escenario() {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({ slug: 'gratis', name: 'G', description: 'f', monthlyPriceClp: 0, features: {} })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-obs-${s}`, email: `obs-${s}@test.invalid`, fullName: 'Obs' })
        .returning(),
      'user',
    );
    const empresa = async (o: { generador: boolean; demo?: boolean }) =>
      uno(
        await db
          .insert(schema.empresas)
          .values({
            legalName: `Obs ${s} ${randomUUID().slice(0, 4)}`,
            rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
            contactEmail: `obs-${randomUUID().slice(0, 8)}@test.invalid`,
            contactPhone: '+56911111111',
            addressStreet: 'C 1',
            addressCity: 'Coquimbo',
            addressRegion: 'IV',
            isGeneradorCarga: o.generador,
            isTransportista: !o.generador,
            isDemo: o.demo ?? false,
            planId: plan.id,
          })
          .returning(),
        'empresa',
      );
    const generador = await empresa({ generador: true });
    const generadorDemo = await empresa({ generador: true, demo: true });
    const transportista = await empresa({ generador: false });
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: transportista.id,
          plate: `OB${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_pesado',
          capacityKg: 20000,
        })
        .returning(),
      'vehículo',
    );

    async function viaje(o: {
      generadorId: string;
      status: 'entregado' | 'asignado';
      metricas?: { reales: string | null; estimadas: string; evitado: string };
    }) {
      const t = uno(
        await db
          .insert(schema.trips)
          .values({
            trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
            generadorCargaEmpresaId: o.generadorId,
            createdByUserId: user.id,
            originAddressRaw: 'Puerto de Coquimbo',
            originRegionCode: 'IV',
            originComunaCode: '04102',
            destinationAddressRaw: 'La Serena',
            destinationRegionCode: 'IV',
            cargoType: 'carga_seca',
            pickupDateRaw: '2026-10-07',
            status: o.status,
          })
          .returning(),
        'viaje',
      );
      const oferta = uno(
        await db
          .insert(schema.offers)
          .values({
            tripId: t.id,
            empresaId: transportista.id,
            score: 900,
            proposedPriceClp: 300_000,
            expiresAt: new Date(Date.now() + 3_600_000),
          })
          .returning(),
        'oferta',
      );
      await db.insert(schema.assignments).values({
        tripId: t.id,
        offerId: oferta.id,
        empresaId: transportista.id,
        vehicleId: vehiculo.id,
        driverUserId: user.id,
        agreedPriceClp: 300_000,
        status: o.status === 'entregado' ? 'entregado' : 'asignado',
        acceptedAt: new Date('2026-10-07T12:00:00Z'),
        pickedUpAt: new Date('2026-10-07T13:30:00Z'),
        deliveredAt: o.status === 'entregado' ? new Date('2026-10-07T16:00:00Z') : null,
      });
      if (o.metricas) {
        await db.insert(schema.tripMetrics).values({
          tripId: t.id,
          distanceKmEstimated: '40.00',
          carbonEmissionsKgco2eEstimated: o.metricas.estimadas,
          carbonEmissionsKgco2eActual: o.metricas.reales,
          ahorroCo2eVsSinMatchingKgco2e: o.metricas.evitado,
        });
      }
      return t;
    }

    const entregado = await viaje({
      generadorId: generador.id,
      status: 'entregado',
      metricas: { reales: '35.120', estimadas: '40.000', evitado: '12.300' },
    });
    const enCurso = await viaje({ generadorId: generador.id, status: 'asignado' });
    const demo = await viaje({ generadorId: generadorDemo.id, status: 'entregado' });
    return { entregado, enCurso, demo, vehiculo };
  }

  test('trae solo viajes entregados de empresas reales, con vehículo y emisiones', async () => {
    const { entregado, enCurso, demo, vehiculo } = await escenario();
    const viajes = await leerViajesEntregados(handle.db);
    const ids = viajes.map((v) => v.viajeId);
    expect(ids).toContain(entregado.id);
    expect(ids).not.toContain(enCurso.id);
    expect(ids).not.toContain(demo.id);

    const fila = viajes.find((v) => v.viajeId === entregado.id);
    expect(fila).toMatchObject({
      vehiculoId: vehiculo.id,
      origenRegion: 'IV',
      origenComuna: '04102',
      destinoRegion: 'IV',
      destinoComuna: null,
      tipoVehiculo: 'camion_pesado',
      distanciaKm: '40.00',
      kgco2eReales: '35.120',
      kgco2eEstimadas: '40.000',
      kgco2eEvitado: '12.300',
    });
    expect(fila?.recogidoEn).toEqual(new Date('2026-10-07T13:30:00Z'));
    expect(fila?.entregadoEn).toEqual(new Date('2026-10-07T16:00:00Z'));
  });
});
