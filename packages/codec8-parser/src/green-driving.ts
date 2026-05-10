import type { AvlPacket, AvlRecord, GpsElement, IoEntry } from './tipos.js';

/**
 * Green Driving + Over-Speeding events del Teltonika FMC150.
 *
 * El device YA emite estos eventos como IO entries en cada AVL packet
 * cuando se configuran los thresholds en el `eventual record settings`.
 * El parser binario los entrega en `record.io.entries` con ID + value
 * crudo; este módulo aplica la capa **semántica** que los traduce a
 * eventos tipados consumibles por el pipeline de driver scoring.
 *
 * **Por qué importa para Booster (Phase 2 — driver behavior scoring)**:
 *
 *   - Reducción de huella de carbono: arrancadas/frenadas bruscas
 *     queman ~5-15% más combustible que conducción suave (estudios
 *     SAE eco-driving). Detectarlas + coachear al conductor es la
 *     palanca de "comportamiento en ruta" del feature original.
 *   - Diferenciador comercial Verified/Enterprise tier (ADR-026): los
 *     clientes con Teltonika reciben behavior score; los Basic no.
 *   - Inputs para la Phase 3 (coaching IA): Gemini analiza el patrón
 *     de eventos y genera recomendaciones contextualizadas.
 *
 * ## AVL IDs Teltonika (FMC150 firmware estándar)
 *
 *   - IO 253 — Green Driving Type
 *       value: 1 = harsh acceleration, 2 = harsh braking, 3 = harsh cornering
 *       Solo se emite cuando el evento ocurre (no hay periodic 0).
 *   - IO 254 — Green Driving Value (severidad/magnitud)
 *       Para harsh accel/brake: pico de aceleración en mG (positivo).
 *       Para harsh cornering: lateral G en cG (centi-G) según
 *       configuración del device.
 *   - IO 255 — Over-Speeding (km/h)
 *       value: velocidad en km/h del momento del evento.
 *       Threshold configurado a nivel de device (ej. 100 km/h en ruta).
 *
 * ## Diseño del extractor
 *
 *   - Pure function, sin I/O. Toma `AvlRecord` o `AvlPacket` ya
 *     parseado y devuelve eventos tipados.
 *   - Un record puede contener MÚLTIPLES eventos simultáneos (ej.
 *     harsh_braking + over_speed cuando un conductor frena fuerte
 *     a alta velocidad). Devolvemos array para cubrir el caso.
 *   - Si el value de IO 253 está fuera del rango {1, 2, 3}, el evento
 *     se ignora (defensivo: firmware mal configurado o packet
 *     corrupto que pasó CRC).
 */

// =============================================================================
// AVL IDs
// =============================================================================

/** AVL ID 253 — Green Driving Type (1=accel, 2=brake, 3=cornering). */
export const GREEN_DRIVING_TYPE_AVL_ID = 253;

/** AVL ID 254 — Green Driving Value (severidad en mG). */
export const GREEN_DRIVING_VALUE_AVL_ID = 254;

/** AVL ID 255 — Over-Speeding (km/h del momento del evento). */
export const OVER_SPEEDING_AVL_ID = 255;

// =============================================================================
// TYPES
// =============================================================================

export type GreenDrivingEventType =
  | 'harsh_acceleration'
  | 'harsh_braking'
  | 'harsh_cornering'
  | 'over_speed';

/**
 * Un evento de green driving o over-speeding extraído de un AVL record.
 *
 * Los 4 tipos comparten shape (timestamp + severidad + GPS) por
 * simplicidad consumer-side; el `type` permite distinguir el evento.
 *
 * `severity` es el campo unificado:
 *   - harsh_acceleration / harsh_braking: pico de aceleración en mG (positivo)
 *   - harsh_cornering: lateral G en mG
 *   - over_speed: velocidad en km/h
 *
 * `unit` deja explícita la unidad para que el caller no se confunda.
 */
export interface GreenDrivingEvent {
  type: GreenDrivingEventType;
  /** Timestamp epoch ms del record (mismo que `record.timestampMs`). */
  timestampMs: bigint;
  /** Magnitud del evento en su unidad nativa. */
  severity: number;
  /** Unidad de la severidad — para no confundir mG con km/h. */
  unit: 'mG' | 'km/h';
  /** Posición GPS en el momento del evento. */
  gps: GpsElement;
}

// =============================================================================
// EXTRACTORS
// =============================================================================

/**
 * Extrae todos los eventos de green driving + over-speeding de un
 * AvlRecord. Retorna [] si el record no contiene ninguno.
 *
 * **Idempotente**: dos llamadas con el mismo input devuelven exactamente
 * el mismo output. No hay state interno.
 */
export function extractGreenDrivingEvents(record: AvlRecord): GreenDrivingEvent[] {
  const events: GreenDrivingEvent[] = [];

  // (1) Harsh accel/brake/cornering — IO 253 + IO 254 (severidad).
  const drivingType = findIoById(record.io.entries, GREEN_DRIVING_TYPE_AVL_ID);
  if (drivingType !== undefined) {
    const mappedType = mapGreenDrivingType(drivingType.value);
    if (mappedType !== null) {
      const drivingValue = findIoById(record.io.entries, GREEN_DRIVING_VALUE_AVL_ID);
      const severity = drivingValue !== undefined ? toFiniteNumber(drivingValue.value) : 0;
      events.push({
        type: mappedType,
        timestampMs: record.timestampMs,
        severity,
        unit: 'mG',
        gps: record.gps,
      });
    }
  }

  // (2) Over-speeding — IO 255. value = km/h del momento del evento.
  // Threshold-based: el device solo emite el IO cuando se supera el
  // límite configurado, así que cualquier value > 0 es señal válida.
  const overSpeed = findIoById(record.io.entries, OVER_SPEEDING_AVL_ID);
  if (overSpeed !== undefined) {
    const speedKmh = toFiniteNumber(overSpeed.value);
    if (speedKmh > 0) {
      events.push({
        type: 'over_speed',
        timestampMs: record.timestampMs,
        severity: speedKmh,
        unit: 'km/h',
        gps: record.gps,
      });
    }
  }

  return events;
}

/**
 * Convenience: extrae todos los eventos de green driving de TODOS los
 * records de un packet. Útil cuando el processor recibe un batch
 * (Codec 8 puede tener hasta 50 records por packet).
 */
export function extractGreenDrivingEventsFromPacket(packet: AvlPacket): GreenDrivingEvent[] {
  return packet.records.flatMap(extractGreenDrivingEvents);
}

/**
 * Helper: indica si un packet contiene al menos un evento de green
 * driving. Útil para fast-path en el processor (skip parsing semántico
 * del packet si no hay nada relevante).
 */
export function hasGreenDrivingEvent(packet: AvlPacket): boolean {
  return packet.records.some((r) =>
    r.io.entries.some((e) => e.id === GREEN_DRIVING_TYPE_AVL_ID || e.id === OVER_SPEEDING_AVL_ID),
  );
}

// =============================================================================
// INTERNAL
// =============================================================================

function findIoById(entries: readonly IoEntry[], id: number): IoEntry | undefined {
  return entries.find((e) => e.id === id);
}

/**
 * Mapea el value crudo de IO 253 a uno de los tres tipos de evento.
 * Retorna null si el value está fuera del rango documentado {1, 2, 3}.
 */
function mapGreenDrivingType(
  raw: number | bigint | Buffer,
): 'harsh_acceleration' | 'harsh_braking' | 'harsh_cornering' | null {
  const n = toFiniteNumber(raw);
  switch (n) {
    case 1:
      return 'harsh_acceleration';
    case 2:
      return 'harsh_braking';
    case 3:
      return 'harsh_cornering';
    default:
      return null;
  }
}

/**
 * Convierte el value crudo de un IO entry a number JS finito.
 *
 * - number: pass-through
 * - bigint: convertido a number; si supera 2^53 (improbable para mG /
 *   km/h) se trunca con pérdida de precisión, pero esos rangos no
 *   aplican a green driving (severity típica 100-2000 mG).
 * - Buffer: si llegó como NX entry (raro para estos IDs), interpretamos
 *   como uint8/16/32 según length. Defensivo: si no podemos parsear,
 *   retornamos 0.
 */
function toFiniteNumber(raw: number | bigint | Buffer): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  // Buffer (NX): leemos según length conocida.
  if (raw.length === 1) {
    return raw.readUInt8(0);
  }
  if (raw.length === 2) {
    return raw.readUInt16BE(0);
  }
  if (raw.length === 4) {
    return raw.readUInt32BE(0);
  }
  // Cualquier otro tamaño no es esperable para green driving — return 0.
  return 0;
}
