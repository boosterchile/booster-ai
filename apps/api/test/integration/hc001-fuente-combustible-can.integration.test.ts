import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  GuardaFuenteCanError,
  aplicarFuenteCan,
  main,
} from '../../src/jobs/hc001-fuente-combustible-can.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

// Fixtures sintéticos: solo las patentes, con los valores previos esperados.
const INICIAL: Record<string, string> = {
  KZXB64: '89',
  LFGR63: '84',
  KZBB26: '84',
  RCPC20: 'sin_sensor',
  PLFL57: 'sin_sensor',
  KFKW23: 'sin_sensor',
};
const PATENTES = Object.keys(INICIAL);

describe('integration: job HC-001 fuente_combustible_can', () => {
  let handle: TestDbHandle;
  let empresaId: string;

  const leer = async () => {
    const r = await handle.pool.query<{ patente: string; fuente_combustible_can: string }>(
      'SELECT patente, fuente_combustible_can FROM vehiculos WHERE patente = ANY($1)',
      [PATENTES],
    );
    return Object.fromEntries(r.rows.map((x) => [x.patente, x.fuente_combustible_can]));
  };
  const correr = async (sentido: 'up' | 'reversa') => {
    const client = await handle.pool.connect();
    try {
      return await aplicarFuenteCan(client, sentido, { dryRun: false });
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    handle = createTestDb();
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await handle.db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan ${suffix}`,
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ??
      (await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    const [empresa] = await handle.db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes HC001 ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `hc001-${suffix}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId: planId as string,
      })
      .returning({ id: schema.empresas.id });
    empresaId = (empresa as { id: string }).id;
  });
  afterAll(async () => {
    await handle.pool.query('DELETE FROM vehiculos WHERE patente = ANY($1)', [PATENTES]);
    await handle.pool.end();
  });
  beforeEach(async () => {
    await handle.pool.query('DELETE FROM vehiculos WHERE patente = ANY($1)', [PATENTES]);
    await handle.db.insert(schema.vehicles).values(
      PATENTES.map((plate) => ({
        empresaId,
        plate,
        vehicleType: 'camion_pesado' as const,
        capacityKg: 15000,
        fuenteCombustibleCan: INICIAL[plate],
      })),
    );
  });

  test('up cambia exactamente las 3 filas y deja intactas RCPC20, PLFL57 y KFKW23', async () => {
    expect(await correr('up')).toEqual(['KZXB64', 'LFGR63', 'KZBB26']);
    expect(await leer()).toEqual({
      ...INICIAL,
      KZXB64: '83',
      LFGR63: '83',
      KZBB26: 'sin_sensor',
    });
  });

  test('un segundo up aborta por la guarda y no cambia nada', async () => {
    await correr('up');
    const despues = await leer();
    await expect(correr('up')).rejects.toBeInstanceOf(GuardaFuenteCanError);
    expect(await leer()).toEqual(despues);
  });

  test('reversa restaura los valores previos', async () => {
    await correr('up');
    expect(await correr('reversa')).toHaveLength(3);
    expect(await leer()).toEqual(INICIAL);
  });

  test('si una patente tiene otro valor previo, todo aborta sin cambios', async () => {
    await handle.pool.query(
      "UPDATE vehiculos SET fuente_combustible_can = '83' WHERE patente = 'KZBB26'",
    );
    const antes = await leer();
    await expect(correr('up')).rejects.toThrow(/KZBB26/);
    expect(await leer()).toEqual(antes);
  });

  test('dry-run (default del job) no escribe', async () => {
    const client = await handle.pool.connect();
    try {
      expect(await aplicarFuenteCan(client, 'up', { dryRun: true })).toHaveLength(3);
    } finally {
      client.release();
    }
    expect(await leer()).toEqual(INICIAL);
  });

  const cli = (env: Record<string, string>) =>
    main({ DATABASE_URL: handle.url, CONFIRMAR_HOST: '127.0.0.1', DRY_RUN: 'false', ...env });

  test.each([
    ['DRY_RUN con typo queda en dry-run', { SENTIDO: 'up', DRY_RUN: 'flase' }, null],
    ['SENTIDO inválido aborta', { SENTIDO: 'arriba' }, /SENTIDO/],
    ['reversa sin up previo aborta', { SENTIDO: 'reversa' }, /KZXB64/],
    ['sin CONFIRMAR_HOST no escribe', { SENTIDO: 'up', CONFIRMAR_HOST: '' }, /CONFIRMAR_HOST/],
    [
      'CONFIRMAR_HOST incorrecto no escribe',
      { SENTIDO: 'up', CONFIRMAR_HOST: 'db.prod' },
      /CONFIRMAR_HOST/,
    ],
  ])('main(): %s', async (_c, env, error) => {
    const r = cli(env);
    await (error ? expect(r).rejects.toThrow(error) : expect(r).resolves.toHaveLength(3));
    expect(await leer()).toEqual(INICIAL);
  });

  test('main(): con CONFIRMAR_HOST correcto escribe las 3 filas', async () => {
    await expect(cli({ SENTIDO: 'up' })).resolves.toHaveLength(3);
    expect((await leer()).KZXB64).toBe('83');
  });
});
