import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  type DocumentoSubidoMensaje,
  reconciliarDocumentosPendientes,
} from '../../src/services/reconciliar-documentos-pendientes.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T10-21 (document-service) contra Postgres real: el reconciliador libera
 * `procesando` abandonados a `fallido` sin republicarlos, republica los
 * `pendiente` viejos con el payload que valida el worker, y deja intactos los
 * recientes y los terminales. Se verifica por estado de fila, no por SQL.
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
} as never as Logger;

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

type Estado = (typeof schema.extractionStatusEnum.enumValues)[number];

describe('integration: reconciliación de documentos_transporte (T10-21)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function viaje() {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `Plan Docs ${s}`,
            description: 'fixture',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-docs-${s}`, email: `docs-${s}@test.invalid`, fullName: 'Docs' })
        .returning(),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Docs SpA ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `empresa-docs-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: true,
          planId: plan.id,
        })
        .returning(),
      'empresa',
    );
    return uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: user.id,
          originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
          destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-10-08',
        })
        .returning(),
      'viaje',
    );
  }

  async function documento(viajeId: string, estado: Estado, minutosDesdeTocado: number) {
    const { db } = handle;
    const id = randomUUID();
    await db.insert(schema.transportDocuments).values({
      id,
      viajeId,
      filePath: `transport-documents/${viajeId}/${id}.pdf`,
      fileMime: 'application/pdf',
      docType: '52',
      extractionStatus: estado,
      source: 'pdf_upload',
    });
    await db.execute(sql`
      UPDATE documentos_transporte
      SET actualizado_en = now() - make_interval(mins => ${minutosDesdeTocado})
      WHERE id = ${id}
    `);
    return id;
  }

  async function estadoDe(id: string) {
    const fila = uno(
      await handle.db
        .select({
          estado: schema.transportDocuments.extractionStatus,
          tocado: schema.transportDocuments.updatedAt,
        })
        .from(schema.transportDocuments)
        .where(eq(schema.transportDocuments.id, id)),
      'documento',
    );
    return fila;
  }

  test('libera procesando abandonados, republica pendientes viejos y respeta el resto', async () => {
    const v = await viaje();
    const procesandoViejo = await documento(v.id, 'procesando', 45);
    const procesandoReciente = await documento(v.id, 'procesando', 5);
    const pendienteViejo = await documento(v.id, 'pendiente', 20);
    const pendienteReciente = await documento(v.id, 'pendiente', 2);
    const decodificadoViejo = await documento(v.id, 'decodificado', 120);

    const publicados: DocumentoSubidoMensaje[] = [];
    const publicar = vi.fn(async (m: DocumentoSubidoMensaje) => {
      publicados.push(m);
    });

    const r = await reconciliarDocumentosPendientes({ db: handle.db, logger, publicar });

    expect(r.liberados).toBeGreaterThanOrEqual(1);
    expect((await estadoDe(procesandoViejo)).estado).toBe('fallido');
    expect((await estadoDe(procesandoReciente)).estado).toBe('procesando');
    expect((await estadoDe(decodificadoViejo)).estado).toBe('decodificado');

    const ids = publicados.map((m) => m.documentId);
    expect(ids).toContain(pendienteViejo);
    expect(ids).not.toContain(pendienteReciente);
    expect(ids).not.toContain(procesandoViejo);
    expect(publicados.find((m) => m.documentId === pendienteViejo)).toEqual({
      documentId: pendienteViejo,
      viajeId: v.id,
      filePath: `transport-documents/${v.id}/${pendienteViejo}.pdf`,
      fileMime: 'application/pdf',
    });

    // El republicado sigue `pendiente` (lo toma el worker) con actualizado_en
    // renovado: el tick siguiente no lo vuelve a publicar.
    const tras = await estadoDe(pendienteViejo);
    expect(tras.estado).toBe('pendiente');
    expect(Date.now() - tras.tocado.getTime()).toBeLessThan(60_000);

    const segundo: string[] = [];
    await reconciliarDocumentosPendientes({
      db: handle.db,
      logger,
      publicar: async (m) => {
        segundo.push(m.documentId);
      },
    });
    expect(segundo).not.toContain(pendienteViejo);
  });

  test('respeta el límite por tick', async () => {
    const v = await viaje();
    for (let i = 0; i < 3; i++) {
      await documento(v.id, 'pendiente', 30);
    }
    const publicar = vi.fn(async () => undefined);
    const r = await reconciliarDocumentosPendientes({ db: handle.db, logger, publicar, limite: 2 });
    expect(r.republicados).toBe(2);
    expect(publicar).toHaveBeenCalledTimes(2);
  });
});
