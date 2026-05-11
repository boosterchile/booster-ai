import { DteValidationError } from '../errors.js';
import type { DteEmitter } from '../interface.js';
import {
  type DteResult,
  type DteStatus,
  type FacturaInput,
  type GuiaDespachoInput,
  facturaInputSchema,
  guiaDespachoInputSchema,
} from '../types.js';

/**
 * MockAdapter — implementación in-memory para dev local + tests.
 *
 * Genera folios sintéticos secuenciales y mantiene un store interno
 * en memoria para que `queryStatus` y `voidDocument` puedan operar
 * sobre emisiones previas. Sin red, sin disk, sin creds.
 *
 * **Comportamiento**:
 *   - `emit*` valida input contra Zod schema (lanza DteValidationError
 *     si falla) y devuelve `DteResult` con folio nuevo + status
 *     inicial `en_proceso`. El test puede mutar el status via
 *     `setStatus(folio, status)` para simular respuestas de SII.
 *   - `queryStatus` busca por folio + rut emisor. Si no existe →
 *     status `rechazado` con mensaje "folio no encontrado".
 *   - `voidDocument` marca el DTE como `anulado` con un folio de
 *     anulación sintético. Idempotente: si ya estaba anulado, retorna
 *     sin emitir nada nuevo.
 *
 * **No usar en producción**: el SII real no se contacta. Los folios
 * generados acá NO son válidos legalmente.
 */
export class MockDteAdapter implements DteEmitter {
  /**
   * Folios secuenciales por emisor — global a través de tipos de DTE
   * para que `queryStatus(folio, rutEmisor)` pueda resolver sin
   * ambigüedad (en SII real, (rut, tipo) tienen rangos separados;
   * acá simplificamos porque el mock no busca realismo legal).
   */
  private seqByEmisor = new Map<string, number>();
  private documents = new Map<string, MockDocument>();
  private now: () => Date;

  constructor(opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  async emitFactura(input: FacturaInput): Promise<DteResult> {
    const parsed = facturaInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        `factura input inválido: ${parsed.error.message}`,
        parsed.error.format(),
      );
    }
    const folio = this.nextFolio(parsed.data.emisor.rut, 33);
    const montoTotal = computeMontoTotal(parsed.data.items);
    const result: DteResult = {
      folio,
      tipo: 33,
      rutEmisor: parsed.data.emisor.rut,
      emitidoEn: this.now().toISOString(),
      montoTotalClp: montoTotal,
      pdfUrl: `https://mock.dte.local/${parsed.data.emisor.rut}/33/${folio}.pdf`,
      providerTrackId: `mock-${folio}`,
    };
    this.documents.set(keyOf(parsed.data.emisor.rut, folio), {
      tipo: 33,
      status: 'en_proceso',
      result,
    });
    return result;
  }

  async emitGuiaDespacho(input: GuiaDespachoInput): Promise<DteResult> {
    const parsed = guiaDespachoInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new DteValidationError(
        `guia de despacho input inválida: ${parsed.error.message}`,
        parsed.error.format(),
      );
    }
    const folio = this.nextFolio(parsed.data.emisor.rut, 52);
    const montoTotal = computeMontoTotal(parsed.data.items);
    const result: DteResult = {
      folio,
      tipo: 52,
      rutEmisor: parsed.data.emisor.rut,
      emitidoEn: this.now().toISOString(),
      montoTotalClp: montoTotal,
      pdfUrl: `https://mock.dte.local/${parsed.data.emisor.rut}/52/${folio}.pdf`,
      providerTrackId: `mock-${folio}`,
    };
    this.documents.set(keyOf(parsed.data.emisor.rut, folio), {
      tipo: 52,
      status: 'en_proceso',
      result,
    });
    return result;
  }

  async queryStatus(folio: string, rutEmisor: string): Promise<DteStatus> {
    const doc = this.documents.get(keyOf(rutEmisor, folio));
    if (!doc) {
      return {
        folio,
        tipo: 33,
        rutEmisor,
        status: 'rechazado',
        mensaje: 'folio no encontrado en mock store',
      };
    }
    const out: DteStatus = {
      folio,
      tipo: doc.tipo,
      rutEmisor,
      status: doc.status,
    };
    if (doc.folioAnulacion) {
      out.folioAnulacion = doc.folioAnulacion;
    }
    return out;
  }

  async voidDocument(folio: string, rutEmisor: string, _reason: string): Promise<void> {
    const doc = this.documents.get(keyOf(rutEmisor, folio));
    if (!doc) {
      throw new DteValidationError(`folio ${folio} no encontrado para emisor ${rutEmisor}`);
    }
    if (doc.status === 'anulado') {
      // Idempotente — ya estaba anulado.
      return;
    }
    const folioAnulacion = this.nextFolio(rutEmisor, 61);
    doc.status = 'anulado';
    doc.folioAnulacion = folioAnulacion;
  }

  /** Hook para tests: forzar status específico tras emit. */
  setStatus(folio: string, rutEmisor: string, status: DteStatus['status']): void {
    const doc = this.documents.get(keyOf(rutEmisor, folio));
    if (!doc) {
      throw new Error(`MockDteAdapter.setStatus: folio ${folio} no existe`);
    }
    doc.status = status;
  }

  /** Hook para tests: inspeccionar todos los DTEs emitidos. */
  listEmitted(): DteResult[] {
    return Array.from(this.documents.values()).map((d) => d.result);
  }

  private nextFolio(rutEmisor: string, _tipo: number): string {
    const current = this.seqByEmisor.get(rutEmisor) ?? 0;
    const next = current + 1;
    this.seqByEmisor.set(rutEmisor, next);
    return String(next);
  }
}

interface MockDocument {
  tipo: 33 | 52;
  status: DteStatus['status'];
  result: DteResult;
  folioAnulacion?: string;
}

function keyOf(rutEmisor: string, folio: string): string {
  return `${rutEmisor}:${folio}`;
}

function computeMontoTotal(items: Array<{ montoNetoClp: number; exento: boolean }>): number {
  const neto = items.reduce((sum, i) => sum + i.montoNetoClp, 0);
  const netoConIva = items.reduce(
    (sum, i) => sum + (i.exento ? i.montoNetoClp : Math.round(i.montoNetoClp * 1.19)),
    0,
  );
  // Mock simple: aplicar IVA 19% sobre items no-exentos.
  return netoConIva > 0 ? netoConIva : neto;
}
