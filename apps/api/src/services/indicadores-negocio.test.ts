import { describe, expect, it, vi } from 'vitest';
import { indicadoresNegocio } from './indicadores-negocio.js';
import { resumenCertificados } from './resumen-certificados.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const OTRA = '33333333-3333-4333-8333-333333333333';
const VEHICULO = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-11-25T15:00:00.000Z');

/** Cada `select` resuelve con el siguiente arreglo de la cola, termine donde termine la cadena. */
function dbCon(selects: unknown[][]) {
  const cola = [...selects];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const paso of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      chain[paso] = vi.fn(() => chain);
    }
    chain.then = (resolver: (filas: unknown[]) => unknown) =>
      Promise.resolve(cola.shift() ?? []).then(resolver);
    return chain;
  });
  return { db: { select } as never, select, restantes: () => cola.length };
}

/** Las cinco lecturas de `leerEntradaDocumental` para una empresa con un camión sin documentos. */
const documentalConTresFaltantes = [
  [{ timezone: 'America/Santiago' }],
  [{ id: VEHICULO, patente: 'AB1234', estado: 'activo', teltonikaImei: null }],
  [],
  [],
  [],
];

describe('resumenCertificados', () => {
  it('cuenta medidos y estimados y suma la huella', async () => {
    const { db } = dbCon([
      [{ certificados: '5', medidos: '2', kgco2e: '1254.500', ahorro: '80.25' }],
    ]);
    expect(await resumenCertificados({ db, empresaId: EMPRESA })).toEqual({
      certificados: 5,
      medidos: 2,
      estimados: 3,
      kgco2e: 1254.5,
      ahorro_kgco2e: 80.25,
    });
  });

  it('sin certificados todo es cero', async () => {
    const { db } = dbCon([[{ certificados: '0', medidos: '0', kgco2e: null, ahorro: null }]]);
    expect(await resumenCertificados({ db })).toEqual({
      certificados: 0,
      medidos: 0,
      estimados: 0,
      kgco2e: 0,
      ahorro_kgco2e: 0,
    });
  });
});

describe('indicadoresNegocio', () => {
  it('de una empresa: no cuenta empresas y usa el cálculo único de documentos', async () => {
    const { db, restantes } = dbCon([
      [{ id: EMPRESA }],
      [{ n: '7' }], // cargas
      [{ n: '1' }], // camiones
      [{ n: '0' }], // camiones con huella medida
      ...documentalConTresFaltantes,
      [{ certificados: '2', medidos: '0', kgco2e: '300.000', ahorro: null }],
    ]);
    const indicadores = await indicadoresNegocio({ db, empresaId: EMPRESA, ahora: AHORA });
    expect(indicadores).toEqual({
      empresas_activas: null,
      cargas: 7,
      camiones: 1,
      camiones_con_huella_medida: 0,
      certificados: { certificados: 2, medidos: 0, estimados: 2, kgco2e: 300, ahorro_kgco2e: 0 },
      // Revisión técnica, permiso de circulación y SOAP sin subir.
      documentos_pendientes: 3,
    });
    expect(restantes()).toBe(0);
  });

  it('de la plataforma: suma los documentos de cada transportista activa', async () => {
    const { db, restantes } = dbCon([
      [{ id: EMPRESA }, { id: OTRA }],
      [{ n: '4' }], // empresas activas
      [{ n: '20' }], // cargas
      [{ n: '2' }], // camiones
      [{ n: '1' }], // camiones con huella medida
      ...documentalConTresFaltantes,
      ...documentalConTresFaltantes,
      [{ certificados: '9', medidos: '1', kgco2e: '5000', ahorro: '10' }],
    ]);
    const indicadores = await indicadoresNegocio({ db, ahora: AHORA });
    expect(indicadores.empresas_activas).toBe(4);
    expect(indicadores.cargas).toBe(20);
    expect(indicadores.camiones).toBe(2);
    expect(indicadores.camiones_con_huella_medida).toBe(1);
    expect(indicadores.documentos_pendientes).toBe(6);
    expect(indicadores.certificados.estimados).toBe(8);
    expect(restantes()).toBe(0);
  });
});
