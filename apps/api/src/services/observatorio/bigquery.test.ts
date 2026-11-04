import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  type ClienteBigQuery,
  SECCIONES_OBSERVATORIO,
  clienteDesdeBigQuery,
  crearCargadorBigQuery,
  crearLectorObservatorio,
  exportarObservatorio,
} from './bigquery.js';
import type { ViajeEntregado } from './proyeccion.js';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const VIAJE: ViajeEntregado = {
  viajeId: '00000000-0000-4000-8000-000000000001',
  vehiculoId: '00000000-0000-4000-8000-000000000002',
  origenRegion: 'IV',
  origenComuna: null,
  destinoRegion: 'IV',
  destinoComuna: null,
  recogidoEn: new Date('2026-10-07T13:30:00Z'),
  entregadoEn: new Date('2026-10-07T16:00:00Z'),
  tipoVehiculo: 'camion_pesado',
  distanciaKm: '42.50',
  kgco2eReales: '35.120',
  kgco2eEstimadas: null,
  kgco2eEvitado: null,
};

/** Cliente BigQuery falso: captura lo escrito al stream y las consultas. */
function clienteFalso(filasConsulta: Record<string, unknown[]> = {}) {
  const escrito: string[] = [];
  const opcionesStream: unknown[] = [];
  const consultas: Array<{ query: string; params: unknown }> = [];
  const jobPromise = vi.fn(async () => undefined);
  const cliente: ClienteBigQuery = {
    dataset: (datasetId: string) => ({
      table: (tableId: string) => ({
        createWriteStream: (opts: unknown) => {
          opcionesStream.push({ datasetId, tableId, opts });
          const stream = new PassThrough();
          stream.on('data', (c: Buffer) => escrito.push(c.toString()));
          stream.on('finish', () => {
            stream.emit('job', { promise: jobPromise });
          });
          return stream;
        },
      }),
    }),
    query: async (opts: { query: string; params: Record<string, unknown> }) => {
      consultas.push({ query: opts.query, params: opts.params });
      const vista = /urban_flow_metrics_(\w+)/.exec(opts.query)?.[1] ?? '';
      return [filasConsulta[vista] ?? []];
    },
  };
  return { cliente, escrito, opcionesStream, consultas, jobPromise };
}

describe('crearCargadorBigQuery', () => {
  it('reemplaza la tabla con un load job WRITE_TRUNCATE en NDJSON', async () => {
    const f = clienteFalso();
    const cargador = crearCargadorBigQuery(f.cliente);
    await cargador.reemplazarTabla({
      datasetId: 'observatory',
      tableId: 'viajes',
      filas: [{ a: 1 }, { a: 2 }],
    });
    expect(f.opcionesStream).toEqual([
      {
        datasetId: 'observatory',
        tableId: 'viajes',
        opts: { sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE' },
      },
    ]);
    expect(f.escrito.join('')).toBe('{"a":1}\n{"a":2}\n');
    expect(f.jobPromise).toHaveBeenCalledTimes(1);
  });

  it('un error del stream se propaga', async () => {
    const cliente: ClienteBigQuery = {
      dataset: () => ({
        table: () => ({
          createWriteStream: () => {
            const s = new PassThrough();
            setImmediate(() => s.emit('error', new Error('bq caído')));
            return s;
          },
        }),
      }),
      query: async () => [[]],
    };
    await expect(
      crearCargadorBigQuery(cliente).reemplazarTabla({
        datasetId: 'observatory',
        tableId: 'viajes',
        filas: [{ a: 1 }],
      }),
    ).rejects.toThrow('bq caído');
  });
});

describe('exportarObservatorio', () => {
  it('proyecta los viajes entregados y reemplaza observatory.viajes', async () => {
    const f = clienteFalso();
    const r = await exportarObservatorio({
      logger,
      datasetId: 'observatory',
      leerViajes: async () => [VIAJE],
      cargador: crearCargadorBigQuery(f.cliente),
    });
    expect(r).toEqual({ filas: 1 });
    const fila = JSON.parse(f.escrito.join('').trim()) as Record<string, unknown>;
    expect(fila).toMatchObject({ viaje_id: VIAJE.viajeId, franja: '09-12', kgco2e: 35.12 });
  });

  it('sin viajes igual reemplaza la tabla (vacía)', async () => {
    const f = clienteFalso();
    const r = await exportarObservatorio({
      logger,
      datasetId: 'observatory',
      leerViajes: async () => [],
      cargador: crearCargadorBigQuery(f.cliente),
    });
    expect(r).toEqual({ filas: 0 });
    expect(f.opcionesStream).toHaveLength(1);
  });
});

describe('crearLectorObservatorio', () => {
  const filas = {
    franjas: [
      { mes: '2026-10', franja: '09-12', vehiculos: 12, viajes: 40 },
      { mes: '2026-10', franja: '06-09', vehiculos: 4, viajes: 9 },
    ],
    emisiones: [{ mes: '2026-10', kgco2e: 1200.5, vehiculos: 11, viajes: 30 }],
    od: [{ mes: '2026-10', vehiculos: 10, viajes: 22, vehiculo_id: 'x' }],
    activos: [{ mes: '2026-10', vehiculos: 15 }],
  };

  it('consulta las cuatro vistas con la región como parámetro y aplica k ≥ 10', async () => {
    const f = clienteFalso(filas);
    const lector = crearLectorObservatorio({ cliente: f.cliente, datasetId: 'observatory' });
    const r = await lector.porRegion('IV');
    expect(SECCIONES_OBSERVATORIO).toEqual(['franjas', 'emisiones', 'od', 'activos']);
    expect(f.consultas).toHaveLength(4);
    for (const c of f.consultas) {
      expect(c.params).toEqual({ region: 'IV' });
      expect(c.query).toMatch(/`observatory\.urban_flow_metrics_\w+`/);
    }
    expect(r.franjas).toEqual([{ mes: '2026-10', franja: '09-12', vehiculos: 12, viajes: 40 }]);
    expect(r.od).toEqual([{ mes: '2026-10', vehiculos: 10, viajes: 22 }]);
    expect(r.k_min_vehiculos).toBe(10);
  });

  it('una vista que no devuelve filas queda como lista vacía', async () => {
    const cliente: ClienteBigQuery = {
      dataset: () => ({ table: () => ({ createWriteStream: () => new PassThrough() }) }),
      query: async () => [],
    };
    const r = await crearLectorObservatorio({ cliente, datasetId: 'observatory' }).porRegion('IV');
    expect(r.franjas).toEqual([]);
    expect(r.activos).toEqual([]);
  });

  it('cachea por región durante el TTL', async () => {
    const f = clienteFalso(filas);
    let ahora = 0;
    const lector = crearLectorObservatorio({
      cliente: f.cliente,
      datasetId: 'observatory',
      ttlMs: 1000,
      ahora: () => ahora,
    });
    await lector.porRegion('IV');
    await lector.porRegion('IV');
    expect(f.consultas).toHaveLength(4);
    await lector.porRegion('V');
    expect(f.consultas).toHaveLength(8);
    ahora = 1001;
    await lector.porRegion('IV');
    expect(f.consultas).toHaveLength(12);
  });

  it('una región con caracteres fuera de [A-Z] se rechaza antes de consultar', async () => {
    const f = clienteFalso(filas);
    const lector = crearLectorObservatorio({ cliente: f.cliente, datasetId: 'observatory' });
    await expect(lector.porRegion("IV'; DROP")).rejects.toThrow(/región inválida/);
    expect(f.consultas).toHaveLength(0);
  });
});

describe('clienteDesdeBigQuery', () => {
  it('delega en dataset().table().createWriteStream() y query() de la librería', async () => {
    const stream = new PassThrough();
    const createWriteStream = vi.fn(() => stream);
    const table = vi.fn(() => ({ createWriteStream }));
    const dataset = vi.fn(() => ({ table }));
    const query = vi.fn(async () => [[{ a: 1 }]]);
    const cliente = clienteDesdeBigQuery({ dataset, query } as never);
    const opts = {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      writeDisposition: 'WRITE_TRUNCATE',
    } as const;
    expect(cliente.dataset('observatory').table('viajes').createWriteStream(opts)).toBe(stream);
    expect(dataset).toHaveBeenCalledWith('observatory');
    expect(table).toHaveBeenCalledWith('viajes');
    expect(createWriteStream).toHaveBeenCalledWith(opts);
    expect(await cliente.query({ query: 'SELECT 1', params: { region: 'IV' } })).toEqual([
      [{ a: 1 }],
    ]);
    expect(query).toHaveBeenCalledWith({ query: 'SELECT 1', params: { region: 'IV' } });
  });
});
