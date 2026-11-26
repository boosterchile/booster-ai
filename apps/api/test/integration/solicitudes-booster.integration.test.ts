import { randomUUID } from 'node:crypto';
import { getTableColumns } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  listarSolicitudesAbiertas,
  pedirABooster,
  resolverSolicitud,
} from '../../src/services/solicitudes-booster.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/frente2-cierre` §3.4 — «Pedir a Booster» (migración 0091). La tabla
 * guarda una solicitud abierta por vehículo y tipo; pedir de nuevo devuelve la
 * misma, y el panel la lista y la marca resuelta con quién y cuándo.
 */
describe('integration: solicitudes a Booster (0091)', () => {
  let handle: TestDbHandle;
  let planId: string;
  let duenoId: string;
  let adminId: string;

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
    adminId = await crearUsuario('Personal de Booster');
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  describe('la migración', () => {
    test('las columnas de la tabla son exactamente las del schema Drizzle', async () => {
      const r = await handle.pool.query<{
        column_name: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'solicitudes_booster'`,
      );
      const enBase = r.rows.map((c) => c.column_name).sort();
      const enSchema = Object.values(getTableColumns(schema.solicitudesBooster))
        .map((c) => c.name)
        .sort();
      expect(enBase).toEqual(enSchema);
      const columna = (nombre: string) => r.rows.find((c) => c.column_name === nombre);
      expect(columna('empresa_id')?.is_nullable).toBe('NO');
      expect(columna('vehiculo_id')?.is_nullable).toBe('YES');
      expect(columna('tipo')?.is_nullable).toBe('NO');
      expect(columna('estado')?.column_default).toContain("'abierta'");
      expect(columna('creada_en')?.is_nullable).toBe('NO');
      expect(columna('resuelta_en')?.is_nullable).toBe('YES');
    });

    test('el check rechaza un tipo o un estado fuera del conjunto', async () => {
      const { empresa, vehiculo } = await crearFlota();
      await expect(
        handle.pool.query(
          `INSERT INTO solicitudes_booster (empresa_id, vehiculo_id, tipo) VALUES ($1, $2, 'otro')`,
          [empresa.id, vehiculo.id],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'chk_solicitudes_booster_tipo' });
      await expect(
        handle.pool.query(
          `INSERT INTO solicitudes_booster (empresa_id, vehiculo_id, tipo, estado)
           VALUES ($1, $2, 'configurar_fuente_combustible', 'cerrada')`,
          [empresa.id, vehiculo.id],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'chk_solicitudes_booster_estado' });
    });

    test('el índice único parcial admite una sola abierta por vehículo y tipo, no las resueltas', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const insertar = (estado: string) =>
        handle.pool.query(
          `INSERT INTO solicitudes_booster (empresa_id, vehiculo_id, tipo, estado)
           VALUES ($1, $2, 'configurar_fuente_combustible', $3)`,
          [empresa.id, vehiculo.id, estado],
        );
      await insertar('resuelta');
      await insertar('resuelta');
      await insertar('abierta');
      await expect(insertar('abierta')).rejects.toMatchObject({
        code: '23505',
        constraint: 'uq_solicitudes_booster_vehiculo_tipo_abierta',
      });
    });
  });

  describe('pedir, listar y resolver', () => {
    test('pedir crea una abierta; pedir de nuevo devuelve la misma sin crear otra', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const pedir = () =>
        pedirABooster({
          db: handle.db,
          empresaId: empresa.id,
          vehiculoId: vehiculo.id,
          tipo: 'configurar_fuente_combustible',
          creadaPor: duenoId,
        });
      const primera = await pedir();
      expect(primera.creada).toBe(true);
      expect(primera.solicitud).toMatchObject({
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        tipo: 'configurar_fuente_combustible',
        estado: 'abierta',
        creadaPor: duenoId,
        resueltaEn: null,
        resueltaPor: null,
      });
      expect(primera.solicitud.creadaEn).toBeInstanceOf(Date);

      const segunda = await pedir();
      expect(segunda.creada).toBe(false);
      expect(segunda.solicitud.id).toBe(primera.solicitud.id);

      const r = await handle.pool.query(
        'SELECT 1 FROM solicitudes_booster WHERE vehiculo_id = $1',
        [vehiculo.id],
      );
      expect(r.rowCount).toBe(1);
    });

    test('dos pedidos simultáneos dejan una sola solicitud y ambos la devuelven', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const pedir = () =>
        pedirABooster({
          db: handle.db,
          empresaId: empresa.id,
          vehiculoId: vehiculo.id,
          tipo: 'configurar_fuente_combustible',
          creadaPor: duenoId,
        });
      const [a, b] = await Promise.all([pedir(), pedir()]);
      expect(a.solicitud.id).toBe(b.solicitud.id);
      expect([a.creada, b.creada].filter(Boolean)).toHaveLength(1);
    });

    test('el panel lista la abierta con empresa, patente y tipo; resolverla registra quién y cuándo', async () => {
      const { empresa, vehiculo } = await crearFlota();
      const { solicitud } = await pedirABooster({
        db: handle.db,
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        tipo: 'configurar_fuente_combustible',
        creadaPor: duenoId,
      });

      const abiertas = await listarSolicitudesAbiertas(handle.db);
      expect(abiertas.find((s) => s.id === solicitud.id)).toMatchObject({
        id: solicitud.id,
        tipo: 'configurar_fuente_combustible',
        empresaId: empresa.id,
        empresaNombre: empresa.legalName,
        vehiculoId: vehiculo.id,
        patente: vehiculo.plate,
      });

      const resuelta = await resolverSolicitud({
        db: handle.db,
        id: solicitud.id,
        resueltaPor: adminId,
      });
      expect(resuelta.resultado).toBe('resuelta');
      if (resuelta.resultado !== 'resuelta') {
        throw new Error('no se resolvió');
      }
      expect(resuelta.solicitud).toMatchObject({ estado: 'resuelta', resueltaPor: adminId });
      expect(resuelta.solicitud.resueltaEn).toBeInstanceOf(Date);

      const despues = await listarSolicitudesAbiertas(handle.db);
      expect(despues.some((s) => s.id === solicitud.id)).toBe(false);

      expect(
        (await resolverSolicitud({ db: handle.db, id: solicitud.id, resueltaPor: adminId }))
          .resultado,
      ).toBe('ya_resuelta');
      expect(
        (await resolverSolicitud({ db: handle.db, id: randomUUID(), resueltaPor: adminId }))
          .resultado,
      ).toBe('no_existe');

      const nueva = await pedirABooster({
        db: handle.db,
        empresaId: empresa.id,
        vehiculoId: vehiculo.id,
        tipo: 'configurar_fuente_combustible',
        creadaPor: duenoId,
      });
      expect(nueva.creada).toBe(true);
      expect(nueva.solicitud.id).not.toBe(solicitud.id);
    });
  });
});
