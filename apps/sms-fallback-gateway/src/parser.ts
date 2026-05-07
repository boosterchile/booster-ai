/**
 * Parser del SMS fallback body (Wave 2 Track B4).
 *
 * El FMC150 manda un SMS al MSISDN Twilio configurado cuando un evento
 * Panic ocurre y GPRS está caído. Formato canónico Booster:
 *
 *   BSTR|imei|datetime|flat,flon|spd|val|io_id
 *
 * Ejemplo:
 *   BSTR|356307042441013|20260506T142530|-33.456900,-70.648300|65|1|247
 *
 * Campos:
 *   - BSTR        : magic prefix (literal). Permite filtrar SMS de otros
 *                   devices o spam.
 *   - imei        : 15 dígitos del device.
 *   - datetime    : YYYYMMDDTHHmmss UTC (compact ISO sin separators
 *                   intermedios para reducir bytes — los SMS tienen
 *                   un límite duro de 140 bytes / 160 chars).
 *   - flat,flon   : decimal degrees, signed (positivo norte/este). Hasta
 *                   6 decimales para precisión de ~10cm.
 *   - spd         : velocidad en km/h, entero.
 *   - val         : valor RAW del IO event (1 = crash detected, etc.).
 *   - io_id       : AVL ID del evento (247=Crash, 252=Unplug, 318=GNSS
 *                   Jamming).
 *
 * Diseño:
 *   - Pure function. No I/O.
 *   - Tolerante: rechaza el mensaje sin tirar (retorna `null` con
 *     razón loggeable). Caller decide si responder 200 (descartar
 *     spam silencioso) o 400 (Twilio retry).
 */

export interface SmsFallbackPayload {
  imei: string;
  /** Epoch ms del datetime parseado. */
  timestampMs: number;
  latitude: number;
  longitude: number;
  speedKmh: number;
  /** Valor RAW del IO event. */
  rawValue: number;
  /** AVL ID del evento (247=Crash, 252=Unplug, 318=GNSS Jamming). */
  avlId: number;
}

export type ParseError =
  | 'missing_magic'
  | 'wrong_field_count'
  | 'invalid_imei'
  | 'invalid_datetime'
  | 'invalid_coords'
  | 'invalid_speed'
  | 'invalid_value'
  | 'invalid_avl_id';

export type ParseResult =
  | { ok: true; payload: SmsFallbackPayload }
  | { ok: false; error: ParseError; raw: string };

const MAGIC = 'BSTR';
const FIELD_COUNT = 7;

/** AVL IDs aceptados como válidos para SMS fallback. */
const VALID_AVL_IDS: ReadonlySet<number> = new Set([247, 252, 318]);

export function parseSmsFallback(body: string): ParseResult {
  const trimmed = body.trim();
  const fields = trimmed.split('|');

  if (fields[0] !== MAGIC) {
    return { ok: false, error: 'missing_magic', raw: trimmed };
  }
  if (fields.length !== FIELD_COUNT) {
    return { ok: false, error: 'wrong_field_count', raw: trimmed };
  }

  const [, imei, datetimeStr, coordsStr, speedStr, valueStr, avlIdStr] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  if (!/^\d{8,20}$/.test(imei)) {
    return { ok: false, error: 'invalid_imei', raw: trimmed };
  }

  const timestampMs = parseDateTime(datetimeStr);
  if (timestampMs === null) {
    return { ok: false, error: 'invalid_datetime', raw: trimmed };
  }

  const coords = parseCoords(coordsStr);
  if (coords === null) {
    return { ok: false, error: 'invalid_coords', raw: trimmed };
  }

  const speedKmh = Number.parseInt(speedStr, 10);
  if (!Number.isFinite(speedKmh) || speedKmh < 0 || speedKmh > 500) {
    return { ok: false, error: 'invalid_speed', raw: trimmed };
  }

  const rawValue = Number.parseInt(valueStr, 10);
  if (!Number.isFinite(rawValue) || rawValue < -32768 || rawValue > 65535) {
    return { ok: false, error: 'invalid_value', raw: trimmed };
  }

  const avlId = Number.parseInt(avlIdStr, 10);
  if (!Number.isFinite(avlId) || !VALID_AVL_IDS.has(avlId)) {
    return { ok: false, error: 'invalid_avl_id', raw: trimmed };
  }

  return {
    ok: true,
    payload: {
      imei,
      timestampMs,
      latitude: coords.lat,
      longitude: coords.lng,
      speedKmh,
      rawValue,
      avlId,
    },
  };
}

/**
 * Parsea YYYYMMDDTHHmmss en epoch ms UTC. Retorna `null` si el formato
 * es inválido o la fecha no existe.
 */
function parseDateTime(s: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) {
    return null;
  }
  const [, y, mo, d, h, mi, se] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const ts = Date.UTC(
    Number.parseInt(y, 10),
    Number.parseInt(mo, 10) - 1,
    Number.parseInt(d, 10),
    Number.parseInt(h, 10),
    Number.parseInt(mi, 10),
    Number.parseInt(se, 10),
  );
  if (Number.isNaN(ts)) {
    return null;
  }
  // Validación adicional: si el Date construido difiere del input,
  // significa que el día/mes era inválido (ej. 20260230 → 20260302).
  const round = new Date(ts);
  if (
    round.getUTCFullYear() !== Number.parseInt(y, 10) ||
    round.getUTCMonth() + 1 !== Number.parseInt(mo, 10) ||
    round.getUTCDate() !== Number.parseInt(d, 10)
  ) {
    return null;
  }
  return ts;
}

function parseCoords(s: string): { lat: number; lng: number } | null {
  const parts = s.split(',');
  if (parts.length !== 2) {
    return null;
  }
  const [latStr, lngStr] = parts as [string, string];
  const lat = Number.parseFloat(latStr);
  const lng = Number.parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}
