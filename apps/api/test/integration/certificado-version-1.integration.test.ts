import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  type NuevaVersionCertificado,
  crearVersion,
  obtenerVigente,
  registrarPrimeraVersion,
} from '../../src/services/certificados-versionados.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * reemision-certificado parte 1 contra Postgres real: toda emisión registra
 * su versión 1 en `certificados_viaje`. Sin esa fila no se puede crear una
 * versión 2.
 */
const sha = (c: string) => c.repeat(64);
const EMITIDO = new Date('2026-11-11T12:00:00Z');

describe('integration: versión 1 del certificado al emitir', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Un viaje entregado con métricas y sin certificado. */
  async function viajeSinCertificado() {
    const [trip] = await handle.db
      .insert(schema.trips)
      .values({
        trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        originAddressRaw: 'Origen 1',
        destinationAddressRaw: 'Destino 2',
        cargoType: 'carga_seca',
        cargoWeightKg: 3000,
        pickupDateRaw: '2026-11-10',
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: viaje no creado');
    }
    await handle.db.insert(schema.tripMetrics).values({ tripId: trip.id });
    return trip.id;
  }

  const nueva = (tripId: string, letra = 'a'): NuevaVersionCertificado => ({
    tripId,
    sha256: sha(letra),
    pdfUrl: `gs://b/certificates/e/${tripId}-${letra}.pdf`,
    kmsVersion: '1',
    emitidoEn: EMITIDO,
    fuenteDistancia: 'routes_estimada',
    motivoFallback: null,
    decisionVersion: 2,
  });

  const registrar = (n: NuevaVersionCertificado) =>
    handle.db.transaction((tx) => registrarPrimeraVersion(tx, n));

  test('queda la versión 1, vigente, con los datos de la emisión', async () => {
    const tripId = await viajeSinCertificado();
    const v1 = await registrar(nueva(tripId));

    expect(v1).toMatchObject({
      tripId,
      version: 1,
      estado: 'vigente',
      sha256: sha('a'),
      kmsVersion: '1',
      emitidoEn: EMITIDO,
      fuenteDistancia: 'routes_estimada',
      decisionVersion: 2,
      reemplazadoEn: null,
      reemplazadoPor: null,
    });
    expect(await obtenerVigente(handle.db, tripId)).toMatchObject({ id: v1.id, version: 1 });
  });

  test('con la versión 1 registrada, se puede crear la versión 2', async () => {
    const tripId = await viajeSinCertificado();
    const v1 = await registrar(nueva(tripId));
    const v2 = await crearVersion(handle.db, nueva(tripId, 'b'));

    expect(v2).toMatchObject({ version: 2, estado: 'vigente' });
    const [anterior] = await handle.db
      .select()
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.id, v1.id));
    expect(anterior).toMatchObject({ estado: 'reemplazado', reemplazadoPor: v2.id });
    const [metricas] = await handle.db
      .select({ vigente: schema.tripMetrics.certificadoVigenteId })
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));
    expect(metricas?.vigente).toBe(v2.id);
  });

  test('un viaje no puede tener dos versiones 1', async () => {
    const tripId = await viajeSinCertificado();
    await registrar(nueva(tripId));
    await expect(registrar(nueva(tripId, 'b'))).rejects.toThrow();

    const filas = await handle.db
      .select({ version: schema.certificadosViaje.version })
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.tripId, tripId));
    expect(filas).toEqual([{ version: 1 }]);
  });

  test('si la transacción de la emisión falla, la versión 1 no queda', async () => {
    const tripId = await viajeSinCertificado();
    await expect(
      handle.db.transaction(async (tx) => {
        await registrarPrimeraVersion(tx, nueva(tripId));
        throw new Error('falla después de registrar');
      }),
    ).rejects.toThrow('falla después de registrar');

    expect(await obtenerVigente(handle.db, tripId)).toBeNull();
  });
});
