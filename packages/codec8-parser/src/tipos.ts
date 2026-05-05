/**
 * Tipos del protocolo Teltonika Codec 8 / Codec 8 Extended.
 *
 * Codec 8 es el protocolo binario que usan los devices Teltonika
 * (FMC150, FMB920, FMC130, etc.) para mandar datos AVL via TCP al
 * server. Codec 8 Extended (8E) es la variante con IO IDs de 2 bytes
 * en lugar de 1, para soportar más de 255 IDs distintos.
 *
 * Spec pública oficial: https://wiki.teltonika-gps.com/view/Codec
 *
 * Diseño del package:
 *   - PURO: ningún I/O. Funciones reciben Buffer, devuelven objetos.
 *   - AGNÓSTICO de IO IDs: el parser entrega `{id, value, byteSize}`,
 *     no interpreta semántica. Un módulo separado (catálogo IO)
 *     traduce IDs conocidos a campos típicos (ignición, RPM, etc.).
 *     Esto permite que devices configurados con IDs distintos sigan
 *     funcionando sin rebuild.
 */

/**
 * IO entry leído de un AVL data record. El parser nunca interpreta
 * semántica del id ni del valor — esa responsabilidad es de quien
 * orquesta (apps/telemetry-processor + tabla de catálogo IO).
 */
export interface IoEntry {
  /** ID del IO Parameter (ver spec Teltonika por modelo). */
  id: number;
  /**
   * Valor RAW. uint8 / uint16 / uint32 / uint64 (BigInt para >32 bits)
   * o Buffer para los IO de longitud variable (Codec 8E NX).
   */
  value: number | bigint | Buffer;
  /**
   * Tamaño del valor en bytes según el grupo donde apareció (1/2/4/8)
   * o null si vino del grupo NX (variable, solo Codec 8E).
   */
  byteSize: 1 | 2 | 4 | 8 | null;
}

/**
 * Sección IO de un AVL data record (post-parse).
 */
export interface IoSection {
  /**
   * Event IO ID — el ID que disparó el record (ej. ignición ON, alarma
   * de exceso de velocidad). 0 = record periódico (no event-triggered).
   */
  eventIoId: number;
  /** Total de IO entries (suma de N1+N2+N4+N8 [+NX]). */
  totalIo: number;
  /** Lista de IO entries en orden de aparición (no se reordena). */
  entries: IoEntry[];
}

/**
 * Sub-sección GPS (15 bytes después del timestamp+priority).
 */
export interface GpsElement {
  /** Longitud, grados decimales (negativo = oeste). */
  longitude: number;
  /** Latitud, grados decimales (negativo = sur). */
  latitude: number;
  /** Altitud sobre el nivel del mar, metros. Puede ser negativo. */
  altitude: number;
  /** Rumbo, grados 0-360 (0 = norte, sentido horario). */
  angle: number;
  /** Cantidad de satélites GNSS visibles. 0 si no hay fix. */
  satellites: number;
  /** Velocidad sobre tierra, km/h. */
  speedKmh: number;
}

/**
 * Un único AVL data record (un punto de telemetría).
 */
export interface AvlRecord {
  /** Timestamp del fix en epoch ms (UTC). */
  timestampMs: bigint;
  /** Prioridad: 0=low (periódico), 1=high (event), 2=panic (alarma SOS). */
  priority: 0 | 1 | 2;
  gps: GpsElement;
  io: IoSection;
}

/**
 * Resultado del parse de un paquete AVL completo.
 */
export interface AvlPacket {
  /** Codec usado: 8 = Codec 8 (1B IDs), 142 = Codec 8 Extended (0x8E, 2B IDs). */
  codecId: 8 | 142;
  /**
   * Número de records en el paquete (Number of Data 1, ECO al final
   * del data field). El gateway debe ACK con este número en BE 4B
   * para que el device borre los records de su buffer interno.
   */
  recordCount: number;
  /** Records parseados. */
  records: AvlRecord[];
}

/**
 * Resultado del parse del IMEI handshake (primer paquete del device
 * tras conectar TCP).
 */
export interface ImeiHandshake {
  /** IMEI del device (15 dígitos típicamente, ASCII). */
  imei: string;
}

/**
 * Errores tipados del parser. El gateway puede convertirlos a códigos
 * de log + cierre de conexión con metadata.
 */
export class CodecParseError extends Error {
  constructor(
    message: string,
    public readonly offset?: number,
  ) {
    super(message);
    this.name = 'CodecParseError';
  }
}

export class CodecCrcError extends CodecParseError {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `CRC-16/IBM mismatch: expected 0x${expected.toString(16).padStart(4, '0')}, got 0x${actual.toString(16).padStart(4, '0')}`,
    );
    this.name = 'CodecCrcError';
  }
}
