import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Migración 0092 (decisión del PO del 2026-11-26, tras D1 de
 * `.specs/frente2-cierre`): enciende la medición de huella en las empresas
 * transportistas activas que la tenían apagada, deja registro de cuáles cambió
 * y su reversa las devuelve a como estaban.
 */
const UP = readFileSync(
  new URL('../../drizzle/0092_medicion_encendida_transportistas_activas.sql', import.meta.url),
  'utf8',
);
const DOWN = readFileSync(
  new URL(
    '../../drizzle/down/0092_medicion_encendida_transportistas_activas.down.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('integration: migración 0092 — medición encendida en transportistas activas', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function planId(): Promise<string> {
    const [plan] = await handle.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'Plan', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const id =
      plan?.id ??
      (await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  async function empresa(o: {
    transportista: boolean;
    estado: 'activa' | 'pendiente_verificacion';
    medicion: boolean;
  }): Promise<string> {
    const s = randomUUID().slice(0, 8);
    const [fila] = await handle.db
      .insert(schema.empresas)
      .values({
        legalName: `Med ${s}`,
        rut: rutAleatorio(),
        contactEmail: `m-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: o.transportista,
        isGeneradorCarga: !o.transportista,
        status: o.estado,
        planId: await planId(),
        carbonMeasurementEnabled: o.medicion,
      })
      .returning({ id: schema.empresas.id });
    if (!fila) {
      throw new Error('fixture: empresa no creada');
    }
    return fila.id;
  }

  async function medicion(ids: string[]): Promise<Record<string, boolean>> {
    const filas = await handle.db
      .select({ id: schema.empresas.id, m: schema.empresas.carbonMeasurementEnabled })
      .from(schema.empresas)
      .where(inArray(schema.empresas.id, ids));
    return Object.fromEntries(filas.map((f) => [f.id, f.m]));
  }

  test('enciende solo transportistas activas apagadas, lo registra y la reversa lo deshace', async () => {
    const apagada = await empresa({ transportista: true, estado: 'activa', medicion: false });
    const encendida = await empresa({ transportista: true, estado: 'activa', medicion: true });
    const pendiente = await empresa({
      transportista: true,
      estado: 'pendiente_verificacion',
      medicion: false,
    });
    const generadora = await empresa({ transportista: false, estado: 'activa', medicion: false });
    const ids = [apagada, encendida, pendiente, generadora];

    await handle.pool.query(UP);
    expect(await medicion(ids)).toEqual({
      [apagada]: true,
      [encendida]: true,
      [pendiente]: false,
      [generadora]: false,
    });
    const registro = await handle.pool.query(
      'SELECT empresa_id FROM empresas_medicion_encendida_0092 WHERE empresa_id = ANY($1)',
      [ids],
    );
    expect(registro.rows.map((r: { empresa_id: string }) => r.empresa_id)).toEqual([apagada]);

    // Correrla dos veces no cambia nada más.
    await handle.pool.query(UP);
    expect((await medicion(ids))[apagada]).toBe(true);

    await handle.pool.query(DOWN);
    expect(await medicion(ids)).toEqual({
      [apagada]: false,
      [encendida]: true,
      [pendiente]: false,
      [generadora]: false,
    });

    // Deja el esquema como lo dejó el migrador para las demás suites.
    await handle.pool.query(UP);
  });
});
