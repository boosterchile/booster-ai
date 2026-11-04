import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  cambiarContratoProgramado,
  listarGeneradoresContratoProgramado,
} from '../../src/services/contrato-programado.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/** ADR-079 §2: el platform-admin habilita y deshabilita el contrato programado, con autor y fecha. */
const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: contrato programado (ADR-079 §2)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function empresa(generador: boolean) {
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
          legalName: `CP ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `cp-${s}@test.invalid`,
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
  }

  test('habilitar registra fecha y autor; deshabilitar los limpia', async () => {
    const e = await empresa(true);
    const activada = await cambiarContratoProgramado({
      db: handle.db,
      empresaId: e.id,
      activo: true,
      adminEmail: 'admin@boosterchile.com',
    });
    expect(activada).toMatchObject({ empresaId: e.id, activadoPor: 'admin@boosterchile.com' });
    expect(activada?.activadoEn).toBeInstanceOf(Date);

    const lista = await listarGeneradoresContratoProgramado(handle.db);
    expect(lista.find((g) => g.empresaId === e.id)?.activadoPor).toBe('admin@boosterchile.com');

    const desactivada = await cambiarContratoProgramado({
      db: handle.db,
      empresaId: e.id,
      activo: false,
      adminEmail: 'admin@boosterchile.com',
    });
    expect(desactivada).toMatchObject({ activadoEn: null, activadoPor: null });
  });

  test('una empresa que no es generadora no se puede habilitar (null)', async () => {
    const t = await empresa(false);
    expect(
      await cambiarContratoProgramado({
        db: handle.db,
        empresaId: t.id,
        activo: true,
        adminEmail: 'admin@boosterchile.com',
      }),
    ).toBeNull();
    const lista = await listarGeneradoresContratoProgramado(handle.db);
    expect(lista.some((g) => g.empresaId === t.id)).toBe(false);
  });
});
