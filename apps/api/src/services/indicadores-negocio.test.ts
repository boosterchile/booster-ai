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
    for (const paso of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
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

const CERO = { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 };

/** Una fila agrupada por nivel, fuente y cobertura, como la devuelve Postgres. */
function grupo(
  certificationLevel: string | null,
  routeDataSource: string | null,
  coveragePct: string | null,
  certificados: string,
  kgco2e: string | null,
  ahorro: string | null = null,
) {
  return { certificationLevel, routeDataSource, coveragePct, certificados, kgco2e, ahorro };
}

describe('resumenCertificados', () => {
  it('separa por presentación de ADR-091 y suma el total', async () => {
    const { db } = dbCon([
      [
        grupo('primario_verificable', 'teltonika_gps', '98.00', '2', '400.250', '20.25'),
        grupo('secundario_modeled', 'teltonika_gps', '91.00', '1', '300.000'),
        grupo('secundario_modeled', 'maps_directions', '0', '1', '500.000', '60'),
        grupo('secundario_modeled', 'teltonika_gps', '40.00', '1', '54.250'),
      ],
    ]);
    expect(await resumenCertificados({ db, empresaId: EMPRESA })).toEqual({
      certificados: 5,
      medidos: 2,
      estimados: 3,
      kgco2e: 1254.5,
      ahorro_kgco2e: 80.25,
      por_presentacion: {
        primario: { certificados: 2, kgco2e: 400.25, ahorro_kgco2e: 20.25 },
        medido_teltonika: { certificados: 1, kgco2e: 300, ahorro_kgco2e: 0 },
        estimado: { certificados: 2, kgco2e: 554.25, ahorro_kgco2e: 60 },
      },
    });
  });

  it('sin certificados todo es cero', async () => {
    const { db } = dbCon([[]]);
    expect(await resumenCertificados({ db })).toEqual({
      certificados: 0,
      medidos: 0,
      estimados: 0,
      kgco2e: 0,
      ahorro_kgco2e: 0,
      por_presentacion: { primario: CERO, medido_teltonika: CERO, estimado: CERO },
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
      [grupo('secundario_default', null, null, '2', '300.000')],
    ]);
    const indicadores = await indicadoresNegocio({ db, empresaId: EMPRESA, ahora: AHORA });
    expect(indicadores).toEqual({
      empresas_activas: null,
      cargas: 7,
      camiones: 1,
      camiones_con_huella_medida: 0,
      certificados: {
        certificados: 2,
        medidos: 0,
        estimados: 2,
        kgco2e: 300,
        ahorro_kgco2e: 0,
        por_presentacion: {
          primario: CERO,
          medido_teltonika: CERO,
          estimado: { certificados: 2, kgco2e: 300, ahorro_kgco2e: 0 },
        },
      },
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
      [
        grupo('primario_verificable', 'teltonika_gps', '99', '1', '1000', '10'),
        grupo('secundario_default', null, null, '8', '4000'),
      ],
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
