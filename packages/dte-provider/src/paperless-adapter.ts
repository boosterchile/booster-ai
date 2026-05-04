/**
 * Adapter para Paperless (paperless.cl) — provider DTE acreditado SII
 * Chile seleccionado en ADR-015. Implementa `DteEmitter` traduciendo
 * los inputs canónicos del package a las llamadas REST del API
 * Paperless.
 *
 * Calibración pendiente: este adapter se construye con shape genérico
 * DTE-SII derivado de la docs pública de Paperless. La calibración
 * fina (nombres exactos de campos en payload, paths de endpoints,
 * shape de respuesta) se hace en Sprint 1.4 cuando esté la cuenta
 * sandbox abierta. Ver el método `mapInput*` para puntos de ajuste.
 *
 * Diseño:
 *   - Constructor recibe `apiKey`, `baseUrl`, `httpClient` (inyectable
 *     para tests). Default httpClient usa `fetch` global (Node 22+).
 *   - Errores HTTP 4xx → `DteValidationError` (rechazo legal).
 *   - Errores HTTP 5xx / network → `DteProviderError` (retry-safe).
 */

import type { DteEmitter } from './dte-emitter.js';
import {
  DteProviderError,
  type DteResult,
  type DteStatus,
  DteValidationError,
  type FacturaInput,
  type GuiaDespachoInput,
  facturaInputSchema,
  guiaDespachoInputSchema,
} from './tipos.js';

export interface HttpClient {
  request(opts: {
    method: 'GET' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string }>;
}

export interface PaperlessAdapterOptions {
  /** API key del cliente Paperless (Secret Manager). */
  apiKey: string;
  /**
   * Base URL. Sandbox: https://api.sandbox.paperless.cl/v1
   * Producción: https://api.paperless.cl/v1
   */
  baseUrl: string;
  /** HTTP client inyectable. Default = fetch nativo. */
  httpClient?: HttpClient;
  /** Timeout por request en ms. Default 30s. */
  timeoutMs?: number;
}

export class PaperlessAdapter implements DteEmitter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly http: HttpClient;
  private readonly timeoutMs: number;

  constructor(opts: PaperlessAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.http = opts.httpClient ?? defaultHttpClient();
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    guiaDespachoInputSchema.parse(input);
    const payload = this.mapInputGuiaDespacho(input);
    const resp = await this.http.request({
      method: 'POST',
      url: `${this.baseUrl}/dte/guia-despacho`,
      headers: this.headers(input.idempotencyKey),
      body: JSON.stringify(payload),
    });
    return this.parseEmissionResponse(resp, 'guia_despacho_52', input.rutEmisor);
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    facturaInputSchema.parse(input);
    const payload = this.mapInputFactura(input);
    const resp = await this.http.request({
      method: 'POST',
      url: `${this.baseUrl}/dte/factura`,
      headers: this.headers(input.idempotencyKey),
      body: JSON.stringify(payload),
    });
    return this.parseEmissionResponse(resp, input.tipo, input.rutEmisor);
  }

  async queryStatus(folio: string, rutEmisor: string): Promise<DteStatus> {
    const url = `${this.baseUrl}/dte/${encodeURIComponent(rutEmisor)}/${encodeURIComponent(folio)}/status`;
    const resp = await this.http.request({
      method: 'GET',
      url,
      headers: this.headers(),
    });
    if (resp.status >= 400) {
      this.throwHttpError(resp);
    }
    const body = JSON.parse(resp.body) as {
      folio: string;
      status: string;
      siiMessage?: string;
      updatedAt: string;
    };
    return {
      folio: body.folio,
      status: this.mapStatus(body.status),
      siiMessage: body.siiMessage,
      updatedAt: body.updatedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Mapping (calibrar contra API real en Sprint 1.4)
  // --------------------------------------------------------------------------

  private mapInputGuiaDespacho(input: GuiaDespachoInput): Record<string, unknown> {
    return {
      emisor: { rut: input.rutEmisor },
      receptor: {
        rut: input.receptor.rut,
        razonSocial: input.receptor.razonSocial,
        giro: input.receptor.giro,
        direccion: input.receptor.direccion,
        comuna: input.receptor.comuna,
        region: input.receptor.region,
        email: input.receptor.email,
      },
      indicadorTraslado: input.indicadorTraslado,
      fechaEmision: input.fechaEmision,
      transporte: {
        origen: input.origen,
        destino: input.destino,
        patente: input.patenteVehiculo,
        rutTransportista: input.rutTransportista ?? input.rutEmisor,
        rutConductor: input.rutConductor,
      },
      detalle: input.items.map((it, idx) => ({
        nroLinea: idx + 1,
        nombre: it.nombre,
        cantidad: it.cantidad,
        unidadMedida: it.unidad,
        precioUnitario: it.precioUnitarioClp,
        exento: it.exento,
      })),
    };
  }

  private mapInputFactura(input: FacturaInput): Record<string, unknown> {
    return {
      emisor: { rut: input.rutEmisor },
      tipoDte: input.tipo === 'factura_33' ? 33 : 34,
      receptor: {
        rut: input.receptor.rut,
        razonSocial: input.receptor.razonSocial,
        giro: input.receptor.giro,
        direccion: input.receptor.direccion,
        comuna: input.receptor.comuna,
        region: input.receptor.region,
        email: input.receptor.email,
      },
      fechaEmision: input.fechaEmision,
      referencias: input.refFolioGuia
        ? [{ tipoDocumento: 52, folio: input.refFolioGuia }]
        : undefined,
      detalle: input.items.map((it, idx) => ({
        nroLinea: idx + 1,
        nombre: it.nombre,
        cantidad: it.cantidad,
        unidadMedida: it.unidad,
        precioUnitario: it.precioUnitarioClp,
        exento: it.exento,
      })),
    };
  }

  private parseEmissionResponse(
    resp: { status: number; body: string },
    type: DteResult['type'],
    rutEmisor: string,
  ): DteResult {
    if (resp.status >= 400) {
      this.throwHttpError(resp);
    }
    const body = JSON.parse(resp.body) as {
      folio: string | number;
      trackId: string;
      emittedAt?: string;
      status?: string;
      pdfUrl?: string;
      xmlUrl?: string;
    };
    return {
      folio: String(body.folio),
      type,
      rutEmisor: rutEmisor as DteResult['rutEmisor'],
      emittedAt: body.emittedAt ?? new Date().toISOString(),
      providerRef: body.trackId,
      pdfUrl: body.pdfUrl,
      xmlUrl: body.xmlUrl,
      status: this.mapStatus(body.status ?? 'pendiente'),
    };
  }

  private mapStatus(provider: string): DteStatus['status'] {
    const map: Record<string, DteStatus['status']> = {
      pending: 'pendiente',
      pendiente: 'pendiente',
      accepted: 'aceptado',
      aceptado: 'aceptado',
      accepted_with_warnings: 'aceptado_con_reparos',
      aceptado_con_reparos: 'aceptado_con_reparos',
      rejected: 'rechazado',
      rechazado: 'rechazado',
    };
    return map[provider.toLowerCase()] ?? 'pendiente';
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idempotencyKey) {
      h['Idempotency-Key'] = idempotencyKey;
    }
    return h;
  }

  private throwHttpError(resp: { status: number; body: string }): never {
    let message = resp.body;
    let siiCode = 'UNKNOWN';
    try {
      const parsed = JSON.parse(resp.body) as { message?: string; siiCode?: string };
      if (parsed.message) {
        message = parsed.message;
      }
      if (parsed.siiCode) {
        siiCode = parsed.siiCode;
      }
    } catch {
      /* body no es JSON, dejarlo como texto */
    }
    if (resp.status >= 400 && resp.status < 500) {
      throw new DteValidationError(siiCode, `Paperless 4xx: ${message}`);
    }
    throw new DteProviderError(resp.status, `Paperless ${resp.status}: ${message}`);
  }

  /** Test helper: expone timeoutMs para inspección. */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }
}

function defaultHttpClient(): HttpClient {
  return {
    async request(opts) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(opts.url, {
          method: opts.method,
          headers: opts.headers,
          ...(opts.body !== undefined && { body: opts.body }),
          signal: controller.signal,
        });
        const body = await res.text();
        return { status: res.status, body };
      } finally {
        clearTimeout(t);
      }
    },
  };
}
