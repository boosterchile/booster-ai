import { describe, expect, it, vi } from 'vitest';
import { certificadosViaje, tripMetrics } from '../../src/db/schema.js';
import {
  VersionVigenteCambioError,
  crearVersion,
  crearVersionEnTx,
  registrarPrimeraVersion,
  siguienteVersion,
} from '../../src/services/certificados-versionados.js';

// El comportamiento contra PostgreSQL (restricciones, transacción) está en
// test/integration/certificado-version-1.integration.test.ts.

const NUEVA = {
  tripId: 'viaje-1',
  sha256: 'a'.repeat(64),
  pdfUrl: 'gs://b/c.pdf',
  kmsVersion: '1',
  emitidoEn: new Date('2026-11-11T12:00:00Z'),
  fuenteDistancia: null,
  motivoFallback: null,
  decisionVersion: null,
};

function txFalsa(filas: unknown[]) {
  const values = vi.fn(() => ({ returning: vi.fn(async () => filas) }));
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as never, insert, values };
}

describe('registrarPrimeraVersion', () => {
  it('inserta la versión 1 vigente con los datos de la emisión', async () => {
    const creada = { id: 'cert-1', ...NUEVA, version: 1, estado: 'vigente' };
    const { tx, insert, values } = txFalsa([creada]);

    expect(await registrarPrimeraVersion(tx, NUEVA)).toBe(creada);
    expect(insert).toHaveBeenCalledWith(certificadosViaje);
    expect(values).toHaveBeenCalledWith({ ...NUEVA, version: 1, estado: 'vigente' });
  });

  it('falla si la base no devuelve la fila', async () => {
    await expect(registrarPrimeraVersion(txFalsa([]).tx, NUEVA)).rejects.toThrow(
      /no devolvió fila/,
    );
  });
});

type Filas = Record<string, unknown>[];

/** SELECTs en orden: vigente (FOR UPDATE) y máxima versión. */
function txVersiones(vigente: Filas, maxima: Filas = [{ v: 1 }]) {
  const cola = [vigente, maxima];
  const escrituras: { op: string; tabla: unknown; valores: unknown }[] = [];
  const consulta = (filas: Filas) => {
    const c: Promise<Filas> & Record<string, () => unknown> = Object.assign(
      Promise.resolve(filas),
      {
        from: () => c,
        where: () => c,
        limit: () => c,
        for: () => c,
      },
    );
    return c;
  };
  const tx = {
    select: vi.fn(() => consulta(cola.shift() ?? [])),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'update', tabla, valores });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn((valores: unknown) => {
        escrituras.push({ op: 'insert', tabla, valores });
        return { returning: vi.fn(async () => [{ id: 'c2', version: 2, sha256: 'b' }]) };
      }),
    })),
  };
  return { tx: tx as never, escrituras, raw: tx };
}

const VIGENTE = { id: 'c1', version: 1, estado: 'vigente' };

describe('crearVersionEnTx', () => {
  it('reemplaza la vigente, crea la siguiente con su motivo y espeja las métricas', async () => {
    const { tx, escrituras } = txVersiones([VIGENTE]);
    const creada = await crearVersionEnTx(tx, NUEVA, 'factor_impreso_no_corresponde', 'c1');

    expect(creada).toMatchObject({ id: 'c2', version: 2 });
    expect(escrituras.map((e) => [e.op, e.tabla])).toEqual([
      ['update', certificadosViaje],
      ['insert', certificadosViaje],
      ['update', certificadosViaje],
      ['update', tripMetrics],
    ]);
    expect(escrituras[1]?.valores).toMatchObject({
      version: 2,
      estado: 'vigente',
      motivoReemision: 'factor_impreso_no_corresponde',
    });
  });

  it('sin versión vigente falla', async () => {
    const { tx } = txVersiones([]);
    await expect(crearVersionEnTx(tx, NUEVA, 'factor_impreso_no_corresponde')).rejects.toThrow(
      /no tiene versión vigente/,
    );
  });

  it('si la vigente no es la esperada, falla sin escribir', async () => {
    const { tx, escrituras } = txVersiones([VIGENTE]);
    await expect(
      crearVersionEnTx(tx, NUEVA, 'factor_impreso_no_corresponde', 'otra'),
    ).rejects.toBeInstanceOf(VersionVigenteCambioError);
    expect(escrituras).toEqual([]);
  });

  it('crearVersion abre su propia transacción', async () => {
    const { tx } = txVersiones([VIGENTE]);
    const db = { transaction: vi.fn(async (cb: (t: never) => Promise<unknown>) => cb(tx)) };
    await crearVersion(db as never, NUEVA, 'factor_impreso_no_corresponde');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('siguienteVersion', () => {
  const dbCon = (filas: Filas) => {
    const c: Promise<Filas> & Record<string, () => unknown> = Object.assign(
      Promise.resolve(filas),
      { from: () => c, where: () => c },
    );
    return { select: vi.fn(() => c) } as never;
  };

  it('es una más que la mayor registrada, aunque esa esté revertida', async () => {
    expect(await siguienteVersion(dbCon([{ v: 2 }]), 'viaje-1')).toBe(3);
  });

  it('sin versiones registradas es la 1', async () => {
    expect(await siguienteVersion(dbCon([{ v: null }]), 'viaje-1')).toBe(1);
    expect(await siguienteVersion(dbCon([]), 'viaje-1')).toBe(1);
  });
});
