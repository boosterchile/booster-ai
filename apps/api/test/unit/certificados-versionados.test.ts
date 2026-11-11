import { describe, expect, it, vi } from 'vitest';
import { certificadosViaje } from '../../src/db/schema.js';
import { registrarPrimeraVersion } from '../../src/services/certificados-versionados.js';

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
