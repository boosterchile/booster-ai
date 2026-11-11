import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// KMS y el bucket se simulan: aquí se prueba lo que la reemisión hace con la
// base. La ruta por versión del bucket se prueba en certificate-generator.
const { emitirCertificado } = vi.hoisted(() => ({ emitirCertificado: vi.fn() }));
vi.mock('@booster-ai/certificate-generator', async (original) => ({
  ...(await original<typeof import('@booster-ai/certificate-generator')>()),
  emitirCertificado,
}));
const { ArtefactoYaSubidoError } = await import('@booster-ai/certificate-generator');

import * as schema from '../../src/db/schema.js';
import { createCertificatesRoutes } from '../../src/routes/certificates.js';
import {
  registrarPrimeraVersion,
  revertirVersion,
} from '../../src/services/certificados-versionados.js';
import {
  ReemisionConcurrenteError,
  reemitirCertificado,
} from '../../src/services/reemitir-certificado.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * reemision-certificado parte 3 (spec §3.2 a §3.4) contra Postgres real.
 *
 * El caso que la motiva: un certificado cerrado con el factor 3,24 cuyas
 * métricas guardaron el 3,25 de la estimación. La reemisión corrige el
 * factor, genera y sube la versión 2, y deja la 1 como reemplazada.
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
const sha = (c: string) => c.repeat(64);
const CONFIG = {
  kmsKeyId: 'projects/p/locations/l/keyRings/k/cryptoKeys/c',
  certificatesBucket: 'b',
  verifyBaseUrl: 'https://api.test',
};
const EMITIDO_V1 = new Date('2026-11-03T06:18:23Z');
const EMITIDO_V2 = new Date('2026-11-12T12:00:00Z');
const CORRECCION = {
  motivo: 'factor_impreso_no_corresponde',
  factorAnterior: 3.25,
  factorNuevo: 3.24,
} as const;

describe('integration: reemisión de un certificado', () => {
  let handle: TestDbHandle;
  let base: { empresaId: string; usuarioId: string };

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
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
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `u-${suffix}@test.invalid`,
          fullName: 'PO',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Generadora ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `e-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: false,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id }),
      'empresa',
    );
    base = { empresaId: empresa.id, usuarioId: usuario.id };
  });
  afterAll(async () => {
    await handle.pool.end();
  });
  beforeEach(() => {
    emitirCertificado.mockReset();
    emitirCertificado.mockResolvedValue({
      pdfGcsUri: 'gs://b/certificates/e/X.v2.pdf',
      sigGcsUri: 'gs://b/certificates/e/X.v2.pdf.sig',
      pdfSha256: sha('b'),
      kmsKeyVersion: '1',
      issuedAt: EMITIDO_V2,
      pdfBytes: 1234,
    });
  });

  /** Un viaje entregado con su certificado emitido y su versión 1. */
  async function emitido(metricas: Partial<schema.NewTripMetricsRow> = {}) {
    const { db } = handle;
    const tracking = `BOO-${randomUUID().slice(0, 6).toUpperCase()}`;
    const trip = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: tracking,
          generadorCargaEmpresaId: base.empresaId,
          createdByUserId: base.usuarioId,
          originAddressRaw: 'Origen 1',
          destinationAddressRaw: 'Destino 2',
          cargoType: 'carga_seca',
          cargoWeightKg: 20_000,
          pickupDateRaw: '2026-10-30',
          status: 'entregado',
        })
        .returning({ id: schema.trips.id }),
      'viaje',
    );
    await db.insert(schema.tripMetrics).values({
      tripId: trip.id,
      carbonEmissionsKgco2eEstimated: '545.764',
      carbonEmissionsKgco2eActual: '590.746',
      fuelConsumedLEstimated: '167.93',
      fuelConsumedLActual: '182.33',
      emisionesKgco2eTtw: '486.818',
      emisionesKgco2eWtt: '103.927',
      emissionFactorUsed: '3.25000',
      precisionMethod: 'por_defecto',
      certificateSha256: sha('a'),
      certificatePdfUrl: `gs://b/certificates/e/${tracking}.pdf`,
      certificateKmsKeyVersion: '1',
      certificateIssuedAt: EMITIDO_V1,
      ...metricas,
    });
    const v1 = await db.transaction((tx) =>
      registrarPrimeraVersion(tx, {
        tripId: trip.id,
        sha256: sha('a'),
        pdfUrl: `gs://b/certificates/e/${tracking}.pdf`,
        kmsVersion: '1',
        emitidoEn: EMITIDO_V1,
        fuenteDistancia: null,
        motivoFallback: null,
        decisionVersion: null,
      }),
    );
    await db
      .update(schema.tripMetrics)
      .set({ certificadoVigenteId: v1.id })
      .where(eq(schema.tripMetrics.tripId, trip.id));
    return { tripId: trip.id, tracking, v1Id: v1.id };
  }

  const reemitir = (tripId: string, correccion = CORRECCION) =>
    reemitirCertificado({
      db: handle.db,
      logger,
      tripId,
      correccion,
      solicitadoPorUserId: base.usuarioId,
      config: CONFIG,
    });

  const versiones = (tripId: string) =>
    handle.db
      .select()
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.tripId, tripId))
      .orderBy(schema.certificadosViaje.version);
  const metricas = async (tripId: string) =>
    uno(
      await handle.db
        .select()
        .from(schema.tripMetrics)
        .where(eq(schema.tripMetrics.tripId, tripId)),
      'métricas',
    );
  const eventos = (tripId: string) =>
    handle.db
      .select({
        payload: schema.tripEvents.payload,
        recordedByUserId: schema.tripEvents.recordedByUserId,
      })
      .from(schema.tripEvents)
      .where(
        and(
          eq(schema.tripEvents.tripId, tripId),
          eq(schema.tripEvents.eventType, 'certificado_reemitido'),
        ),
      );

  test('reemitir crea la versión 2 con el factor corregido y deja la 1 reemplazada', async () => {
    const { tripId, v1Id } = await emitido();
    const r = await reemitir(tripId);

    expect(r).toMatchObject({
      ok: true,
      version: 2,
      sha256Anterior: sha('a'),
      sha256Nuevo: sha('b'),
    });
    // El PDF se generó con el factor nuevo, en la ruta de la versión 2.
    expect(emitirCertificado).toHaveBeenCalledTimes(1);
    const params = emitirCertificado.mock.calls[0]?.[0];
    expect(params).toMatchObject({ version: 2, metricas: { emissionFactorUsado: 3.24 } });
    // Las emisiones impresas no cambian.
    expect(params.metricas.kgco2eWtwActual).toBe(590.746);
    // El certificado dice a qué versión reemplaza, de cuándo y por qué (§8-2).
    expect(params.viaje.version).toEqual({
      numero: 2,
      reemplazaA: 1,
      reemplazaEmitidoEn: EMITIDO_V1,
      motivo: 'factor_impreso_no_corresponde',
    });
    // Y con esos datos el PDF real se genera (la plantilla valida la versión).
    const { generarPdfBase } = await import('@booster-ai/certificate-generator');
    await expect(
      generarPdfBase({
        viaje: params.viaje,
        metricas: params.metricas,
        empresaShipper: params.empresaShipper,
        transportista: params.transportista,
        verifyUrl: 'https://x/verify',
      }),
    ).resolves.toBeInstanceOf(Uint8Array);

    const [v1, v2] = await versiones(tripId);
    expect(v1).toMatchObject({
      id: v1Id,
      estado: 'reemplazado',
      reemplazadoPor: v2?.id,
      motivoReemision: null,
    });
    expect(v2).toMatchObject({
      version: 2,
      estado: 'vigente',
      sha256: sha('b'),
      pdfUrl: 'gs://b/certificates/e/X.v2.pdf',
      emitidoEn: EMITIDO_V2,
      motivoReemision: 'factor_impreso_no_corresponde',
    });
    expect(await metricas(tripId)).toMatchObject({
      emissionFactorUsed: '3.24000',
      certificadoVigenteId: v2?.id,
      certificateSha256: sha('b'),
      certificatePdfUrl: 'gs://b/certificates/e/X.v2.pdf',
      certificateIssuedAt: EMITIDO_V2,
      carbonEmissionsKgco2eActual: '590.746',
    });
  });

  test('queda el evento con el motivo, quién lo pidió y las dos huellas', async () => {
    const { tripId } = await emitido();
    await reemitir(tripId);

    expect(await eventos(tripId)).toEqual([
      {
        recordedByUserId: base.usuarioId,
        payload: {
          motivo: 'factor_impreso_no_corresponde',
          version_anterior: 1,
          version_nueva: 2,
          sha256_anterior: sha('a'),
          sha256_nuevo: sha('b'),
          pdf_uri: 'gs://b/certificates/e/X.v2.pdf',
          correccion: { factor_emision_usado: { anterior: 3.25, nuevo: 3.24 } },
        },
      },
    ]);
  });

  test('si el factor guardado no es el anterior indicado, no hace nada', async () => {
    const { tripId } = await emitido({ emissionFactorUsed: '3.24000' });
    const r = await reemitir(tripId);

    expect(r).toMatchObject({ ok: false, code: 'correccion_no_corresponde' });
    expect(emitirCertificado).not.toHaveBeenCalled();
    expect(await versiones(tripId)).toHaveLength(1);
  });

  test('si el factor nuevo no explica la cifra publicada, no hace nada', async () => {
    const { tripId } = await emitido();
    const r = await reemitir(tripId, { ...CORRECCION, factorNuevo: 3.3 });

    expect(r).toMatchObject({ ok: false, code: 'correccion_no_explica_cifra' });
    expect(emitirCertificado).not.toHaveBeenCalled();
    expect((await metricas(tripId)).emissionFactorUsed).toBe('3.25000');
  });

  test('si generar, firmar o subir falla, la base no cambia', async () => {
    const { tripId } = await emitido();
    emitirCertificado.mockRejectedValueOnce(new Error('KMS caído'));

    await expect(reemitir(tripId)).rejects.toThrow('KMS caído');
    expect(await versiones(tripId)).toHaveLength(1);
    expect(await metricas(tripId)).toMatchObject({
      emissionFactorUsed: '3.25000',
      certificateSha256: sha('a'),
    });
    expect(await eventos(tripId)).toEqual([]);
  });

  test('si el certificado cambió mientras se generaba el PDF, no registra nada', async () => {
    const { tripId } = await emitido();
    emitirCertificado.mockImplementationOnce(async () => {
      // Otro proceso corrige el factor entre la lectura y la transacción.
      await handle.db
        .update(schema.tripMetrics)
        .set({ emissionFactorUsed: '3.24000' })
        .where(eq(schema.tripMetrics.tripId, tripId));
      return {
        pdfGcsUri: 'gs://b/certificates/e/X.v2.pdf',
        sigGcsUri: 'gs://b/certificates/e/X.v2.pdf.sig',
        pdfSha256: sha('b'),
        kmsKeyVersion: '1',
        issuedAt: EMITIDO_V2,
        pdfBytes: 1,
      };
    });

    await expect(reemitir(tripId)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
    expect(await versiones(tripId)).toHaveLength(1);
    expect(await eventos(tripId)).toEqual([]);
  });

  test('un certificado sin versión vigente no se reemite', async () => {
    const { tripId, v1Id } = await emitido();
    await handle.db
      .update(schema.tripMetrics)
      .set({ certificadoVigenteId: null })
      .where(eq(schema.tripMetrics.tripId, tripId));
    await handle.db.delete(schema.certificadosViaje).where(eq(schema.certificadosViaje.id, v1Id));

    expect(await reemitir(tripId)).toMatchObject({ ok: false, code: 'sin_version_vigente' });
    expect(emitirCertificado).not.toHaveBeenCalled();
  });

  test('un viaje sin certificado emitido no se reemite', async () => {
    const { tripId } = await emitido();
    await handle.db
      .update(schema.tripMetrics)
      .set({ certificateIssuedAt: null })
      .where(eq(schema.tripMetrics.tripId, tripId));

    expect(await reemitir(tripId)).toMatchObject({ ok: false, code: 'certificate_not_issued' });
  });

  test('una segunda reemisión crea la versión 3 y la ruta de su versión', async () => {
    const { tripId } = await emitido();
    await reemitir(tripId);
    emitirCertificado.mockResolvedValueOnce({
      pdfGcsUri: 'gs://b/certificates/e/X.v3.pdf',
      sigGcsUri: 'gs://b/certificates/e/X.v3.pdf.sig',
      pdfSha256: sha('c'),
      kmsKeyVersion: '1',
      issuedAt: new Date('2026-11-13T12:00:00Z'),
      pdfBytes: 1,
    });
    const r = await reemitir(tripId, { ...CORRECCION, factorAnterior: 3.24, factorNuevo: 3.24001 });

    expect(r).toMatchObject({ ok: true, version: 3 });
    expect(emitirCertificado.mock.calls[1]?.[0]).toMatchObject({
      version: 3,
      viaje: { version: { numero: 3, reemplazaA: 2, reemplazaEmitidoEn: EMITIDO_V2 } },
    });
    expect((await versiones(tripId)).map((v) => v.estado)).toEqual([
      'reemplazado',
      'reemplazado',
      'vigente',
    ]);
  });

  test('después de revertir una reemisión, la siguiente es la versión 3 y no reusa la ruta de la 2', async () => {
    const { tripId } = await emitido();
    await reemitir(tripId);
    await revertirVersion(handle.db, tripId);
    // La reversa vuelve la versión 1, con el factor que tenía.
    await handle.db
      .update(schema.tripMetrics)
      .set({ emissionFactorUsed: '3.25000' })
      .where(eq(schema.tripMetrics.tripId, tripId));
    emitirCertificado.mockResolvedValueOnce({
      pdfGcsUri: 'gs://b/certificates/e/X.v3.pdf',
      sigGcsUri: 'gs://b/certificates/e/X.v3.pdf.sig',
      pdfSha256: sha('d'),
      kmsKeyVersion: '1',
      issuedAt: new Date('2026-11-13T12:00:00Z'),
      pdfBytes: 1,
    });
    const r = await reemitir(tripId);

    expect(r).toMatchObject({ ok: true, version: 3 });
    // Reemplaza a la que estaba vigente (la 1), no a la revertida.
    expect(emitirCertificado.mock.calls[1]?.[0]).toMatchObject({
      version: 3,
      viaje: { version: { numero: 3, reemplazaA: 1, reemplazaEmitidoEn: EMITIDO_V1 } },
    });
    expect((await versiones(tripId)).map((v) => [v.version, v.estado])).toEqual([
      [1, 'reemplazado'],
      [2, 'revertido'],
      [3, 'vigente'],
    ]);
  });

  test('si el PDF de esa versión ya estaba subido, no registra nada', async () => {
    const { tripId } = await emitido();
    emitirCertificado.mockRejectedValueOnce(new ArtefactoYaSubidoError('certificates/e/X.v2.pdf'));

    await expect(reemitir(tripId)).rejects.toBeInstanceOf(ReemisionConcurrenteError);
    expect(await versiones(tripId)).toHaveLength(1);
    expect((await metricas(tripId)).emissionFactorUsed).toBe('3.25000');
  });

  test('la verificación pública: la versión 1 aparece reemplazada por la 2', async () => {
    const { tripId, tracking } = await emitido();
    await reemitir(tripId);
    const app = createCertificatesRoutes({
      db: handle.db as never,
      logger: { info: noop, warn: noop, error: noop, debug: noop } as never,
      certConfig: { certificatesBucket: 'b' },
    });

    const r = await app.request(`/${tracking}/verify?sha256=${sha('a')}`);
    expect(await r.json()).toMatchObject({
      valid: false,
      firma_autentica: true,
      vigente: false,
      estado: 'reemplazado',
      version: 1,
      mensaje: 'reemplazado por v2',
      version_vigente: { version: 2, pdf_sha256: sha('b') },
    });
  });
});

describe('integration: migración 0082 — motivo de la reemisión', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('la versión 1 no lleva motivo y una posterior sí, de la lista cerrada', async () => {
    const r = await handle.pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.certificados_viaje'::regclass AND conname = 'ck_certificados_viaje_motivo'`,
    );
    expect(r.rows[0]?.def).toMatch(/version = 1/);
    expect(r.rows[0]?.def).toMatch(/factor_impreso_no_corresponde/);
  });

  test('una versión posterior sin motivo se rechaza', async () => {
    const [trip] = await handle.db
      .insert(schema.trips)
      .values({
        trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        originAddressRaw: 'A',
        destinationAddressRaw: 'B',
        cargoType: 'carga_seca',
        pickupDateRaw: '2026-11-10',
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    const fila = (version: number, motivoReemision: string | null) => ({
      tripId: trip?.id ?? '',
      version,
      estado: 'reemplazado',
      sha256: sha(String(version)),
      emitidoEn: new Date(),
      motivoReemision,
    });
    const restriccion = async (valores: ReturnType<typeof fila>) => {
      try {
        await handle.db.insert(schema.certificadosViaje).values(valores);
        return null;
      } catch (err) {
        return (err as { cause?: { constraint?: string } }).cause?.constraint ?? 'otro error';
      }
    };

    expect(await restriccion(fila(2, null))).toBe('ck_certificados_viaje_motivo');
    expect(await restriccion(fila(2, 'otro_motivo'))).toBe('ck_certificados_viaje_motivo');
    expect(await restriccion(fila(1, 'factor_impreso_no_corresponde'))).toBe(
      'ck_certificados_viaje_motivo',
    );
    expect(await restriccion(fila(2, 'factor_impreso_no_corresponde'))).toBeNull();
  });

  test('el tipo de evento del viaje incluye la reemisión', async () => {
    const r = await handle.pool.query(
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'tipo_evento_viaje' AND e.enumlabel = 'certificado_reemitido'`,
    );
    expect(r.rowCount).toBe(1);
  });
});
