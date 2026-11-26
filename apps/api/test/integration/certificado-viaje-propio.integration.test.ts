import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const { emitirCertificado } = vi.hoisted(() => ({ emitirCertificado: vi.fn() }));
vi.mock('@booster-ai/certificate-generator', async (original) => ({
  ...(await original<typeof import('@booster-ai/certificate-generator')>()),
  emitirCertificado,
}));

import * as schema from '../../src/db/schema.js';
import { crearViajePropio } from '../../src/services/crear-viaje-propio.js';
import { emitirCertificadoViaje } from '../../src/services/emitir-certificado-viaje.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/frente2-cierre` §3.3, criterio 2 (D2): un viaje propio con cliente
 * externo, entregado y con sus métricas, emite su certificado bajo la
 * transportista y el PDF nombra al cliente. Postgres real; KMS y GCS
 * simulados (`emitirCertificado`).
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

describe('integration: certificado de un viaje propio con cliente externo', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });
  beforeEach(() => {
    emitirCertificado.mockReset();
    emitirCertificado.mockResolvedValue({
      pdfGcsUri: 'gs://b/certificates/t/X.pdf',
      sigGcsUri: 'gs://b/certificates/t/X.pdf.sig',
      pdfSha256: 'a'.repeat(64),
      kmsKeyVersion: '1',
      issuedAt: new Date('2026-11-26T12:00:00Z'),
      pdfBytes: 1234,
    });
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  async function escenario() {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'Plan', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-cvp-${s}`,
          email: `cvp-${s}@test.invalid`,
          fullName: 'Despacho',
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario',
    );
    const transportista = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Transportes Propios ${s}`,
          rut: rutAleatorio(),
          contactEmail: `t-${s}@empresa.invalid`,
          contactPhone: '+56922222222',
          addressStreet: 'Calle 2',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId,
          carbonMeasurementEnabled: true,
        })
        .returning(),
      'transportista',
    );
    return { usuario, transportista };
  }

  test('se emite bajo la transportista y nombra al cliente externo', async () => {
    const { db } = handle;
    const e = await escenario();
    const rutCliente = rutAleatorio();
    const r = await crearViajePropio({
      db,
      logger,
      empresaTransportistaId: e.transportista.id,
      userId: e.usuario.id,
      input: {
        origen: { address_raw: 'Av. Apoquindo 3000, Las Condes', region_code: '13' },
        destino: { address_raw: 'Puerto San Antonio', region_code: '05' },
        cargo_type: 'agricola',
        cargo_weight_kg: 1200,
        pickup_date_raw: '2026-11-20',
        cliente: { tipo: 'externo', nombre: 'Viña Santa Clara SpA', rut: rutCliente },
      },
    });
    await db
      .update(schema.trips)
      .set({ status: 'entregado' })
      .where(eq(schema.trips.id, r.trip.id));
    await db
      .update(schema.assignments)
      .set({ status: 'entregado', deliveredAt: new Date('2026-11-21T12:00:00Z') })
      .where(eq(schema.assignments.id, r.assignment.id));
    await db.insert(schema.tripMetrics).values({
      tripId: r.trip.id,
      distanceKmEstimated: '110.00',
      carbonEmissionsKgco2eEstimated: '95.000',
      precisionMethod: 'por_defecto',
      glecVersion: 'v3.0',
      routeDataSource: 'maps_directions',
      coveragePct: '0',
      certificationLevel: 'secundario_default',
    });

    const res = await emitirCertificadoViaje({
      db,
      logger,
      tripId: r.trip.id,
      config: {
        kmsKeyId: 'projects/p/locations/l/keyRings/k/cryptoKeys/c',
        certificatesBucket: 'b',
        verifyBaseUrl: 'https://api.test',
      },
    });

    expect(res).toMatchObject({ skipped: false });
    expect(emitirCertificado).toHaveBeenCalledTimes(1);
    const params = emitirCertificado.mock.calls[0]?.[0] as {
      empresaShipper: { id: string; legalName: string };
      clienteExterno?: { nombre: string; rut: string | null };
    };
    expect(params.empresaShipper.id).toBe(e.transportista.id);
    expect(params.empresaShipper.legalName).toBe(e.transportista.legalName);
    expect(params.clienteExterno).toEqual({
      nombre: 'Viña Santa Clara SpA',
      rut: r.trip.clienteExternoRut,
    });
    expect(r.trip.clienteExternoRut).toBeTruthy();
  });
});
