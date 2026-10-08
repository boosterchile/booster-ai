import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { valoresUf } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';

/**
 * ADR-079 §4 — valor de la UF del día para facturar suscripciones.
 *
 * Fuente primaria: API v3 de la CMF (requiere `CMF_API_KEY`). Respaldo: la
 * tabla anual publicada por el SII. Decisión del PO del 2026-10-08. Cada
 * valor obtenido se guarda en `valores_uf` con su fuente; la factura además
 * captura su propio `uf_valor_clp`.
 *
 * Los parsers fallan cerrado: un valor fuera de `RANGO_UF_CLP` (por ejemplo,
 * por un cambio de formato que corra la coma) se rechaza en vez de facturar
 * con él.
 */

export type FuenteUf = 'cmf' | 'sii';

export interface ProveedorUf {
  fuente: FuenteUf;
  /** Valor en CLP de la UF para `fecha` (YYYY-MM-DD). Lanza si no está. */
  obtener(fecha: string): Promise<number>;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Cota de plausibilidad: la UF vale ~39.500 CLP en 2026. */
export const RANGO_UF_CLP = { min: 20_000, max: 100_000 } as const;

const TIMEOUT_MS_DEFAULT = 5_000;
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export class ValorUfNoDisponibleError extends Error {
  constructor(
    public readonly fecha: string,
    public readonly causas: string[],
  ) {
    super(`Valor UF no disponible para ${fecha}: ${causas.join(' | ')}`);
    this.name = 'ValorUfNoDisponibleError';
  }
}

/** "39.485,65" → 39485.65 (punto de miles, coma decimal). */
export function parsearNumeroChileno(texto: string): number {
  const limpio = texto.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(limpio)) {
    throw new Error(`número chileno inválido: "${limpio}"`);
  }
  return Number(limpio.replaceAll('.', '').replace(',', '.'));
}

function enRango(valor: number, fuente: FuenteUf): number {
  if (!(valor >= RANGO_UF_CLP.min && valor <= RANGO_UF_CLP.max)) {
    throw new Error(`valor UF ${fuente} fuera de rango plausible: ${valor}`);
  }
  return valor;
}

const respuestaCmfSchema = z.object({
  UFs: z.array(z.object({ Valor: z.string(), Fecha: z.string() })),
});

export function parsearRespuestaCmf(json: unknown, fecha: string): number {
  const parsed = respuestaCmfSchema.parse(json);
  const fila = parsed.UFs.find((u) => u.Fecha === fecha);
  if (!fila) {
    throw new Error(`CMF no trae la UF de ${fecha}`);
  }
  return enRango(parsearNumeroChileno(fila.Valor), 'cmf');
}

function textoCelda(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .trim();
}

/**
 * Tabla `table_export` de https://www.sii.cl/valores_y_fechas/uf/ufAAAA.htm:
 * una fila por día (la primera celda es el día) y una columna por mes.
 */
export function parsearTablaUfSii(html: string, fecha: string): number {
  const [, mes, dia] = fechaSchema.parse(fecha).split('-').map(Number) as [number, number, number];
  const tabla = /<table[^>]*id=["']table_export["'][^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tabla?.[1]) {
    throw new Error('SII: no se encontró la tabla table_export');
  }
  for (const fila of tabla[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...(fila[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      textoCelda(c[1] ?? ''),
    );
    if (celdas[0] !== String(dia)) {
      continue;
    }
    const valor = celdas[mes];
    if (!valor) {
      throw new Error(`SII: sin valor para ${fecha}`);
    }
    return enRango(parsearNumeroChileno(valor), 'sii');
  }
  throw new Error(`SII: no hay fila para el día ${dia}`);
}

async function pedir(fetchFn: FetchFn, url: string, fuente: FuenteUf, timeoutMs: number) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    // Sin la URL: en la CMF lleva la API key.
    throw new Error(`${fuente} respondió HTTP ${res.status}`);
  }
  return res;
}

export function crearProveedorCmf(opts: {
  apiKey: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): ProveedorUf {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    fuente: 'cmf',
    async obtener(fecha) {
      const [anio, mes, dia] = fechaSchema.parse(fecha).split('-');
      const url = new URL(
        `https://api.cmfchile.cl/api-sbifv3/recursos_api/uf/${anio}/${mes}/dias/${dia}`,
      );
      url.searchParams.set('apikey', opts.apiKey);
      url.searchParams.set('formato', 'json');
      const res = await pedir(fetchFn, url.toString(), 'cmf', opts.timeoutMs ?? TIMEOUT_MS_DEFAULT);
      return parsearRespuestaCmf(await res.json(), fecha);
    },
  };
}

export function crearProveedorSii(
  opts: { fetchFn?: FetchFn; timeoutMs?: number } = {},
): ProveedorUf {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    fuente: 'sii',
    async obtener(fecha) {
      const anio = fechaSchema.parse(fecha).slice(0, 4);
      const url = `https://www.sii.cl/valores_y_fechas/uf/uf${anio}.htm`;
      const res = await pedir(fetchFn, url, 'sii', opts.timeoutMs ?? TIMEOUT_MS_DEFAULT);
      return parsearTablaUfSii(await res.text(), fecha);
    },
  };
}

/** Proveedores en orden: CMF si hay clave, luego SII. */
export function proveedoresUfPorDefecto(cmfApiKey: string | undefined): ProveedorUf[] {
  return cmfApiKey
    ? [crearProveedorCmf({ apiKey: cmfApiKey }), crearProveedorSii()]
    : [crearProveedorSii()];
}

/** Fecha calendario en Chile (America/Santiago) como YYYY-MM-DD. */
export function fechaChile(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export interface ValorUfDelDia {
  fecha: string;
  valorClp: number;
  fuente: FuenteUf;
  desdeCache: boolean;
}

export async function obtenerValorUf(opts: {
  db: Db;
  logger: Logger;
  fecha: string;
  proveedores: ProveedorUf[];
}): Promise<ValorUfDelDia> {
  const fecha = fechaSchema.parse(opts.fecha);
  // rls-allowlist: valores UF globales de plataforma (sin empresa_id).
  const guardado = await opts.db
    .select({ valorClp: valoresUf.valorClp, fuente: valoresUf.fuente })
    .from(valoresUf)
    .where(eq(valoresUf.fecha, fecha))
    .limit(1);
  const fila = guardado[0];
  if (fila) {
    return {
      fecha,
      valorClp: Number(fila.valorClp),
      fuente: fila.fuente === 'sii' ? 'sii' : 'cmf',
      desdeCache: true,
    };
  }

  const causas: string[] = [];
  for (const proveedor of opts.proveedores) {
    try {
      const valorClp = await proveedor.obtener(fecha);
      // rls-allowlist: valores UF globales de plataforma (sin empresa_id).
      await opts.db
        .insert(valoresUf)
        .values({ fecha, valorClp: valorClp.toFixed(2), fuente: proveedor.fuente })
        .onConflictDoNothing();
      getBusinessCounter('pricing.valor_uf_obtenido').add(1, { fuente: proveedor.fuente });
      opts.logger.info({ fecha, valorClp, fuente: proveedor.fuente }, 'valor UF obtenido');
      return { fecha, valorClp, fuente: proveedor.fuente, desdeCache: false };
    } catch (err) {
      const causa = err instanceof Error ? err.message : String(err);
      causas.push(`${proveedor.fuente}: ${causa}`);
      getBusinessCounter('pricing.valor_uf_fallo').add(1, { fuente: proveedor.fuente });
      opts.logger.warn({ fecha, fuente: proveedor.fuente, err: causa }, 'fuente UF falló');
    }
  }
  throw new ValorUfNoDisponibleError(fecha, causas);
}
