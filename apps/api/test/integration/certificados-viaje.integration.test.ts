import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createCertificatesRoutes } from '../../src/routes/certificates.js';
import {
  crearVersion,
  obtenerVigente,
  revertirVersion,
} from '../../src/services/certificados-versionados.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * HC-001 p3a contra Postgres real: migración 0067 (up/down y backfill de la v1
 * de BOO-HC7DJX), transacción de reemplazo, reversa y /verify de la v1 contra la v2.
 */
const UP = readFileSync(
  new URL('../../drizzle/0067_certificados_viaje.sql', import.meta.url),
  'utf8',
);
const DOWN = readFileSync(
  new URL('../../drizzle/down/0067_certificados_viaje.down.sql', import.meta.url),
  'utf8',
);
const sha = (c: string) => c.repeat(64);
const EMITIDO_V1 = new Date('2026-10-20T15:00:00Z');

describe('integration: certificados versionados (HC-001 p3a)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  // Viaje con la v1 emitida en metricas_viaje (como en prod antes de la 0067).
  async function viajeEmitido(db: TestDbHandle['db'], tracking: string) {
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: tracking,
        originAddressRaw: 'Origen 1',
        destinationAddressRaw: 'Destino 2',
        cargoType: 'carga_seca',
        cargoWeightKg: 3000,
        pickupDateRaw: '2026-10-19',
        pickupWindowStart: new Date('2026-10-19T12:00:00Z'),
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: viaje no creado');
    }
    // SQL explícito: corre también con la 0067 revertida (sin certificado_vigente_id).
    await db.execute(sql`
      INSERT INTO metricas_viaje (viaje_id, certificado_sha256, certificado_pdf_url,
        certificado_kms_version, certificado_emitido_en, fuente_distancia, motivo_fallback,
        decision_version)
      VALUES (${trip.id}, ${sha('a')}, ${`gs://b/certificates/e/${tracking}.pdf`}, '1',
        ${EMITIDO_V1.toISOString()}, 'routes_estimada', 'routes_error', 1)`);
    return trip.id;
  }

  // DDL dentro de una transacción que se revierte: no toca el estado del resto.
  async function enTransaccion(fn: (c: PoolClient) => Promise<void>) {
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  const existeTabla = async (c: PoolClient) =>
    (await c.query("SELECT to_regclass('certificados_viaje') AS t")).rows[0].t !== null;

  test('migración: down borra tabla y columna; up las recrea sin el viaje (no falla, 0 filas)', async () => {
    await enTransaccion(async (c) => {
      await c.query(DOWN);
      expect(await existeTabla(c)).toBe(false);
      const col = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name='metricas_viaje' AND column_name='certificado_vigente_id'",
      );
      expect(col.rowCount).toBe(0);
      await c.query(UP);
      expect(await existeTabla(c)).toBe(true);
      expect((await c.query('SELECT count(*)::int AS n FROM certificados_viaje')).rows[0].n).toBe(
        0,
      );
    });
  });

  test('backfill: copia la v1 de BOO-HC7DJX, apunta metricas_viaje y es idempotente', async () => {
    await enTransaccion(async (c) => {
      await c.query(DOWN);
      const tripId = await viajeEmitido(drizzle(c, { schema }) as never, 'BOO-HC7DJX');
      const otro = await viajeEmitido(drizzle(c, { schema }) as never, 'BOO-OTRO01');
      await c.query(UP);
      await c.query(UP); // idempotente
      const filas = await c.query(
        'SELECT viaje_id, version, estado, sha256, kms_version, emitido_en, fuente_distancia, motivo_fallback, decision_version FROM certificados_viaje',
      );
      expect(filas.rows).toEqual([
        {
          viaje_id: tripId,
          version: 1,
          estado: 'vigente',
          sha256: sha('a'),
          kms_version: '1',
          emitido_en: EMITIDO_V1,
          fuente_distancia: 'routes_estimada',
          motivo_fallback: 'routes_error',
          decision_version: 1,
        },
      ]);
      const ptr = await c.query(
        'SELECT viaje_id, certificado_vigente_id FROM metricas_viaje WHERE viaje_id = ANY($1) ORDER BY viaje_id = $2 DESC',
        [[tripId, otro], tripId],
      );
      expect(ptr.rows[0].certificado_vigente_id).not.toBeNull();
      expect(ptr.rows[1].certificado_vigente_id).toBeNull(); // otro viaje: sin backfill
    });
  });

  // Fixtures commiteados para el servicio y /verify (tracking único por test).
  async function conV1() {
    const tracking = `BOO-${randomUUID().slice(0, 6).toUpperCase()}`;
    const tripId = await viajeEmitido(handle.db as never, tracking);
    const [v1] = await handle.db
      .insert(schema.certificadosViaje)
      .values({
        tripId,
        version: 1,
        sha256: sha('a'),
        kmsVersion: '1',
        pdfUrl: `gs://b/certificates/e/${tracking}.pdf`,
        emitidoEn: EMITIDO_V1,
      })
      .returning();
    await handle.db
      .update(schema.tripMetrics)
      .set({ certificadoVigenteId: v1?.id })
      .where(eq(schema.tripMetrics.tripId, tripId));
    return { tracking, tripId };
  }
  const v2 = (tripId: string) => ({
    tripId,
    sha256: sha('b'),
    pdfUrl: 'gs://b/certificates/e/x.v2.pdf',
    kmsVersion: '2',
    emitidoEn: new Date('2026-11-03T12:00:00Z'),
    fuenteDistancia: 'teltonika_gps',
    motivoFallback: null,
    decisionVersion: 1,
  });
  const historial = (tripId: string) =>
    handle.db
      .select()
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.tripId, tripId))
      .orderBy(schema.certificadosViaje.version);
  const metricas = async (tripId: string) =>
    (
      await handle.db.select().from(schema.tripMetrics).where(eq(schema.tripMetrics.tripId, tripId))
    )[0];

  test('crearVersion: v1 queda reemplazada por la v2 y metricas_viaje espeja la v2', async () => {
    const { tripId } = await conV1();
    const nueva = await crearVersion(handle.db as never, v2(tripId));
    const [h1, h2] = await historial(tripId);
    expect(h1).toMatchObject({ version: 1, estado: 'reemplazado', reemplazadoPor: nueva.id });
    expect(h1?.reemplazadoEn).toBeInstanceOf(Date);
    expect(h2).toMatchObject({ version: 2, estado: 'vigente', fuenteDistancia: 'teltonika_gps' });
    expect(await metricas(tripId)).toMatchObject({
      certificadoVigenteId: nueva.id,
      certificateSha256: sha('b'),
      certificateKmsKeyVersion: '2',
      certificatePdfUrl: 'gs://b/certificates/e/x.v2.pdf',
    });
    expect((await obtenerVigente(handle.db as never, tripId))?.version).toBe(2);
  });

  test('crearVersion es atómica: si el INSERT falla, la v1 sigue vigente y nada cambia', async () => {
    const { tripId } = await conV1();
    await expect(
      crearVersion(handle.db as never, { ...v2(tripId), sha256: 'x'.repeat(65) }),
    ).rejects.toThrow();
    const h = await historial(tripId);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ estado: 'vigente', reemplazadoEn: null, reemplazadoPor: null });
    expect((await metricas(tripId))?.certificateSha256).toBe(sha('a'));
  });

  test('crearVersion sin vigente lanza; la DB no admite dos vigentes', async () => {
    const tracking = `BOO-${randomUUID().slice(0, 6).toUpperCase()}`;
    const tripId = await viajeEmitido(handle.db as never, tracking);
    await expect(crearVersion(handle.db as never, v2(tripId))).rejects.toThrow(
      /no tiene versión vigente/,
    );
    const { tripId: conUna } = await conV1();
    await expect(
      handle.db
        .insert(schema.certificadosViaje)
        .values({ tripId: conUna, version: 2, sha256: sha('c'), emitidoEn: new Date() }),
    ).rejects.toThrow();
  });

  test('revertirVersion: v2 revertida, v1 vigente otra vez; una nueva reemisión es la v3', async () => {
    const { tripId } = await conV1();
    await crearVersion(handle.db as never, v2(tripId));
    const vuelta = await revertirVersion(handle.db as never, tripId);
    expect(vuelta).toMatchObject({
      version: 1,
      estado: 'vigente',
      reemplazadoEn: null,
      reemplazadoPor: null,
    });
    const [, h2] = await historial(tripId);
    expect(h2).toMatchObject({ version: 2, estado: 'revertido' });
    expect(await metricas(tripId)).toMatchObject({
      certificadoVigenteId: vuelta.id,
      certificateSha256: sha('a'),
      certificateKmsKeyVersion: '1',
      certificateIssuedAt: EMITIDO_V1,
    });
    await expect(revertirVersion(handle.db as never, tripId)).rejects.toThrow(/no reemplazó/);
    const v3 = await crearVersion(handle.db as never, { ...v2(tripId), sha256: sha('d') });
    expect(v3.version).toBe(3);
  });

  test('/verify: reemplazada y revertida responden valid:false; vigente y sin sha256, como hoy', async () => {
    const { tracking, tripId } = await conV1();
    await crearVersion(handle.db as never, v2(tripId));
    const noop = () => undefined;
    const app = createCertificatesRoutes({
      db: handle.db as never,
      logger: { info: noop, warn: noop, error: noop, debug: noop } as never,
      certConfig: { certificatesBucket: 'b' },
    });
    const r1 = await app.request(`/${tracking}/verify?sha256=${sha('a')}`);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({
      valid: false,
      firma_autentica: true,
      vigente: false,
      estado: 'reemplazado',
      version: 1,
      mensaje: 'reemplazado por v2',
      version_vigente: { version: 2, pdf_sha256: sha('b') },
    });
    // La v2 (vigente) y la consulta sin sha256 siguen el camino de siempre
    // (el fixture no tiene generador de carga → certificate_not_issued, antes de GCS).
    for (const q of [`?sha256=${sha('b')}`, '']) {
      const r = await app.request(`/${tracking}/verify${q}`);
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ code: 'certificate_not_issued' });
    }
    // Hex válido que no es ninguna versión del viaje → valid:false, nunca el de otra.
    const otro = await app.request(`/${tracking}/verify?sha256=${sha('e')}`);
    expect(otro.status).toBe(200);
    expect(await otro.json()).toEqual({
      valid: false,
      tracking_code: tracking,
      motivo: 'sha256_no_corresponde',
    });
    // Formato inválido (mayúsculas, largo, no hex) → 400 del patrón zValidator.
    for (const malo of [sha('A'), 'a'.repeat(63), `${'g'.repeat(64)}`, '']) {
      const r = await app.request(`/${tracking}/verify?sha256=${malo}`);
      expect(r.status, malo).toBe(400);
      expect(await r.json()).toMatchObject({ success: false });
    }
    await revertirVersion(handle.db as never, tripId);
    const r2 = await app.request(`/${tracking}/verify?sha256=${sha('b')}`);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({
      valid: false,
      firma_autentica: true,
      vigente: false,
      estado: 'revertido',
      mensaje: 'revertido; vigente v1',
      version_vigente: { version: 1, pdf_sha256: sha('a') },
    });
  });
});
