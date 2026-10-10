import { describe, expect, it, vi } from 'vitest';
import {
  type ProveedorUf,
  ValorUfNoDisponibleError,
  crearProveedorCmf,
  crearProveedorSii,
  fechaChile,
  obtenerValorUf,
  parsearNumeroChileno,
  parsearRespuestaCmf,
  parsearTablaUfSii,
  proveedoresUfPorDefecto,
} from './valor-uf.js';

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

/**
 * Fragmento con la forma de https://www.sii.cl/valores_y_fechas/uf/uf2026.htm
 * (tabla `table_export`: una fila por día, una columna por mes). Los valores
 * futuros vienen vacíos.
 */
const HTML_SII = `
<html><body>
<div id="mes_all">
<table class="table table-hover table-bordered" id="table_export">
  <thead><tr><th>Día</th><th>Ene</th><th>Feb</th><th>Mar</th><th>Abr</th><th>May</th><th>Jun</th>
  <th>Jul</th><th>Ago</th><th>Sep</th><th>Oct</th><th>Nov</th><th>Dic</th></tr></thead>
  <tbody>
    <tr><th style='text-align:center;'>1</th><td style='text-align:right;'>39.100,10</td><td>39.150,20</td>
      <td>39.200,30</td><td>39.250,40</td><td>39.300,50</td><td>39.350,60</td><td>39.400,70</td>
      <td>39.450,80</td><td>39.460,90</td><td>39.470,11</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    <tr><th style='text-align:center;'>8</th><td>39.110,10</td><td>39.160,20</td><td>39.210,30</td>
      <td>39.260,40</td><td>39.310,50</td><td>39.360,60</td><td>39.410,70</td><td>39.455,80</td>
      <td>39.465,90</td><td>39.485,65</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  </tbody>
</table></div></body></html>`;

describe('parsers', () => {
  it('número chileno: punto de miles y coma decimal', () => {
    expect(parsearNumeroChileno('39.485,65')).toBe(39_485.65);
    expect(parsearNumeroChileno(' 1.234.567,8 ')).toBe(1_234_567.8);
    expect(() => parsearNumeroChileno('')).toThrow();
    expect(() => parsearNumeroChileno('abc')).toThrow();
  });

  it('CMF: toma el valor de la fecha pedida', () => {
    const json = { UFs: [{ Valor: '39.485,65', Fecha: '2026-10-08' }] };
    expect(parsearRespuestaCmf(json, '2026-10-08')).toBe(39_485.65);
  });

  it('CMF: respuesta sin la fecha, con error o fuera de contrato → lanza', () => {
    expect(() =>
      parsearRespuestaCmf({ UFs: [{ Valor: '39.485,65', Fecha: '2026-10-07' }] }, '2026-10-08'),
    ).toThrow(/2026-10-08/);
    expect(() =>
      parsearRespuestaCmf({ CodigoHTTP: 404, Mensaje: 'No existe información' }, '2026-10-08'),
    ).toThrow();
  });

  it('SII: día × mes de la tabla', () => {
    expect(parsearTablaUfSii(HTML_SII, '2026-10-08')).toBe(39_485.65);
    expect(parsearTablaUfSii(HTML_SII, '2026-01-01')).toBe(39_100.1);
  });

  it('SII: celda vacía, día ausente o tabla ausente → lanza', () => {
    expect(() => parsearTablaUfSii(HTML_SII, '2026-11-08')).toThrow();
    expect(() => parsearTablaUfSii(HTML_SII, '2026-10-15')).toThrow();
    expect(() => parsearTablaUfSii('<html></html>', '2026-10-08')).toThrow(/table_export/);
  });

  it('valor fuera del rango plausible → lanza (falla cerrado ante un cambio de formato)', () => {
    expect(() =>
      parsearRespuestaCmf({ UFs: [{ Valor: '394,85', Fecha: '2026-10-08' }] }, '2026-10-08'),
    ).toThrow(/rango/);
  });

  it('fechaChile usa la zona America/Santiago', () => {
    // 2026-10-09 02:00 UTC = 2026-10-08 23:00 en Chile (UTC-3, horario de verano).
    expect(fechaChile(Date.UTC(2026, 9, 9, 2))).toBe('2026-10-08');
  });
});

function respuesta(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe('proveedores HTTP', () => {
  it('CMF arma la URL de la API v3 con la clave y la fecha', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      respuesta(JSON.stringify({ UFs: [{ Valor: '39.485,65', Fecha: '2026-10-08' }] })),
    );
    const cmf = crearProveedorCmf({ apiKey: 'clave-cmf', fetchFn });
    expect(await cmf.obtener('2026-10-08')).toBe(39_485.65);
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.cmfchile.cl/api-sbifv3/recursos_api/uf/2026/10/dias/08',
    );
    expect(url.searchParams.get('apikey')).toBe('clave-cmf');
    expect(url.searchParams.get('formato')).toBe('json');
  });

  it('SII pide la página del año', async () => {
    const fetchFn = vi.fn(async (_url: string) => respuesta(HTML_SII));
    const sii = crearProveedorSii({ fetchFn });
    expect(await sii.obtener('2026-10-08')).toBe(39_485.65);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://www.sii.cl/valores_y_fechas/uf/uf2026.htm');
  });

  it('HTTP no-2xx → lanza sin exponer la clave', async () => {
    const cmf = crearProveedorCmf({
      apiKey: 'clave-secreta',
      fetchFn: async () => respuesta('{}', 401),
    });
    const err = await cmf.obtener('2026-10-08').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/401/);
    expect(String((err as Error).message)).not.toContain('clave-secreta');
  });
});

/** Db falsa: un SELECT (caché) y un INSERT … ON CONFLICT DO NOTHING. */
function makeDb(cacheada: { valorClp: string; fuente: string } | null) {
  const insertados: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => (cacheada ? [cacheada] : []) }) }),
    })),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertados.push(v);
        return { onConflictDoNothing: async () => undefined };
      },
    })),
  };
  return { db: db as never, insertados, raw: db };
}

function proveedor(fuente: 'cmf' | 'sii', impl: () => Promise<number>): ProveedorUf {
  return { fuente, obtener: vi.fn(impl) };
}

describe('obtenerValorUf', () => {
  it('valor ya guardado → no llama a las fuentes', async () => {
    const { db } = makeDb({ valorClp: '39485.65', fuente: 'cmf' });
    const cmf = proveedor('cmf', async () => 1);
    const r = await obtenerValorUf({ db, logger, fecha: '2026-10-08', proveedores: [cmf] });
    expect(r).toEqual({
      fecha: '2026-10-08',
      valorClp: 39_485.65,
      fuente: 'cmf',
      desdeCache: true,
    });
    expect(cmf.obtener).not.toHaveBeenCalled();
  });

  it('CMF responde → guarda con fuente cmf', async () => {
    const { db, insertados } = makeDb(null);
    const r = await obtenerValorUf({
      db,
      logger,
      fecha: '2026-10-08',
      proveedores: [proveedor('cmf', async () => 39_485.65), proveedor('sii', async () => 1)],
    });
    expect(r).toMatchObject({ valorClp: 39_485.65, fuente: 'cmf', desdeCache: false });
    expect(insertados).toEqual([{ fecha: '2026-10-08', valorClp: '39485.65', fuente: 'cmf' }]);
  });

  it('CMF falla → respaldo SII', async () => {
    const { db, insertados } = makeDb(null);
    const r = await obtenerValorUf({
      db,
      logger,
      fecha: '2026-10-08',
      proveedores: [
        proveedor('cmf', async () => {
          throw new Error('timeout');
        }),
        proveedor('sii', async () => 39_485.65),
      ],
    });
    expect(r.fuente).toBe('sii');
    expect(insertados).toHaveLength(1);
  });

  it('todas las fuentes fallan → ValorUfNoDisponibleError, sin guardar', async () => {
    const { db, insertados } = makeDb(null);
    const falla = async (): Promise<number> => {
      throw new Error('caída');
    };
    await expect(
      obtenerValorUf({
        db,
        logger,
        fecha: '2026-10-08',
        proveedores: [proveedor('cmf', falla), proveedor('sii', falla)],
      }),
    ).rejects.toBeInstanceOf(ValorUfNoDisponibleError);
    expect(insertados).toHaveLength(0);
  });
});

describe('valor UF — bordes', () => {
  it('proveedores por defecto: CMF + SII con clave, solo SII sin clave', () => {
    expect(proveedoresUfPorDefecto('clave').map((p) => p.fuente)).toEqual(['cmf', 'sii']);
    expect(proveedoresUfPorDefecto(undefined).map((p) => p.fuente)).toEqual(['sii']);
  });

  it('caché con fuente sii se devuelve como sii', async () => {
    const { db } = makeDb({ valorClp: '39485.65', fuente: 'sii' });
    const r = await obtenerValorUf({ db, logger, fecha: '2026-10-08', proveedores: [] });
    expect(r.fuente).toBe('sii');
  });

  it('un throw que no es Error también se registra como causa', async () => {
    const { db } = makeDb(null);
    const err = await obtenerValorUf({
      db,
      logger,
      fecha: '2026-10-08',
      proveedores: [
        // Una dependencia que rechaza con algo que no es Error.
        proveedor('cmf', () => Promise.reject('texto')),
      ],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValorUfNoDisponibleError);
    expect((err as ValorUfNoDisponibleError).causas).toEqual(['cmf: texto']);
  });

  it('fecha mal formada → lanza antes de consultar', async () => {
    const { db, raw } = makeDb(null);
    await expect(
      obtenerValorUf({ db, logger, fecha: '08-10-2026', proveedores: [] }),
    ).rejects.toThrow();
    expect(raw.select).not.toHaveBeenCalled();
  });
});
