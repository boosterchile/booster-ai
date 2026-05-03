/**
 * MockDteProvider — implementación in-memory para tests + dev local.
 *
 * Comportamiento:
 *   - Genera folios autoincrementales por (rutEmisor, tipoDte).
 *   - Persiste los DTEs emitidos en un Map para que `queryStatus` los recupere.
 *   - Computa SHA-256 real del XML "construido" (un string JSON con los
 *     campos del input — suficiente para tests de integridad, NO es XML
 *     SII real).
 *   - Soporta inyección de fallos (`failNextEmit: 'rejected_sii' | ...`)
 *     para tests de error paths sin tener que mockear todo el provider.
 *
 * NO usar en producción. Para producción usar el adapter real (Bsale,
 * Paperless, etc.) que se conecta al SII.
 */

import { createHash } from 'node:crypto';
import type { ZodError } from 'zod';
import {
  DteCertificateError,
  DteFolioConflictError,
  DteNotFoundError,
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

export interface MockDteProviderOptions {
  /**
   * Environment a simular. Default `certification` para que ningún test
   * pueda accidentalmente claim "production" output.
   */
  environment?: DteEnvironment;
  /**
   * Folio inicial. Default 1. Se incrementa por cada emisión exitosa.
   */
  startingFolio?: number;
  /**
   * Forzar el siguiente `emit*` (cualquier tipo) a fallar con el error
   * especificado. Después del primer fallo se resetea automáticamente.
   */
  failNextEmit?: 'rejected_sii' | 'certificate_error' | 'unavailable' | 'folio_conflict';
  /**
   * Retraso simulado en ms en cada `emit*`. Default 0.
   */
  artificialLatencyMs?: number;
}

interface StoredDte {
  result: DteResult;
  status: DteStatus;
}

export class MockDteProvider implements DteProvider {
  public readonly environment: DteEnvironment;
  private nextFolioByEmisor = new Map<string, number>();
  private store = new Map<string, StoredDte>();
  private failNextEmit: MockDteProviderOptions['failNextEmit'];
  private latencyMs: number;
  private startingFolio: number;

  constructor(opts: MockDteProviderOptions = {}) {
    this.environment = opts.environment ?? 'certification';
    this.startingFolio = opts.startingFolio ?? 1;
    this.failNextEmit = opts.failNextEmit;
    this.latencyMs = opts.artificialLatencyMs ?? 0;
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    const parsed = guiaDespachoInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        'Input inválido para Guía de Despacho',
        flattenZodErrors(parsed.error),
      );
    }
    return this.emitInternal(52, parsed.data);
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    const parsed = facturaInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError('Input inválido para Factura', flattenZodErrors(parsed.error));
    }
    return this.emitInternal(parsed.data.tipoDte, parsed.data);
  }

  async queryStatus(args: {
    folio: string;
    rutEmisor: string;
    tipoDte: 33 | 34 | 52;
  }): Promise<DteStatus> {
    const key = storeKey(args.tipoDte, args.rutEmisor, args.folio);
    const stored = this.store.get(key);
    if (!stored) {
      throw new DteNotFoundError(
        `Folio ${args.folio} no encontrado para emisor ${args.rutEmisor}`,
        args.folio,
        args.rutEmisor,
      );
    }
    // Refresh lastCheckedAt para que el caller vea el query timestamp.
    return { ...stored.status, lastCheckedAt: new Date() };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async emitInternal(
    tipoDte: 33 | 34 | 52,
    parsed: GuiaDespachoInput | FacturaInput,
  ): Promise<DteResult> {
    if (this.latencyMs > 0) {
      await sleep(this.latencyMs);
    }

    if (this.failNextEmit) {
      const failure = this.failNextEmit;
      this.failNextEmit = undefined; // one-shot
      throw this.constructFailure(failure, parsed.rutEmisor);
    }

    const folio = this.allocateFolio(parsed.rutEmisor, tipoDte);
    const xmlSigned = this.buildPseudoXml(tipoDte, folio, parsed);
    const sha256 = createHash('sha256').update(xmlSigned).digest('hex');

    const result: DteResult = {
      folio,
      tipoDte,
      rutEmisor: parsed.rutEmisor,
      fechaEmision: parsed.fechaEmision,
      xmlSigned,
      sha256,
      providerTrackId: `mock-track-${tipoDte}-${folio}`,
      status: 'accepted',
    };

    const status: DteStatus = {
      folio,
      tipoDte,
      rutEmisor: parsed.rutEmisor,
      status: 'accepted',
      lastCheckedAt: new Date(),
    };

    this.store.set(storeKey(tipoDte, parsed.rutEmisor, folio), { result, status });
    return result;
  }

  private allocateFolio(rutEmisor: string, tipoDte: 33 | 34 | 52): string {
    const key = `${rutEmisor}|${tipoDte}`;
    const next = this.nextFolioByEmisor.get(key) ?? this.startingFolio;
    this.nextFolioByEmisor.set(key, next + 1);
    return String(next);
  }

  private buildPseudoXml(
    tipoDte: 33 | 34 | 52,
    folio: string,
    parsed: GuiaDespachoInput | FacturaInput,
  ): string {
    // Pseudo-XML compacto. NO es XML SII real — solo un string
    // determinístico que permite tests de integridad (sha256 estable
    // para mismo input + folio).
    const payload = {
      tipo: tipoDte,
      folio,
      rutEmisor: parsed.rutEmisor,
      receptor: parsed.rutReceptor,
      fechaEmision: parsed.fechaEmision.toISOString(),
      itemCount: parsed.items.length,
      total: parsed.items.reduce((acc, item) => acc + item.cantidad * item.precioUnitarioClp, 0),
    };
    return `<DTE mock="true">${JSON.stringify(payload)}</DTE>`;
  }

  private constructFailure(
    kind: NonNullable<MockDteProviderOptions['failNextEmit']>,
    rutEmisor: string,
  ): Error {
    switch (kind) {
      case 'rejected_sii':
        return new DteRejectedBySiiError(
          'SII rechazó el documento (mock)',
          'MOCK_001',
          'Forzado por failNextEmit en tests',
        );
      case 'certificate_error':
        return new DteCertificateError('Certificado digital inválido (mock)', rutEmisor);
      case 'unavailable':
        return new DteProviderUnavailableError('Provider down (mock)', 30);
      case 'folio_conflict':
        return new DteFolioConflictError('Folio ya en uso (mock)', 'mock-folio-collision');
    }
  }
}

function storeKey(tipoDte: 33 | 34 | 52, rutEmisor: string, folio: string): string {
  return `${tipoDte}|${rutEmisor}|${folio}`;
}

function flattenZodErrors(error: ZodError): Record<string, string[]> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
