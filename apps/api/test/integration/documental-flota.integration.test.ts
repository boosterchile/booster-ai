import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { documentalDeEmpresa } from '../../src/services/documental-flota.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/una-sola-verdad-por-dato` contra Postgres real: el cálculo único de
 * documentos lee bien la fecha de vencimiento (columna `date`).
 */
describe('integration: documentos de la flota con fecha', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('vencido, por vencer y vigente según la fecha guardada', async () => {
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
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Documental ${s}`,
        rut: rutAleatorio(),
        contactEmail: `d-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        status: 'activa',
        planId,
      })
      .returning({ id: schema.empresas.id });
    if (!empresa) {
      throw new Error('fixture: empresa no creada');
    }
    const [camion] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: empresa.id,
        plate: `DF${randomUUID().slice(0, 8).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
      })
      .returning({ id: schema.vehicles.id });
    if (!camion) {
      throw new Error('fixture: camión no creado');
    }
    const ahora = new Date('2026-11-25T15:00:00.000Z');
    await db.insert(schema.documentosVehiculo).values([
      { vehicleId: camion.id, tipo: 'soap', fechaVencimiento: '2026-11-01' },
      {
        vehicleId: camion.id,
        tipo: 'revision_tecnica',
        fechaVencimiento: '2026-12-10',
      },
      {
        vehicleId: camion.id,
        tipo: 'permiso_circulacion',
        fechaVencimiento: '2027-06-01',
      },
    ]);

    const { documental, resumen } = await documentalDeEmpresa({
      db,
      empresaId: empresa.id,
      ahora,
    });
    const documentos = documental.vehiculos[0]?.documentos ?? [];
    const estado = (tipo: string) => documentos.find((d) => d.tipo === tipo);
    expect(estado('soap')).toMatchObject({ estado: 'vencido', fecha_vencimiento: '2026-11-01' });
    expect(estado('revision_tecnica')).toMatchObject({
      estado: 'por_vencer',
      fecha_vencimiento: '2026-12-10',
    });
    expect(estado('permiso_circulacion')).toMatchObject({
      estado: 'vigente',
      fecha_vencimiento: '2027-06-01',
    });
    expect(resumen).toMatchObject({ pendientes: 2, vencidos: 1, por_vencer: 1, faltantes: 0 });
  });
});
