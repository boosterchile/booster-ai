/**
 * BsaleAdapter — implementación de `DteProvider` que se conecta al
 * provider real **Bsale** (https://api.bsale.dev/).
 *
 * **ESTADO: SKELETON.** El adapter está implementado a nivel de estructura
 * HTTP (auth, signing, error mapping), pero **NO ha sido validado contra
 * el sandbox real de Bsale** porque requiere:
 *   - API token de Bsale (env `BSALE_API_TOKEN`)
 *   - Certificado digital `.pfx` del emisor en Secret Manager
 *   - Acceso al ambiente de certificación SII (https://maullin.sii.cl)
 *
 * La spec de Bsale a la fecha de escritura es estable, pero los endpoints
 * exactos pueden tener variaciones menores. Antes de llevar a prod:
 *   1. Validar contra sandbox Bsale con un viaje de prueba real.
 *   2. Ajustar `mapBsaleResponseToDteResult` si el shape cambió.
 *   3. Smoke E2E end-to-end: emitir guía → SII responde con folio → query
 *      status devuelve `accepted`.
 *
 * Documentación oficial Bsale: https://api.bsale.dev/?bash#documentos
 */

import { createHash } from 'node:crypto';
import {
  DteCertificateError,
  DteFolioConflictError,
  DteNotFoundError,
  DteProviderError,
  DteProviderUnavailableError,
  DteRejectedBySiiError,
  DteValidationError,
} from './errors.js';
import {
  type DteEnvironment,
  type DteProvider,
  type DteResult,
  type DteStatus,
  type FacturaInput,
  type GuiaDespachoInput,
  facturaInputSchema,
  guiaDespachoInputSchema,
} from './types.js';

export interface BsaleAdapterOptions {
  /**
   * API token de Bsale. Obtenido via panel de admin de la cuenta Bsale.
   * Se envía como `access_token` header en cada request.
   */
  apiToken: string;
  /**
   * Environment SII al que apunta este adapter.
   * - `certification` → `https://maullin.sii.cl` (testing, folios no oficiales)
   * - `production` → `https://palena.sii.cl` (prod, folios oficiales con valor legal)
   *
   * Bsale internamente rutea según el flag — el adapter solo lo declara
   * para que el caller sepa qué environment está usando.
   */
  environment: DteEnvironment;
  /**
   * Override del base URL de la API Bsale. Default
   * `https://api.bsale.io/v1`. Sirve para:
   *   - Apuntar a un mock server en tests
   *   - Apuntar a una versión beta de la API
   */
  baseUrl?: string;
  /**
   * `fetch` injectable para tests. Default `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
  /**
   * Timeout request en ms. Default 30000 (30s) — Bsale puede tomar hasta
   * 20s en validar el DTE contra SII.
   */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.bsale.io/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Adapter Bsale. Implementa `DteProvider` mapeando las llamadas al API
 * REST de Bsale.
 *
 * Convención de mapeo:
 *   - `emitGuiaDespacho` → `POST /documents.json` con `documentTypeId=52`
 *     (Guía de Despacho según taxonomía Bsale).
 *   - `emitFactura` → `POST /documents.json` con `documentTypeId=33|34`.
 *   - `queryStatus` → `GET /documents/{id}.json`.
 *
 * Auth: header `access_token: <apiToken>` en todos los requests.
 */
export class BsaleAdapter implements DteProvider {
  public readonly environment: DteEnvironment;
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: BsaleAdapterOptions) {
    if (!opts.apiToken) {
      throw new DteCertificateError(
        'Bsale apiToken requerido — sin él no se puede autenticar contra el provider',
        '',
      );
    }
    this.apiToken = opts.apiToken;
    this.environment = opts.environment;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    const parsed = guiaDespachoInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        'Input inválido para Guía de Despacho',
        flattenZodErrors(parsed.error),
      );
    }
    const data = parsed.data;

    const body = {
      documentTypeId: 52,
      emissionDate: Math.floor(data.fechaEmision.getTime() / 1000),
      // Bsale espera campos específicos por tipo. Para Guía de Despacho
      // (tipo 52), pide `transferType` (1-7), `client` (receptor),
      // `details` (items), y `transports` (chofer + vehículo).
      transferType: data.tipoDespacho,
      client: {
        code: data.rutReceptor,
        name: data.razonSocialReceptor,
      },
      details: data.items.map((item) => ({
        netUnitValue: item.precioUnitarioClp,
        quantity: item.cantidad,
        comment: item.descripcion,
        unitMeasure: item.unidadMedida,
      })),
      transports: [
        {
          patent: data.transporte.patente,
          driver: {
            rut: data.transporte.rutChofer,
            name: data.transporte.nombreChofer,
          },
          destinationAddress: data.transporte.direccionDestino,
          destinationMunicipality: data.transporte.comunaDestino,
        },
      ],
      // Referencia externa (tracking code Booster) — Bsale lo persiste
      // en el campo `informationDte.references` para correlación.
      ...(data.referenciaExterna ? { externalReference: data.referenciaExterna } : {}),
    };

    const response = await this.postDocument(body);
    return this.mapBsaleResponseToDteResult(response, 52, data.rutEmisor, data.fechaEmision);
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    const parsed = facturaInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError('Input inválido para Factura', flattenZodErrors(parsed.error));
    }
    const data = parsed.data;

    const body = {
      documentTypeId: data.tipoDte,
      emissionDate: Math.floor(data.fechaEmision.getTime() / 1000),
      client: {
        code: data.rutReceptor,
        name: data.razonSocialReceptor,
        activity: data.giroReceptor,
      },
      details: data.items.map((item) => ({
        netUnitValue: item.precioUnitarioClp,
        quantity: item.cantidad,
        comment: item.descripcion,
        unitMeasure: item.unidadMedida,
      })),
      ...(data.referenciaGuia
        ? {
            references: [
              {
                folio: data.referenciaGuia.folio,
                referenceDate: Math.floor(data.referenciaGuia.fechaEmision.getTime() / 1000),
                documentReferenceId: 52,
              },
            ],
          }
        : {}),
      ...(data.referenciaExterna ? { externalReference: data.referenciaExterna } : {}),
    };

    const response = await this.postDocument(body);
    return this.mapBsaleResponseToDteResult(
      response,
      data.tipoDte,
      data.rutEmisor,
      data.fechaEmision,
    );
  }

  async queryStatus(args: {
    folio: string;
    rutEmisor: string;
    tipoDte: 33 | 34 | 52;
  }): Promise<DteStatus> {
    const url = `${this.baseUrl}/documents.json?codesii=${args.tipoDte}&number=${args.folio}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        access_token: this.apiToken,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      throw new DteNotFoundError(
        `Folio ${args.folio} no encontrado en Bsale`,
        args.folio,
        args.rutEmisor,
      );
    }
    if (!response.ok) {
      throw mapHttpError(response.status, await safeReadText(response));
    }

    const json = (await response.json()) as BsaleQueryResponse;
    const item = json.items?.[0];
    if (!item) {
      throw new DteNotFoundError(
        `Folio ${args.folio} no encontrado en Bsale`,
        args.folio,
        args.rutEmisor,
      );
    }

    return {
      folio: String(item.number),
      tipoDte: args.tipoDte,
      rutEmisor: args.rutEmisor,
      status: mapBsaleStatusToDteStatus(item.informationDte?.status ?? 'pending'),
      ...(item.informationDte?.rejectionReason
        ? { rejectionReason: item.informationDte.rejectionReason }
        : {}),
      lastCheckedAt: new Date(),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async postDocument(body: unknown): Promise<BsaleDocumentResponse> {
    const url = `${this.baseUrl}/documents.json`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        access_token: this.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await safeReadText(response);
      throw mapHttpError(response.status, text);
    }

    return (await response.json()) as BsaleDocumentResponse;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        throw new DteProviderUnavailableError(
          `Timeout (${this.timeoutMs}ms) llamando a Bsale: ${url}`,
        );
      }
      throw new DteProviderError(`fetch a Bsale falló: ${url}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private mapBsaleResponseToDteResult(
    response: BsaleDocumentResponse,
    tipoDte: 33 | 34 | 52,
    rutEmisor: string,
    fechaEmision: Date,
  ): DteResult {
    if (!response.number) {
      throw new DteProviderError('Bsale devolvió documento sin number/folio asignado');
    }
    const xmlSigned = response.urlXml ?? '';
    // Si Bsale aún no devuelve el XML embebido (algunos endpoints lo
    // dan via separate fetch), el caller debería seguir con queryStatus
    // hasta que esté listo. Persistir lo que vino.
    const sha256 = xmlSigned ? createHash('sha256').update(xmlSigned).digest('hex') : 'pending';

    return {
      folio: String(response.number),
      tipoDte,
      rutEmisor,
      fechaEmision,
      xmlSigned,
      sha256,
      providerTrackId: response.id ? String(response.id) : '',
      status: mapBsaleStatusToInitial(response.informationDte?.status ?? 'pending'),
    };
  }
}

// ---------------------------------------------------------------------------
// Bsale response types (subset relevante)
// ---------------------------------------------------------------------------

interface BsaleInformationDte {
  status?: 'accepted' | 'pending' | 'rejected' | string;
  rejectionReason?: string;
}

interface BsaleDocumentResponse {
  id?: number;
  number?: number;
  urlXml?: string;
  informationDte?: BsaleInformationDte;
}

interface BsaleQueryResponse {
  items?: Array<{
    id: number;
    number: number;
    informationDte?: BsaleInformationDte;
  }>;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapBsaleStatusToInitial(bsaleStatus: string): DteResult['status'] {
  switch (bsaleStatus) {
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending_sii_validation';
  }
}

function mapBsaleStatusToDteStatus(bsaleStatus: string): DteStatus['status'] {
  switch (bsaleStatus) {
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending_sii_validation';
  }
}

function mapHttpError(status: number, body: string): Error {
  if (status === 400) {
    return new DteValidationError(`Bsale 400: ${body}`, {});
  }
  if (status === 401 || status === 403) {
    return new DteCertificateError(`Bsale rechazó auth (${status}): ${body}`, '');
  }
  if (status === 409) {
    return new DteFolioConflictError(`Bsale 409: ${body}`, '');
  }
  if (status === 422) {
    return new DteRejectedBySiiError(`SII rechazó vía Bsale: ${body}`, `BSALE_${status}`, body);
  }
  if (status >= 500) {
    return new DteProviderUnavailableError(`Bsale ${status}: ${body}`);
  }
  return new DteProviderError(`Bsale HTTP ${status}: ${body}`);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<no body>';
  }
}

function flattenZodErrors(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(issue.message);
  }
  return out;
}
