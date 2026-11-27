import { randomUUID } from 'node:crypto';
import { eq, getTableColumns } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  anularCargaCombustible,
  listarCargasCombustible,
  registrarCargaCombustible,
} from '../../src/services/cargas-combustible.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/registro-cargas-combustible` (migración 0093). La carga queda
 * guardada, el índice único rechaza la misma carga dos veces mientras está
 * vigente, y anular deja quién y cuándo sin borrarla.
 */
describe('integration: cargas de combustible (0093)', () => {
  let handle: TestDbHandle;
  let planId: string;
  let duenoId: string;
  let otroId: string;

  function uno<T>(rows: T[]): T {
    const r = rows[0];
    if (!r) {
      throw new Error('fixture no creado');
    }
    return r;
  }

  async function crearUsuario(nombre: string) {
    const sufijo = randomUUID().slice(0, 8);
    return uno(
      await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${sufijo}`,
          email: `${sufijo}@test.invalid`,
          fullName: nombre,
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
    ).id;
  }

  async function crearFlota() {
    const empresa = uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: `Transportes ${randomUUID().slice(0, 8)}`,
          rut: rutAleatorio(),
          contactEmail: `${randomUUID().slice(0, 8)}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Coquimbo',
          addressRegion: 'IV',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id, legalName: schema.empresas.legalName }),
    );
    const vehiculo = uno(
      await handle.db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
          vehicleType: 'camion_mediano',
          unitType: 'camion_rigido',
          capacityKg: 10_000,
        })
        .returning({ id: schema.vehicles.id, plate: schema.vehicles.plate }),
    );
    return { empresa, vehiculo };
  }

  beforeAll(async () => {
    handle = createTestDb();
    const [plan] = await handle.db
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
    planId =
      plan?.id ??
      uno(await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).id;
    duenoId = await crearUsuario('Dueña');
    otroId = await crearUsuario('Despachador');
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  const CARGADA = new Date('2026-10-28T12:30:00.000Z');

  async function registrar(empresaId: string, vehiculoId: string, litros = 100) {
    return registrarCargaCombustible({
      db: handle.db,
      empresaId,
      vehiculoId,
      cargadaEn: CARGADA,
      litros,
      lugar: 'Copec Ruta 5',
      registradaPor: duenoId,
    });
  }

  describe('la migración', () => {
    test('las columnas de la tabla son exactamente las del schema Drizzle', async () => {
      const r = await handle.pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'cargas_combustible'`,
      );
      const enBase = r.rows.map((c) => c.column_name).sort();
      const enSchema = Object.values(getTableColumns(schema.cargasCombustible))
        .map((c) => c.name)
        .sort();
      expect(enBase).toEqual(enSchema);
      const columna = (nombre: string) => r.rows.find((c) => c.column_name === nombre);
      expect(columna('vehiculo_id')?.is_nullable).toBe('NO');
      expect(columna('cargada_en')?.is_nullable).toBe('NO');
      expect(columna('litros')?.is_nullable).toBe('NO');
      expect(columna('lugar')?.is_nullable).toBe('YES');
      expect(columna('anulada_en')?.is_nullable).toBe('YES');
    });

    test('el check rechaza litros en cero o sobre 2000', async () => {
      const { empresa, vehiculo } = await crearFlota();
      for (const litros of [0, 2000.1]) {
        await expect(
          handle.db.insert(schema.cargasCombustible).values({
            empresaId: empresa.id,
            vehiculoId: vehiculo.id,
            cargadaEn: CARGADA,
            litros,
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe('registrar, listar y anular', () => {
    test('la carga queda guardada con sus litros, lugar y quién la registró', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const r = await registrar(empresa.id, vehiculo.id, 99.5);
      expect(r.ok).toBe(true);
      const [fila] = await handle.db
        .select()
        .from(schema.cargasCombustible)
        .where(eq(schema.cargasCombustible.vehiculoId, vehiculo.id));
      expect(fila?.litros).toBe(99.5);
      expect(fila?.lugar).toBe('Copec Ruta 5');
      expect(fila?.registradaPor).toBe(duenoId);
      expect(fila?.cargadaEn.toISOString()).toBe(CARGADA.toISOString());
    });

    test('la misma carga dos veces → carga_duplicada; otra cantidad sí entra', async () => {
      const { empresa, vehiculo } = await crearFlota();
      expect((await registrar(empresa.id, vehiculo.id)).ok).toBe(true);
      expect(await registrar(empresa.id, vehiculo.id)).toEqual({
        ok: false,
        code: 'carga_duplicada',
      });
      expect((await registrar(empresa.id, vehiculo.id, 120)).ok).toBe(true);
    });

    test('anular deja quién y cuándo, la saca de la lista y libera registrarla de nuevo', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const r = await registrar(empresa.id, vehiculo.id);
      if (!r.ok) {
        throw new Error('no registró');
      }
      const anulada = await anularCargaCombustible({
        db: handle.db,
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        cargaId: r.carga.id,
        anuladaPor: otroId,
      });
      expect(anulada?.anuladaPor).toBe(otroId);
      expect(anulada?.anuladaEn).toBeInstanceOf(Date);
      expect(
        await listarCargasCombustible({
          db: handle.db,
          empresaId: empresa.id,
          vehiculoId: vehiculo.id,
          limite: 100,
        }),
      ).toEqual([]);
      expect((await registrar(empresa.id, vehiculo.id)).ok).toBe(true);
    });

    test('anular dos veces devuelve la misma, sin cambiar quién ni cuándo', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const r = await registrar(empresa.id, vehiculo.id);
      if (!r.ok) {
        throw new Error('no registró');
      }
      const args = {
        db: handle.db,
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        cargaId: r.carga.id,
      };
      const primera = await anularCargaCombustible({ ...args, anuladaPor: duenoId });
      const segunda = await anularCargaCombustible({ ...args, anuladaPor: otroId });
      expect(segunda?.anuladaPor).toBe(duenoId);
      expect(segunda?.anuladaEn?.toISOString()).toBe(primera?.anuladaEn?.toISOString());
    });

    test('una carga de otra empresa no se anula ni se lista', async () => {
      const a = await crearFlota();
      const b = await crearFlota();
      const r = await registrar(a.empresa.id, a.vehiculo.id);
      if (!r.ok) {
        throw new Error('no registró');
      }
      const otra = await anularCargaCombustible({
        db: handle.db,
        empresaId: b.empresa.id,
        vehiculoId: a.vehiculo.id,
        cargaId: r.carga.id,
        anuladaPor: otroId,
      });
      expect(otra).toBeNull();
      const deOtraEmpresa = await listarCargasCombustible({
        db: handle.db,
        empresaId: b.empresa.id,
        vehiculoId: a.vehiculo.id,
        limite: 100,
      });
      expect(deOtraEmpresa).toEqual([]);
      const lista = await listarCargasCombustible({
        db: handle.db,
        empresaId: a.empresa.id,
        vehiculoId: a.vehiculo.id,
        limite: 100,
      });
      expect(lista.map((c) => c.id)).toEqual([r.carga.id]);
    });

    test('la lista va de la más nueva a la más vieja y respeta el límite', async () => {
      const { empresa, vehiculo } = await crearFlota();
      for (const [i, fecha] of [
        '2026-11-01T10:00:00Z',
        '2026-11-03T10:00:00Z',
        '2026-11-02T10:00:00Z',
      ].entries()) {
        await registrarCargaCombustible({
          db: handle.db,
          empresaId: empresa.id,
          vehiculoId: vehiculo.id,
          cargadaEn: new Date(fecha),
          litros: 100 + i,
          lugar: null,
          registradaPor: duenoId,
        });
      }
      const lista = await listarCargasCombustible({
        db: handle.db,
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        limite: 2,
      });
      expect(lista.map((c) => c.cargadaEn.toISOString())).toEqual([
        '2026-11-03T10:00:00.000Z',
        '2026-11-02T10:00:00.000Z',
      ]);
    });
  });
});
