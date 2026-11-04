import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  cambiarGestionFlota,
  listarTransportistasGestionFlota,
} from '../../src/services/gestion-flota.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/** ADR-079 §4: el platform-admin activa el plan con gestión de flota, con autor y fecha. */
const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: gestión de flota (ADR-079 §4)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function empresa(transportista: boolean) {
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await handle.db
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
      )[0] ??
      uno(await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    return uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: `GF ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `gf-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'C 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: !transportista,
          isTransportista: transportista,
          planId: plan.id,
        })
        .returning(),
      'empresa',
    );
  }

  test('activar registra fecha y autor; desactivar los limpia', async () => {
    const e = await empresa(true);
    const activada = await cambiarGestionFlota({
      db: handle.db,
      empresaId: e.id,
      activo: true,
      adminEmail: 'admin@boosterchile.com',
    });
    expect(activada).toMatchObject({ empresaId: e.id, activadoPor: 'admin@boosterchile.com' });
    expect(activada?.activadoEn).toBeInstanceOf(Date);
    const lista = await listarTransportistasGestionFlota(handle.db);
    expect(lista.find((t) => t.empresaId === e.id)?.activadoPor).toBe('admin@boosterchile.com');

    const desactivada = await cambiarGestionFlota({
      db: handle.db,
      empresaId: e.id,
      activo: false,
      adminEmail: 'admin@boosterchile.com',
    });
    expect(desactivada).toMatchObject({ activadoEn: null, activadoPor: null });
  });

  test('una empresa que no es transportista no se puede activar (null)', async () => {
    const g = await empresa(false);
    expect(
      await cambiarGestionFlota({
        db: handle.db,
        empresaId: g.id,
        activo: true,
        adminEmail: 'admin@boosterchile.com',
      }),
    ).toBeNull();
    const lista = await listarTransportistasGestionFlota(handle.db);
    expect(lista.some((t) => t.empresaId === g.id)).toBe(false);
  });
});
