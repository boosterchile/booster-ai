import type { AvlPacket, AvlRecord, IoEntry } from './tipos.js';

/**
 * Crash Trace = Trace Full with IO's — datos forenses que el FMC150
 * envía cuando detecta un crash con `Crash Trace` activado en Wave 2.
 *
 * Volumen típico:
 *   - Acelerómetro a 100 Hz por 5s antes y 5s después del impacto = ~1000 muestras (X,Y,Z).
 *   - GNSS por 10s antes y 10s después = ~20 records de posición.
 *   - IO state por 10s antes y 10s después = ~20 snapshots de IO.
 *
 * Tamaño total: 5-15 KB por trace (Codec 8 Extended con NX entries).
 *
 * **Por qué importa para Booster**: los carriers grandes tienen pólizas
 * de seguro que requieren reconstrucción forense de accidentes. Sin
 * Crash Trace el carrier reporta "el camión chocó" pero no sabe
 * velocidad, ángulo, ni fuerza del impacto. Con Crash Trace, Booster
 * ofrece evidencia auditada para el reclamo de seguro — vector de
 * upsell ("plan + forensics") y razón de retención.
 *
 * ## Diseño del extractor
 *
 * El parser binario `parseAvlPacket` ya entrega los `AvlRecord[]` con
 * sus IO entries crudos. Este módulo NO re-implementa el parsing
 * binario — toma el `AvlPacket` ya parseado y aplica una capa
 * **semántica** que detecta si es un Crash Trace (un record con
 * `eventIoId === 247` y priority panic) y extrae los campos forenses.
 *
 * La interpretación del layout se basa en la convención FMC-series
 * (acelerómetro en AVL IDs 17/18/19, valores en mG signed). Si el
 * device productivo usa IDs distintos, ajustar `ACCEL_AXIS_X/Y/Z` y
 * los tests con fixture real lo van a detectar.
 */

// =============================================================================
// CONSTANTS — AVL IDs Teltonika para acelerómetro y crash detection
// =============================================================================

/** AVL ID 247 — Crash Detection event marker. Priority Panic. */
export const CRASH_EVENT_AVL_ID = 247;

/** AVL ID 17 — Axis X del acelerómetro (mG, signed int16). */
export const ACCEL_AXIS_X_AVL_ID = 17;
/** AVL ID 18 — Axis Y (mG, signed int16). */
export const ACCEL_AXIS_Y_AVL_ID = 18;
/** AVL ID 19 — Axis Z (mG, signed int16). */
export const ACCEL_AXIS_Z_AVL_ID = 19;

const ACCEL_AVL_IDS = new Set([ACCEL_AXIS_X_AVL_ID, ACCEL_AXIS_Y_AVL_ID, ACCEL_AXIS_Z_AVL_ID]);

// =============================================================================
// TYPES
// =============================================================================

/** Una muestra del acelerómetro a 100 Hz, mG por eje (signed). */
export interface AccelSample {
  /** Offset en ms desde el `crashTimestampMs` (negativo = antes). */
  tMsOffset: number;
  /** Eje X en miliG (1G = 1000 mG, signed). */
  xMg: number;
  yMg: number;
  zMg: number;
}

/** Snapshot GNSS — posición + velocidad en un instante alrededor del crash. */
export interface GnssSample {
  /** Offset en ms desde `crashTimestampMs`. */
  tMsOffset: number;
  longitude: number;
  latitude: number;
  altitude: number;
  speedKmh: number;
  /** Rumbo, grados 0-360. */
  angle: number;
  satellites: number;
}

/** Snapshot del state IO completo en un instante. */
export interface IoSnapshot {
  /** Offset en ms desde `crashTimestampMs`. */
  tMsOffset: number;
  /** Todos los IO entries presentes en ese record. */
  entries: IoEntry[];
}

/**
 * Resultado del extractCrashTrace. Cuando un packet NO es Crash Trace,
 * `extractCrashTrace` retorna `null`.
 */
export interface CrashTrace {
  /** Timestamp epoch ms del impacto (record con eventIoId === 247). */
  crashTimestampMs: bigint;
  /**
   * Peak G-force detectado en cualquier muestra del acelerómetro,
   * en G (1G = 9.81 m/s²). Calculado como sqrt(x² + y² + z²) sobre
   * todas las samples.
   */
  peakGForce: number;
  /**
   * Duración del trace, ms — diferencia entre la última y la primera
   * muestra. Típicamente ~10000ms (10s).
   */
  durationMs: number;
  /** Acelerómetro a 100 Hz, ordenado cronológicamente. */
  accelerometer: AccelSample[];
  /** GNSS samples ordenados cronológicamente. */
  gnss: GnssSample[];
  /** IO snapshots ordenados cronológicamente. */
  io: IoSnapshot[];
}

// =============================================================================
// API
// =============================================================================

/**
 * Detecta si un AVL packet contiene un Crash event (record con
 * `eventIoId === 247` y `priority === 2`). Útil para fast-path en el
 * gateway antes de invocar `extractCrashTrace` (que es más caro).
 */
export function isCrashTracePacket(packet: AvlPacket): boolean {
  return packet.records.some((r) => r.priority === 2 && r.io.eventIoId === CRASH_EVENT_AVL_ID);
}

/**
 * Extrae el Crash Trace de un AVL packet ya parseado. Retorna `null` si
 * el packet no contiene un Crash event.
 *
 * **Diseño**:
 *   - Pure function. No I/O.
 *   - Asume que el packet completo es el Crash Trace (un solo packet
 *     contiene los ~1000 acelerómetros + GNSS + IO snapshots).
 *   - El timestamp del impacto = timestamp del record con eventIoId 247.
 *   - Acelerómetro: cualquier record con IO entries para AVL 17/18/19.
 *     Cada record con los 3 ejes presentes genera UNA `AccelSample`.
 *   - GNSS: cada record genera UNA `GnssSample` con su posición.
 *   - IO snapshots: cada record genera UN `IoSnapshot` con todos sus
 *     IO entries.
 *
 *   Si el device productivo agrupa el acelerómetro en NX entries (1000
 *   muestras en un solo IO entry), este extractor solo verá la última
 *   sample. Validar contra fixture real en QA.
 */
export function extractCrashTrace(packet: AvlPacket): CrashTrace | null {
  if (!isCrashTracePacket(packet)) {
    return null;
  }

  const crashRecord = packet.records.find(
    (r) => r.priority === 2 && r.io.eventIoId === CRASH_EVENT_AVL_ID,
  );
  if (!crashRecord) {
    return null;
  }
  const crashTimestampMs = crashRecord.timestampMs;

  // Sort cronológicamente para garantizar orden estable.
  const sorted = [...packet.records].sort((a, b) => {
    if (a.timestampMs < b.timestampMs) {
      return -1;
    }
    if (a.timestampMs > b.timestampMs) {
      return 1;
    }
    return 0;
  });

  const accelerometer: AccelSample[] = [];
  const gnss: GnssSample[] = [];
  const io: IoSnapshot[] = [];

  for (const record of sorted) {
    const tMsOffset = Number(record.timestampMs - crashTimestampMs);

    const accelSample = tryExtractAccelSample(record, tMsOffset);
    if (accelSample) {
      accelerometer.push(accelSample);
    }

    // Cada record con GPS válido (satellites > 0) cuenta como GNSS sample.
    if (record.gps.satellites > 0) {
      gnss.push({
        tMsOffset,
        longitude: record.gps.longitude,
        latitude: record.gps.latitude,
        altitude: record.gps.altitude,
        speedKmh: record.gps.speedKmh,
        angle: record.gps.angle,
        satellites: record.gps.satellites,
      });
    }

    // IO snapshot: filtra los entries del acelerómetro (ya extraídos
    // como AccelSample) para no duplicar el payload.
    const nonAccelEntries = record.io.entries.filter((e) => !ACCEL_AVL_IDS.has(e.id));
    if (nonAccelEntries.length > 0) {
      io.push({ tMsOffset, entries: nonAccelEntries });
    }
  }

  const peakGForce = computePeakGForce(accelerometer);
  const durationMs = computeDurationMs(sorted);

  return {
    crashTimestampMs,
    peakGForce,
    durationMs,
    accelerometer,
    gnss,
    io,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Intenta extraer una muestra del acelerómetro de un record. Retorna
 * `null` si los 3 ejes no están todos presentes (record que no es
 * acelerómetro o que tiene info parcial).
 */
function tryExtractAccelSample(record: AvlRecord, tMsOffset: number): AccelSample | null {
  let x: number | null = null;
  let y: number | null = null;
  let z: number | null = null;

  for (const entry of record.io.entries) {
    if (typeof entry.value !== 'number') {
      continue;
    }
    const signed = toSignedInt16(entry.value);
    if (entry.id === ACCEL_AXIS_X_AVL_ID) {
      x = signed;
    } else if (entry.id === ACCEL_AXIS_Y_AVL_ID) {
      y = signed;
    } else if (entry.id === ACCEL_AXIS_Z_AVL_ID) {
      z = signed;
    }
  }

  if (x === null || y === null || z === null) {
    return null;
  }
  return { tMsOffset, xMg: x, yMg: y, zMg: z };
}

/** Convierte uint16 (entrega del codec parser) a int16 con signo. */
function toSignedInt16(value: number): number {
  return value > 0x7fff ? value - 0x10000 : value;
}

function computePeakGForce(samples: readonly AccelSample[]): number {
  let peakSqMg = 0;
  for (const s of samples) {
    const sqMg = s.xMg * s.xMg + s.yMg * s.yMg + s.zMg * s.zMg;
    if (sqMg > peakSqMg) {
      peakSqMg = sqMg;
    }
  }
  // peak en mG → dividir por 1000 para G.
  return Math.sqrt(peakSqMg) / 1000;
}

function computeDurationMs(records: readonly AvlRecord[]): number {
  if (records.length === 0) {
    return 0;
  }
  const first = records[0];
  const last = records[records.length - 1];
  if (!first || !last) {
    return 0;
  }
  // Span total del packet (cronológicamente ordenado por el caller).
  // Cubre el "5s antes + 5s después" del impacto.
  return Number(last.timestampMs - first.timestampMs);
}
