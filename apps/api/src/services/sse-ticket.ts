import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Tickets efímeros de un solo uso para autenticar el SSE de chat
 * (`GET /assignments/:id/messages/stream`).
 *
 * Por qué (spec fix-sse-ticket-auth, hallazgo ALTO 2026-06-14): EventSource
 * del browser no soporta headers, así que el auth viaja en la URL. Pasar el
 * Firebase ID token por `?auth=` lo filtraba EN CRUDO a Cloud Trace (span de
 * plataforma de Cloud Run) y a Cloud Logging (httpRequest.requestUrl) —
 * telemetría de plataforma que ningún scrubbing de app alcanza. Solución: lo
 * que viaja en la URL es ESTE ticket — random ≥128 bits, TTL corto, un solo
 * uso, scoped al assignment — cuyo filtrado post-consumo es inocuo.
 */

const TICKET_PREFIX = 'sse-ticket:';
const TICKET_TTL_SEC = 60;

interface TicketPayload {
  uid: string;
  assignmentId: string;
  /**
   * Snapshot del claim `is_demo` al momento del mint. Se restituye en
   * `firebaseClaims.custom` al consumir, para que el SSE corra el mismo
   * enforcement de demo-expiry que un request por header (sin esto, una
   * sesión por-ticket se veía como NO-demo y saltaba demoExpires — review
   * 2026-06-14). El expires_at/disabled real lo resuelve demoExpires por uid.
   */
  isDemo: boolean;
}

export interface ConsumedTicket {
  uid: string;
  isDemo: boolean;
}

/**
 * Emite un ticket para abrir el SSE de `assignmentId` como `uid`. Lo guarda
 * en Redis con TTL corto. Se llama desde un endpoint YA autenticado (Bearer
 * header → firebaseAuth → userContext + resolveChatAccess), nunca por query.
 * Fail-closed: si Redis falla al persistir, lanza (el caller responde 503).
 */
export async function mintStreamTicket(opts: {
  redis: Redis;
  uid: string;
  assignmentId: string;
  isDemo: boolean;
  ttlSec?: number;
}): Promise<{ ticket: string; expiresInSec: number }> {
  const ttl = opts.ttlSec ?? TICKET_TTL_SEC;
  const ticket = randomBytes(32).toString('hex');
  const payload: TicketPayload = {
    uid: opts.uid,
    assignmentId: opts.assignmentId,
    isDemo: opts.isDemo,
  };
  await opts.redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(payload), 'EX', ttl);
  return { ticket, expiresInSec: ttl };
}

/**
 * Valida y CONSUME (single-use) un ticket. Devuelve {uid, isDemo} si el
 * ticket existe, no expiró, y su `assignmentId` coincide con el del stream;
 * null en cualquier otro caso (incluido Redis caído → fail-closed). El
 * borrado es atómico (GETDEL) → un ticket no puede reutilizarse aunque dos
 * requests lleguen a la vez.
 */
export async function consumeStreamTicket(opts: {
  redis: Redis;
  ticket: string;
  assignmentId: string;
}): Promise<ConsumedTicket | null> {
  if (!opts.ticket) {
    return null;
  }
  let raw: string | null;
  try {
    raw = await opts.redis.getdel(`${TICKET_PREFIX}${opts.ticket}`);
  } catch {
    // Redis caído → fail-closed (sin ticket válido → 401, no stream).
    return null;
  }
  if (!raw) {
    return null;
  }
  let payload: TicketPayload;
  try {
    payload = JSON.parse(raw) as TicketPayload;
  } catch {
    return null;
  }
  // Scope: un ticket emitido para el assignment A no sirve para el stream de
  // B (defensa en profundidad; resolveChatAccess re-autoriza igual aguas abajo).
  if (payload.assignmentId !== opts.assignmentId) {
    return null;
  }
  return { uid: payload.uid, isDemo: payload.isDemo === true };
}
