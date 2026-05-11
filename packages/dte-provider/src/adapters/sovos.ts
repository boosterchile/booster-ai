import {
  DteNotConfiguredError,
  DteProviderRejectedError,
  DteTransientError,
  DteValidationError,
} from '../errors.js';
import type { DteEmitter } from '../interface.js';
import {
  type DteResult,
  type DteStatus,
  type DteStatusValue,
  type FacturaInput,
  type GuiaDespachoInput,
  facturaInputSchema,
  guiaDespachoInputSchema,
} from '../types.js';

/**
 * SovosAdapter — implementación contra Sovos/Paperless Chile (ADR-024 §1).
 *
 * **Estado actual (sprint X+1)**: skeleton funcional con:
 *   - Validación Zod del input (mismo schema que MockAdapter).
 *   - Construcción del payload Sovos según el contrato canónico del
 *     proveedor (best-effort sin sandbox UAT actual).
 *   - HTTP client con fetch + manejo de errores → clases canónicas
 *     del package (`errors.ts`).
 *   - Mapping bidireccional folio ↔ providerTrackId.
 *
 * **Pendiente (sprint X+2, requiere creds reales)**:
 *   - Sandbox UAT contra real Sovos → validar shape exacto del payload.
 *   - Carrier credential workflow (.pfx en Secret Manager).
 *   - mTLS para upload del cert (Sovos lo exige en algunos endpoints).
 *
 * **Cómo se activa**:
 *   1. Setear env `SOVOS_API_KEY` y `SOVOS_BASE_URL` en Cloud Run.
 *   2. Cambiar `DTE_PROVIDER=sovos` en el service que orquesta.
 *   3. El service hace `new SovosDteAdapter({ apiKey, baseUrl, ... })`.
 *
 * Sin las dos env vars, el adapter tira `DteNotConfiguredError` en
 * cada llamada — el caller debe skipear silenciosamente.
 */
export interface SovosAdapterOpts {
  /** API key del partner Sovos para la cuenta del marketplace Booster. */
  apiKey: string;
  /** Base URL del API Sovos (UAT vs prod cambia el host). */
  baseUrl: string;
  /**
   * Fetch implementation (inyectable para tests). Default `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Timeout HTTP por request, en ms. Sovos a veces tarda 3-5s
   * cuando SII responde lento. Default 15_000ms.
   */
  timeoutMs?: number;
}

export class SovosDteAdapter implements DteEmitter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: SovosAdapterOpts) {
    if (!opts.apiKey) {
      throw new DteNotConfiguredError('SovosDteAdapter: apiKey vacío');
    }
    if (!opts.baseUrl) {
      throw new DteNotConfiguredError('SovosDteAdapter: baseUrl vacío');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    const parsed = facturaInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        `factura input inválido: ${parsed.error.message}`,
        parsed.error.format(),
      );
    }
    const payload = mapFacturaToSovos(parsed.data);
    const sovosResp = await this.postSovos<SovosEmitResponse>('/dte/emit', payload);
    return mapSovosEmitToResult(sovosResp, 33, parsed.data.emisor.rut);
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    const parsed = guiaDespachoInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        `guia despacho input inválida: ${parsed.error.message}`,
        parsed.error.format(),
      );
    }
    const payload = mapGuiaToSovos(parsed.data);
    const sovosResp = await this.postSovos<SovosEmitResponse>('/dte/emit', payload);
    return mapSovosEmitToResult(sovosResp, 52, parsed.data.emisor.rut);
  }

  async queryStatus(folio: string, rutEmisor: string): Promise<DteStatus> {
    const path = `/dte/status?folio=${encodeURIComponent(folio)}&rut=${encodeURIComponent(rutEmisor)}`;
    const sovosResp = await this.getSovos<SovosStatusResponse>(path);
    return {
      folio,
      tipo: sovosResp.tipo_dte === 52 ? 52 : 33,
      rutEmisor,
      status: mapSovosStatus(sovosResp.estado_sii),
      ...(sovosResp.mensaje_sii ? { mensaje: sovosResp.mensaje_sii } : {}),
      ...(sovosResp.folio_anulacion ? { folioAnulacion: sovosResp.folio_anulacion } : {}),
    };
  }

  async voidDocument(folio: string, rutEmisor: string, reason: string): Promise<void> {
    await this.postSovos<SovosVoidResponse>('/dte/void', {
      folio,
      rut_emisor: rutEmisor,
      razon: reason,
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  private async postSovos<T>(path: string, body: unknown): Promise<T> {
    return this.requestSovos<T>('POST', path, body);
  }

  private async getSovos<T>(path: string): Promise<T> {
    return this.requestSovos<T>('GET', path);
  }

  private async requestSovos<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DteTransientError(`Sovos ${method} ${path} timeout (${this.timeoutMs}ms)`, err);
      }
      throw new DteTransientError(`Sovos ${method} ${path} network error`, err);
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 500) {
      throw new DteTransientError(`Sovos respondió ${res.status} para ${method} ${path}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DteProviderRejectedError(
        `Sovos ${method} ${path} respondió ${res.status}: ${text}`,
        String(res.status),
      );
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new DteTransientError(`Sovos ${method} ${path} body no es JSON válido`, err);
    }
  }
}

// =============================================================================
// Mapeo canónico ↔ Sovos
// =============================================================================
// Best-effort sin sandbox actual. Cuando lleguen las creds del partner
// y el contrato exacto, se ajustan estos mappers; el resto del package
// no cambia.

interface SovosEmitResponse {
  folio: string;
  tipo_dte: number;
  rut_emisor: string;
  emitido_en?: string;
  monto_total_clp: number;
  pdf_url?: string;
  track_id?: string;
}

interface SovosStatusResponse {
  folio: string;
  tipo_dte: number;
  estado_sii: string;
  mensaje_sii?: string;
  folio_anulacion?: string;
}

interface SovosVoidResponse {
  ok: boolean;
}

function mapFacturaToSovos(input: FacturaInput): Record<string, unknown> {
  return {
    tipo_dte: 33,
    emisor: input.emisor,
    receptor: input.receptor,
    fecha_emision: input.fechaEmision,
    items: input.items.map((i) => ({
      descripcion: i.descripcion,
      monto_neto_clp: i.montoNetoClp,
      exento: i.exento,
    })),
    ...(input.referencia
      ? {
          referencia: {
            tipo_doc_ref: input.referencia.tipoDoc,
            folio_ref: input.referencia.folio,
          },
        }
      : {}),
  };
}

function mapGuiaToSovos(input: GuiaDespachoInput): Record<string, unknown> {
  return {
    tipo_dte: 52,
    emisor: input.emisor,
    receptor: input.receptor,
    fecha_emision: input.fechaEmision,
    origen: input.origen,
    destino: input.destino,
    patente_vehiculo: input.patenteVehiculo,
    items: input.items.map((i) => ({
      descripcion: i.descripcion,
      monto_neto_clp: i.montoNetoClp,
      exento: i.exento,
    })),
  };
}

function mapSovosEmitToResult(
  resp: SovosEmitResponse,
  tipo: 33 | 52,
  rutEmisor: string,
): DteResult {
  const result: DteResult = {
    folio: resp.folio,
    tipo,
    rutEmisor: resp.rut_emisor ?? rutEmisor,
    emitidoEn: resp.emitido_en ?? new Date().toISOString(),
    montoTotalClp: resp.monto_total_clp,
  };
  if (resp.pdf_url) {
    result.pdfUrl = resp.pdf_url;
  }
  if (resp.track_id) {
    result.providerTrackId = resp.track_id;
  }
  return result;
}

function mapSovosStatus(sovosStatus: string): DteStatusValue {
  // Códigos SII canónicos vía Sovos (best-effort, ajustar con sandbox real).
  switch (sovosStatus.toUpperCase()) {
    case 'ACEPTADO':
    case 'ACEPTADO_OK':
      return 'aceptado';
    case 'ACEPTADO_CON_REPAROS':
    case 'REPARABLE':
      return 'reparable';
    case 'RECHAZADO':
      return 'rechazado';
    case 'ANULADO':
      return 'anulado';
    default:
      return 'en_proceso';
  }
}
