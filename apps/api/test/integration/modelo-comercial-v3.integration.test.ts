import { randomUUID } from 'node:crypto';
import {
  CONFIGURACION_COMERCIAL_INICIAL,
  configuracionComercialSchema,
} from '@booster-ai/shared-schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-079 / migración 0059 contra Postgres real: la versión 1 publicada
 * existe, es válida y coincide con CONFIGURACION_COMERCIAL_INICIAL; el
 * singleton de `publicada` se cumple a nivel SQL; los viajes existentes
 * quedan en modalidad spot; una liquidación v3 sin tier cabe.
 */
const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: modelo comercial v3 (migración 0059)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('la versión 1 sembrada tiene los valores de ADR-079 y hay una sola publicada válida', async () => {
    // Otros tests de integración publican versiones nuevas en la misma base:
    // la v1 es la que fija la migración; la publicada puede ser posterior.
    const v1 = uno(
      await handle.db
        .select()
        .from(schema.configuracionComercial)
        .where(eq(schema.configuracionComercial.version, 1)),
      'versión 1',
    );
    expect(configuracionComercialSchema.parse(v1.config)).toEqual(CONFIGURACION_COMERCIAL_INICIAL);
    expect(v1.notaCambio.length).toBeGreaterThan(0);

    const publicadas = await handle.db
      .select()
      .from(schema.configuracionComercial)
      .where(eq(schema.configuracionComercial.publicada, true));
    expect(publicadas).toHaveLength(1);
    expect(
      configuracionComercialSchema.safeParse(uno(publicadas, 'publicada').config).success,
    ).toBe(true);
  });

  test('una segunda versión publicada viola el índice singleton', async () => {
    const version = 1000 + Math.floor(Math.random() * 100_000);
    await expect(
      handle.db.insert(schema.configuracionComercial).values({
        version,
        config: CONFIGURACION_COMERCIAL_INICIAL,
        publicada: true,
        notaCambio: 'intento duplicado',
        creadoPorEmail: 'test@test.invalid',
      }),
    ).rejects.toThrow();
  });

  test('nota de cambio vacía viola el CHECK', async () => {
    await expect(
      handle.db.insert(schema.configuracionComercial).values({
        version: 200_000 + Math.floor(Math.random() * 100_000),
        config: CONFIGURACION_COMERCIAL_INICIAL,
        publicada: false,
        notaCambio: '   ',
        creadoPorEmail: 'test@test.invalid',
      }),
    ).rejects.toThrow();
  });

  test('un viaje sin modalidad queda spot; se puede congelar la tasa y la versión', async () => {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `Plan V3 ${s}`,
            description: 'fixture',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-v3-${s}`, email: `v3-${s}@test.invalid`, fullName: 'V3' })
        .returning(),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `V3 SpA ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `v3-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: true,
          planId: plan.id,
        })
        .returning(),
      'empresa',
    );
    expect(empresa.contratoProgramadoActivadoEn).toBeNull();

    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: user.id,
          originAddressRaw: 'Origen',
          destinationAddressRaw: 'Destino',
          cargoType: 'carga_seca',
          pickupDateRaw: '2026-10-08',
        })
        .returning(),
      'viaje',
    );
    expect(viaje.modalidadCarga).toBe('spot');
    expect(viaje.comisionPctAplicada).toBeNull();

    const publicada = uno(
      await db
        .select({ id: schema.configuracionComercial.id })
        .from(schema.configuracionComercial)
        .where(eq(schema.configuracionComercial.publicada, true)),
      'publicada',
    );
    const [congelado] = await db
      .update(schema.trips)
      .set({ comisionPctAplicada: '20.00', configuracionComercialId: publicada.id })
      .where(eq(schema.trips.id, viaje.id))
      .returning();
    expect(congelado?.comisionPctAplicada).toBe('20.00');
  });

  test('liquidaciones.tier_slug_aplicado admite NULL (liquidación v3 sin tier)', async () => {
    const r = await handle.db.execute<{ is_nullable: string }>(sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'liquidaciones' AND column_name = 'tier_slug_aplicado'
    `);
    expect(r.rows[0]?.is_nullable).toBe('YES');
  });
});
