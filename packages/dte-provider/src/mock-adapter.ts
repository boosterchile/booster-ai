/**
 * Adapter in-memory para tests + dev local. Determinístico: dado el
 * mismo input + idempotencyKey, devuelve el mismo folio y status.
 *
 * Default behaviour: todos los DTEs devuelven `status='aceptado'`
 * inmediatamente. Tests pueden sobreescribir con
 * `MockAdapter.failNext()` o configurar respuestas específicas.
 */

import type { DteEmitter } from './dte-emitter.js';
import {
  type DteResult,
  type DteStatus,
  type DteType,
  DteValidationError,
  type FacturaInput,
  type GuiaDespachoInput,
  facturaInputSchema,
  guiaDespachoInputSchema,
} from './tipos.js';

interface StoredDte {
  folio: string;
  type: DteType;
  rutEmisor: string;
  emittedAt: string;
  status: DteStatus['status'];
  siiMessage?: string | undefined;
}

export interface MockAdapterOptions {
  /** Folio inicial. Se incrementa por cada emisión. Default = 1000. */
  startFolio?: number;
  /** Default status de DTEs nuevos. */
  defaultStatus?: DteStatus['status'];
  /** Date factory (para tests determinísticos). */
  now?: () => Date;
}

export class MockAdapter implements DteEmitter {
  private nextFolio: number;
  private readonly defaultStatus: DteStatus['status'];
  private readonly now: () => Date;
  private readonly store = new Map<string, StoredDte>();
  private readonly idempotencyMap = new Map<string, string>();
  private failQueue: Array<{ kind: 'validation' | 'provider'; message: string }> = [];

  constructor(opts: MockAdapterOptions = {}) {
    this.nextFolio = opts.startFolio ?? 1000;
    this.defaultStatus = opts.defaultStatus ?? 'aceptado';
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Encola un fallo para la próxima invocación. Útil en tests para
   * simular SII rechaza un DTE específico.
   */
  failNext(kind: 'validation' | 'provider', message: string): void {
    this.failQueue.push({ kind, message });
  }

  /** Resetea el store (útil entre tests). */
  reset(): void {
    this.store.clear();
    this.idempotencyMap.clear();
    this.failQueue = [];
    this.nextFolio = 1000;
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    guiaDespachoInputSchema.parse(input);
    return this.emit('guia_despacho_52', input.rutEmisor, input.idempotencyKey, input.fechaEmision);
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    facturaInputSchema.parse(input);
    return this.emit(input.tipo, input.rutEmisor, input.idempotencyKey, input.fechaEmision);
  }

  async queryStatus(folio: string, rutEmisor: string): Promise<DteStatus> {
    const stored = this.store.get(this.storeKey(folio, rutEmisor));
    if (!stored) {
      throw new Error(`DTE no encontrado: folio=${folio} rutEmisor=${rutEmisor}`);
    }
    return {
      folio: stored.folio,
      status: stored.status,
      siiMessage: stored.siiMessage,
      updatedAt: this.now().toISOString(),
    };
  }

  /**
   * Test helper: setea el status de un DTE existente. Simula que SII
   * cambió de pendiente a aceptado/rechazado.
   */
  setStatus(
    folio: string,
    rutEmisor: string,
    status: DteStatus['status'],
    siiMessage?: string,
  ): void {
    const key = this.storeKey(folio, rutEmisor);
    const stored = this.store.get(key);
    if (!stored) {
      throw new Error(`DTE no encontrado: folio=${folio}`);
    }
    stored.status = status;
    stored.siiMessage = siiMessage;
  }

  private async emit(
    type: DteType,
    rutEmisor: string,
    idempotencyKey: string | undefined,
    fechaEmisionInput: string | undefined,
  ): Promise<DteResult> {
    const failure = this.failQueue.shift();
    if (failure) {
      if (failure.kind === 'validation') {
        throw new DteValidationError('MOCK_VALIDATION', failure.message);
      }
      const ProviderErrorClass = (await import('./tipos.js')).DteProviderError;
      throw new ProviderErrorClass(503, failure.message);
    }

    if (idempotencyKey) {
      const cached = this.idempotencyMap.get(idempotencyKey);
      if (cached) {
        const stored = this.store.get(cached);
        if (stored) {
          return this.toResult(stored);
        }
      }
    }

    const folio = String(this.nextFolio++);
    const emittedAt = fechaEmisionInput ?? this.now().toISOString();
    const stored: StoredDte = {
      folio,
      type,
      rutEmisor,
      emittedAt,
      status: this.defaultStatus,
    };
    const key = this.storeKey(folio, rutEmisor);
    this.store.set(key, stored);
    if (idempotencyKey) {
      this.idempotencyMap.set(idempotencyKey, key);
    }
    return this.toResult(stored);
  }

  private toResult(stored: StoredDte): DteResult {
    return {
      folio: stored.folio,
      type: stored.type,
      rutEmisor: stored.rutEmisor as DteResult['rutEmisor'],
      emittedAt: stored.emittedAt,
      providerRef: `mock-${stored.folio}`,
      status: stored.status,
    };
  }

  private storeKey(folio: string, rutEmisor: string): string {
    return `${rutEmisor}::${folio}`;
  }
}
