import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { resumenCertificados } from '../../src/services/resumen-certificados.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/sello-huella-toda-la-web`, criterio 2: el resumen de certificados
 * separa conteo, kg y ahorro por presentación de ADR-091, contra Postgres real
 * (la cobertura llega como `numeric`).
 */
describe('integration: resumen de certificados por presentación', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function empresa(): Promise<string> {
    const { db } = handle;
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const s = randomUUID().slice(0, 8);
    const [fila] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Generadora ${s}`,
        rut: `${Math.floor(10_000_000 + Math.random() * 80_000_000)}-${Math.floor(Math.random() * 10)}`,
        contactEmail: `g-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: false,
        isGeneradorCarga: true,
        status: 'activa',
        planId,
      })
      .returning({ id: schema.empresas.id });
    if (!fila) {
      throw new Error('fixture: empresa no creada');
    }
    return fila.id;
  }

  async function certificado(
    empresaId: string,
    m: Partial<typeof schema.tripMetrics.$inferInsert>,
  ): Promise<void> {
    const { db } = handle;
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: `BOO-${randomUUID().slice(0, 6).toUpperCase()}`,
        generadorCargaEmpresaId: empresaId,
        originAddressRaw: 'Origen 1',
        destinationAddressRaw: 'Destino 2',
        cargoType: 'carga_seca',
        pickupDateRaw: '2026-11-20',
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: viaje no creado');
    }
    await db.insert(schema.tripMetrics).values({ tripId: trip.id, ...m });
  }

  test('suma cada presentación por separado y el total coincide', async () => {
    const empresaId = await empresa();
    const emitido = new Date('2026-11-21T12:00:00Z');
    await certificado(empresaId, {
      certificationLevel: 'primario_verificable',
      routeDataSource: 'teltonika_gps',
      coveragePct: '97.50',
      carbonEmissionsKgco2eActual: '100.000',
      ahorroCo2eVsSinMatchingKgco2e: '5.000',
      certificateIssuedAt: emitido,
    });
    await certificado(empresaId, {
      certificationLevel: 'secundario_modeled',
      routeDataSource: 'teltonika_gps',
      coveragePct: '90.00',
      carbonEmissionsKgco2eEstimated: '200.000',
      certificateIssuedAt: emitido,
    });
    await certificado(empresaId, {
      certificationLevel: 'secundario_modeled',
      routeDataSource: 'maps_directions',
      coveragePct: '0',
      carbonEmissionsKgco2eEstimated: '300.000',
      ahorroCo2eVsSinMatchingKgco2e: '7.500',
      certificateIssuedAt: emitido,
    });
    await certificado(empresaId, {
      certificationLevel: 'secundario_default',
      carbonEmissionsKgco2eEstimated: '50.000',
      certificateIssuedAt: emitido,
    });
    // Sin certificado emitido: no entra.
    await certificado(empresaId, {
      certificationLevel: 'primario_verificable',
      routeDataSource: 'teltonika_gps',
      coveragePct: '99',
      carbonEmissionsKgco2eActual: '999.000',
    });

    const resumen = await resumenCertificados({ db: handle.db, empresaId });

    expect(resumen.por_presentacion).toEqual({
      primario: { certificados: 1, kgco2e: 100, ahorro_kgco2e: 5 },
      medido_teltonika: { certificados: 1, kgco2e: 200, ahorro_kgco2e: 0 },
      estimado: { certificados: 2, kgco2e: 350, ahorro_kgco2e: 7.5 },
    });
    expect(resumen).toMatchObject({
      certificados: 4,
      medidos: 1,
      estimados: 3,
      kgco2e: 650,
      ahorro_kgco2e: 12.5,
    });
  });

  test('sin certificados, cada presentación en cero', async () => {
    const empresaId = await empresa();
    const resumen = await resumenCertificados({ db: handle.db, empresaId });
    expect(resumen.por_presentacion).toEqual({
      primario: { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 },
      medido_teltonika: { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 },
      estimado: { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 },
    });
    expect(resumen.certificados).toBe(0);
  });

  test('por transportista y mes en curso de Santiago (.specs/frente2-cierre §3.1)', async () => {
    const { db } = handle;
    const generadorId = await empresa();
    const transportistaId = await empresa();
    const otraTransportistaId = await empresa();
    async function asignado(
      empresaTransportista: string,
      emitido: Date,
      kg: string,
      m: Partial<typeof schema.tripMetrics.$inferInsert> = {},
    ) {
      const [trip] = await db
        .insert(schema.trips)
        .values({
          trackingCode: `BOO-${randomUUID().slice(0, 6).toUpperCase()}`,
          generadorCargaEmpresaId: generadorId,
          originAddressRaw: 'Origen 1',
          destinationAddressRaw: 'Destino 2',
          cargoType: 'carga_seca',
          pickupDateRaw: '2026-11-20',
          status: 'entregado',
        })
        .returning({ id: schema.trips.id });
      if (!trip) {
        throw new Error('fixture: viaje no creado');
      }
      await db.insert(schema.assignments).values({
        tripId: trip.id,
        empresaId: empresaTransportista,
        agreedPriceClp: 100_000,
        status: 'entregado',
        deliveredAt: emitido,
      });
      await db.insert(schema.tripMetrics).values({
        tripId: trip.id,
        carbonEmissionsKgco2eEstimated: kg,
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'maps_directions',
        coveragePct: '0',
        certificateIssuedAt: emitido,
        ...m,
      });
    }
    // 2026-11-01 02:00 UTC es todavía 31 de octubre en Santiago (UTC-3): no entra.
    await asignado(transportistaId, new Date('2026-11-01T02:00:00Z'), '999.000');
    await asignado(transportistaId, new Date('2026-11-10T12:00:00Z'), '100.000');
    await asignado(transportistaId, new Date('2026-11-20T12:00:00Z'), '50.000', {
      routeDataSource: 'teltonika_gps',
      coveragePct: '91.00',
    });
    await asignado(otraTransportistaId, new Date('2026-11-15T12:00:00Z'), '777.000');

    const resumen = await resumenCertificados({
      db,
      transportistaEmpresaId: transportistaId,
      mesDe: new Date('2026-11-26T12:00:00Z'),
    });
    expect(resumen.certificados).toBe(2);
    expect(resumen.por_presentacion.estimado.kgco2e).toBe(100);
    expect(resumen.por_presentacion.medido_teltonika.kgco2e).toBe(50);
  });
});
