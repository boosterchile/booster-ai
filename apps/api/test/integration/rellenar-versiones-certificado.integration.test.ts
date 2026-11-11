import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { destinoDe, formatoDestino } from '../../src/jobs/hc001-fuente-combustible-can.js';
import { main } from '../../src/jobs/rellenar-versiones-certificado.js';
import { crearVersion, obtenerVigente } from '../../src/services/certificados-versionados.js';
import { rellenarVersionesCertificado } from '../../src/services/rellenar-versiones-certificado.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * reemision-certificado parte 2 contra Postgres real: el relleno crea la
 * versión 1 de los certificados emitidos antes de que la emisión versionara,
 * copiándola de `metricas_viaje`. Es idempotente y tiene corrida en seco.
 */
const sha = (c: string) => c.repeat(64);
const EMITIDO = new Date('2026-10-20T15:00:00Z');

describe('integration: relleno de la versión 1 de los certificados emitidos', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Un viaje entregado con sus métricas; `emitido` como antes de versionar. */
  async function viaje(metricas: Partial<schema.NewTripMetricsRow> = {}) {
    const [trip] = await handle.db
      .insert(schema.trips)
      .values({
        trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        originAddressRaw: 'Origen 1',
        destinationAddressRaw: 'Destino 2',
        cargoType: 'carga_seca',
        cargoWeightKg: 3000,
        pickupDateRaw: '2026-10-19',
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: viaje no creado');
    }
    await handle.db.insert(schema.tripMetrics).values({ tripId: trip.id, ...metricas });
    return trip.id;
  }

  const emitidoSinVersion = (letra: string) =>
    viaje({
      certificateSha256: sha(letra),
      certificatePdfUrl: `gs://b/certificates/e/${letra}.pdf`,
      certificateKmsKeyVersion: '1',
      certificateIssuedAt: EMITIDO,
      fuenteDistancia: 'routes_estimada',
      motivoFallback: 'sin_telemetria',
      decisionVersion: 2,
    });

  const versiones = (tripId: string) =>
    handle.db
      .select()
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.tripId, tripId));

  const puntero = async (tripId: string) =>
    (
      await handle.db
        .select({ id: schema.tripMetrics.certificadoVigenteId })
        .from(schema.tripMetrics)
        .where(eq(schema.tripMetrics.tripId, tripId))
    )[0]?.id ?? null;

  test('un certificado emitido sin versión recibe su versión 1, copiada de sus métricas', async () => {
    const tripId = await emitidoSinVersion('a');
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    const [v1] = await versiones(tripId);
    expect(r.creadas).toContainEqual({ tripId, certificadoId: v1?.id });
    expect(v1).toMatchObject({
      version: 1,
      estado: 'vigente',
      sha256: sha('a'),
      pdfUrl: 'gs://b/certificates/e/a.pdf',
      kmsVersion: '1',
      emitidoEn: EMITIDO,
      fuenteDistancia: 'routes_estimada',
      motivoFallback: 'sin_telemetria',
      decisionVersion: 2,
      reemplazadoEn: null,
      reemplazadoPor: null,
    });
    expect(await puntero(tripId)).toBe(v1?.id);
  });

  test('no toca las columnas del certificado en las métricas', async () => {
    const tripId = await emitidoSinVersion('b');
    const [antes] = await handle.db
      .select()
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));
    await rellenarVersionesCertificado(handle.db, { dryRun: false });
    const [despues] = await handle.db
      .select()
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));

    expect({ ...despues, certificadoVigenteId: null }).toEqual(antes);
  });

  test('un viaje sin certificado emitido no recibe versión', async () => {
    const tripId = await viaje();
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(await versiones(tripId)).toEqual([]);
    expect(r.creadas.some((c) => c.tripId === tripId)).toBe(false);
    expect(r.omitidas.some((o) => o.tripId === tripId)).toBe(false);
  });

  test('un certificado emitido sin huella del PDF se omite con su motivo', async () => {
    const tripId = await viaje({ certificateIssuedAt: EMITIDO, certificateSha256: null });
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(r.omitidas.find((o) => o.tripId === tripId)?.motivo).toMatch(/huella/);
    expect(await versiones(tripId)).toEqual([]);
    expect(await puntero(tripId)).toBeNull();
  });

  test('un certificado que ya tiene su versión no se toca', async () => {
    const tripId = await emitidoSinVersion('c');
    await rellenarVersionesCertificado(handle.db, { dryRun: false });
    const [v1] = await versiones(tripId);
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(r.creadas.some((c) => c.tripId === tripId)).toBe(false);
    expect(r.enlazadas.some((c) => c.tripId === tripId)).toBe(false);
    expect(await versiones(tripId)).toEqual([v1]);
  });

  test('un certificado ya reemitido conserva su historial', async () => {
    const tripId = await emitidoSinVersion('d');
    await rellenarVersionesCertificado(handle.db, { dryRun: false });
    const v2 = await crearVersion(handle.db, {
      tripId,
      sha256: sha('e'),
      pdfUrl: 'gs://b/certificates/e/e.pdf',
      kmsVersion: '1',
      emitidoEn: new Date('2026-11-11T12:00:00Z'),
      fuenteDistancia: null,
      motivoFallback: null,
      decisionVersion: null,
    });
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(r.creadas.some((c) => c.tripId === tripId)).toBe(false);
    expect((await versiones(tripId)).map((v) => [v.version, v.estado]).sort()).toEqual([
      [1, 'reemplazado'],
      [2, 'vigente'],
    ]);
    expect(await puntero(tripId)).toBe(v2.id);
  });

  test('si la versión vigente existe y las métricas no la apuntan, las enlaza', async () => {
    const tripId = await emitidoSinVersion('f');
    await rellenarVersionesCertificado(handle.db, { dryRun: false });
    const vigente = await obtenerVigente(handle.db, tripId);
    await handle.db
      .update(schema.tripMetrics)
      .set({ certificadoVigenteId: null })
      .where(eq(schema.tripMetrics.tripId, tripId));
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(r.enlazadas).toContainEqual({ tripId, certificadoId: vigente?.id });
    expect(await puntero(tripId)).toBe(vigente?.id);
    expect(await versiones(tripId)).toHaveLength(1);
  });

  test('si la versión vigente no es la de las métricas, se omite y no se cambia nada', async () => {
    const tripId = await emitidoSinVersion('g');
    await rellenarVersionesCertificado(handle.db, { dryRun: false });
    await handle.db
      .update(schema.tripMetrics)
      .set({ certificateSha256: sha('h') })
      .where(eq(schema.tripMetrics.tripId, tripId));
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: false });

    expect(r.omitidas.find((o) => o.tripId === tripId)?.motivo).toMatch(/no coincide/);
    expect((await versiones(tripId))[0]?.sha256).toBe(sha('g'));
  });

  test('en seco informa lo que haría y no escribe nada', async () => {
    const tripId = await emitidoSinVersion('i');
    const r = await rellenarVersionesCertificado(handle.db, { dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.creadas.some((c) => c.tripId === tripId)).toBe(true);
    expect(await versiones(tripId)).toEqual([]);
    expect(await puntero(tripId)).toBeNull();
  });

  test('el job corre en seco si no se le pide escribir', async () => {
    const tripId = await emitidoSinVersion('j');
    const r = await main({ DATABASE_URL: handle.url });

    expect(r.dryRun).toBe(true);
    expect(r.creadas.some((c) => c.tripId === tripId)).toBe(true);
    expect(await versiones(tripId)).toEqual([]);
  });

  test('el job no escribe sin la confirmación del destino', async () => {
    const tripId = await emitidoSinVersion('k');
    await expect(main({ DATABASE_URL: handle.url, DRY_RUN: 'false' })).rejects.toThrow(
      /CONFIRMAR_DESTINO/,
    );
    expect(await versiones(tripId)).toEqual([]);
  });

  test('el job escribe con el destino confirmado', async () => {
    const tripId = await emitidoSinVersion('l');
    const r = await main({
      DATABASE_URL: handle.url,
      DRY_RUN: 'false',
      CONFIRMAR_DESTINO: formatoDestino(destinoDe(handle.url)),
    });

    expect(r.dryRun).toBe(false);
    expect(await versiones(tripId)).toHaveLength(1);
  });

  test('el job exige la conexión', async () => {
    await expect(main({})).rejects.toThrow();
  });
});
