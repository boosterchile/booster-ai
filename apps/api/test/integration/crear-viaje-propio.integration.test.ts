import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { crearViajePropio } from '../../src/services/crear-viaje-propio.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * BARH-24 — viaje propio del transportista.
 * TDD: rojo primero (service crea trip+assignment sin ofertas ni matching).
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
} as never;

describe('integration: crear viaje propio', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  async function planId(): Promise<string> {
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
    const id =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  async function escenarioBase() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const pid = await planId();
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-vp-${suffix}`,
          email: `vp-${suffix}@test.invalid`,
          fullName: 'Despachador Propio',
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario',
    );
    const transportista = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Trans VP ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `t-${suffix}@empresa.invalid`,
          contactPhone: '+56922222222',
          addressStreet: 'Calle 2',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'transportista',
    );
    const generador = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Gen VP ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `g-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: false,
          isGeneradorCarga: true,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'generador',
    );
    return { usuario, transportista, generador };
  }

  test('crea trip propio + assignment sin ofertas y sin matching', async () => {
    const e = await escenarioBase();
    const runMatching = vi.fn();

    const r = await crearViajePropio({
      db: handle.db,
      logger,
      empresaTransportistaId: e.transportista.id,
      userId: e.usuario.id,
      input: {
        origen: { address_raw: 'Av. Apoquindo 3000, Las Condes', region_code: '13' },
        destino: { address_raw: 'Puerto San Antonio', region_code: '05' },
        cargo_type: 'agricola',
        cargo_weight_kg: 1200,
        pickup_date_raw: '2026-11-20',
        cliente: { tipo: 'generador', empresa_id: e.generador.id },
      },
      runMatching,
    });

    expect(r.trip.origenAlta).toBe('propio_transportista');
    expect(r.trip.status).toBe('asignado');
    expect(r.trip.generadorCargaEmpresaId).toBe(e.generador.id);
    expect(r.assignment.empresaId).toBe(e.transportista.id);
    expect(r.assignment.offerId).toBeNull();
    expect(r.assignment.agreedPriceClp).toBe(0);
    expect(r.rutaId).toBeTruthy();

    const ofertas = await handle.db
      .select({ id: schema.offers.id })
      .from(schema.offers)
      .where(eq(schema.offers.tripId, r.trip.id));
    expect(ofertas).toHaveLength(0);
    expect(runMatching).not.toHaveBeenCalled();
  });

  test('cliente externo con RUT válido; RUT inválido rechaza', async () => {
    const e = await escenarioBase();
    const ok = await crearViajePropio({
      db: handle.db,
      logger,
      empresaTransportistaId: e.transportista.id,
      userId: e.usuario.id,
      input: {
        origen: { address_raw: 'Calle Uno 1, Santiago', region_code: '13' },
        destino: { address_raw: 'Calle Dos 2, Valparaíso', region_code: '05' },
        cargo_type: 'carga_seca',
        pickup_date_raw: '2026-11-21',
        cliente: {
          tipo: 'externo',
          nombre: 'Cliente Externo SPA',
          rut: '11.111.111-1',
        },
      },
    });
    expect(ok.trip.clienteExternoNombre).toBe('Cliente Externo SPA');
    expect(ok.trip.clienteExternoRut).toBe('11111111-1');
    expect(ok.trip.generadorCargaEmpresaId).toBeNull();

    await expect(
      crearViajePropio({
        db: handle.db,
        logger,
        empresaTransportistaId: e.transportista.id,
        userId: e.usuario.id,
        input: {
          origen: { address_raw: 'Calle Uno 1, Santiago', region_code: '13' },
          destino: { address_raw: 'Calle Dos 2, Valparaíso', region_code: '05' },
          cargo_type: 'carga_seca',
          pickup_date_raw: '2026-11-21',
          cliente: {
            tipo: 'externo',
            nombre: 'Mal RUT',
            rut: '11.111.111-9',
          },
        },
      }),
    ).rejects.toMatchObject({ name: 'ViajePropioValidacionError' });
  });

  test('generador inexistente → GeneradorNoEncontradoError', async () => {
    const e = await escenarioBase();
    await expect(
      crearViajePropio({
        db: handle.db,
        logger,
        empresaTransportistaId: e.transportista.id,
        userId: e.usuario.id,
        input: {
          origen: { address_raw: 'Calle Uno 1, Santiago', region_code: '13' },
          destino: { address_raw: 'Calle Dos 2, Valparaíso', region_code: '05' },
          cargo_type: 'carga_seca',
          pickup_date_raw: '2026-11-21',
          cliente: { tipo: 'generador', empresa_id: randomUUID() },
        },
      }),
    ).rejects.toMatchObject({ name: 'GeneradorNoEncontradoError' });
  });
});
