import { describe, expect, it, vi } from 'vitest';
import { tripMetrics } from '../../src/db/schema.js';
import {
  VerificacionVersionesError,
  rellenarVersionesCertificado,
} from '../../src/services/rellenar-versiones-certificado.js';

// La versión 1 se crea con la misma función que usa la emisión.
const registrarPrimeraVersion = vi.hoisted(() => vi.fn(async () => ({ id: 'cert-nuevo' })));
vi.mock('../../src/services/certificados-versionados.js', () => ({ registrarPrimeraVersion }));

// El comportamiento contra PostgreSQL está en
// test/integration/rellenar-versiones-certificado.integration.test.ts.

type Filas = Record<string, unknown>[];

function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    { from: () => cadena, where: () => cadena, orderBy: () => cadena, for: () => cadena },
  );
  return cadena;
}

/** Cada SELECT consume la siguiente respuesta: emitidos, versiones por viaje y la verificación. */
function baseFalsa(selects: Filas[]) {
  const cola = [...selects];
  const updates: Record<string, unknown>[] = [];
  const tx = {
    select: vi.fn(() => consulta(cola.shift() ?? [])),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: Record<string, unknown>) => {
        expect(tabla).toBe(tripMetrics);
        updates.push(valores);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  const db = { transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)) };
  return { db: db as never, updates };
}

const EMITIDO = {
  tripId: 'viaje-1',
  sha256: 'a'.repeat(64),
  pdfUrl: 'gs://b/a.pdf',
  kmsVersion: '1',
  emitidoEn: new Date('2026-10-20T15:00:00Z'),
  vigenteId: null,
  fuenteDistancia: 'routes_estimada',
  motivoFallback: null,
  decisionVersion: 2,
};
const VERIFICACION_LIMPIA: Filas = [];

describe('rellenarVersionesCertificado', () => {
  it('crea la versión 1 de un certificado sin versiones y deja las métricas apuntando a ella', async () => {
    registrarPrimeraVersion.mockClear();
    const { db, updates } = baseFalsa([[EMITIDO], [], VERIFICACION_LIMPIA]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });

    expect(r).toEqual({
      dryRun: false,
      revisados: 1,
      creadas: [{ tripId: 'viaje-1', certificadoId: 'cert-nuevo' }],
      enlazadas: [],
      sinCambios: 0,
      omitidas: [],
    });
    expect(registrarPrimeraVersion).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'viaje-1',
      sha256: EMITIDO.sha256,
      pdfUrl: EMITIDO.pdfUrl,
      kmsVersion: '1',
      emitidoEn: EMITIDO.emitidoEn,
      fuenteDistancia: 'routes_estimada',
      motivoFallback: null,
      decisionVersion: 2,
    });
    expect(updates).toEqual([{ certificadoVigenteId: 'cert-nuevo' }]);
  });

  it('omite un certificado sin huella del PDF', async () => {
    const { db, updates } = baseFalsa([[{ ...EMITIDO, sha256: null }], VERIFICACION_LIMPIA]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.omitidas).toEqual([
      { tripId: 'viaje-1', motivo: 'certificado emitido sin huella del PDF' },
    ]);
    expect(updates).toEqual([]);
  });

  it('omite un viaje con versiones pero sin ninguna vigente', async () => {
    const { db } = baseFalsa([
      [EMITIDO],
      [{ id: 'v1', estado: 'revertido', sha256: EMITIDO.sha256 }],
      VERIFICACION_LIMPIA,
    ]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.omitidas[0]?.motivo).toBe('tiene versiones pero ninguna vigente');
  });

  it('omite una versión vigente que no coincide con las métricas', async () => {
    const { db, updates } = baseFalsa([
      [EMITIDO],
      [{ id: 'v1', estado: 'vigente', sha256: 'b'.repeat(64) }],
      VERIFICACION_LIMPIA,
    ]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.omitidas[0]?.motivo).toMatch(/no coincide/);
    expect(updates).toEqual([]);
  });

  it('enlaza una versión vigente que coincide y no estaba apuntada', async () => {
    const { db, updates } = baseFalsa([
      [EMITIDO],
      [{ id: 'v1', estado: 'vigente', sha256: EMITIDO.sha256 }],
      VERIFICACION_LIMPIA,
    ]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.enlazadas).toEqual([{ tripId: 'viaje-1', certificadoId: 'v1' }]);
    expect(updates[0]).toMatchObject({ certificadoVigenteId: 'v1' });
  });

  it('no toca un certificado que ya apunta a su versión vigente', async () => {
    const { db, updates } = baseFalsa([
      [{ ...EMITIDO, vigenteId: 'v1' }],
      [{ id: 'v1', estado: 'vigente', sha256: EMITIDO.sha256 }],
      VERIFICACION_LIMPIA,
    ]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.sinCambios).toBe(1);
    expect(updates).toEqual([]);
  });

  it('falla sin escribir si la verificación encuentra un certificado sin versión', async () => {
    const { db } = baseFalsa([[], [{ tripId: 'otro-viaje' }]]);
    await expect(rellenarVersionesCertificado(db, { dryRun: false })).rejects.toBeInstanceOf(
      VerificacionVersionesError,
    );
  });

  it('la verificación no cuenta los omitidos', async () => {
    const { db } = baseFalsa([[{ ...EMITIDO, sha256: null }], [{ tripId: 'viaje-1' }]]);
    const r = await rellenarVersionesCertificado(db, { dryRun: false });
    expect(r.omitidas).toHaveLength(1);
  });

  it('en seco devuelve el resultado y deshace la transacción', async () => {
    const { db } = baseFalsa([[EMITIDO], [], VERIFICACION_LIMPIA]);
    const r = await rellenarVersionesCertificado(db, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, creadas: [{ tripId: 'viaje-1' }] });
    const transaccion = (db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction;
    await expect(transaccion.mock.results[0]?.value).rejects.toThrow();
  });
});
