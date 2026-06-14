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
}

/**
 * Emite un ticket para abrir el SSE de `assignmentId` como `uid`. Lo guarda
 * en Redis con TTL corto. Se llama desde un endpoint YA autenticado (Bearer
 * header → firebaseAuth → userContext + resolveChatAccess), nunca por query.
 */
export async function mintStreamTicket(opts: {
  redis: Redis;
  uid: string;
  assignmentId: string;
  ttlSec?: number;
}): Promise<{ ticket: string; expiresInSec: number }> {
  const ttl = opts.ttlSec ?? TICKET_TTL_SEC;
  const ticket = randomBytes(32).toString('hex');
  const payload: TicketPayload = { uid: opts.uid, assignmentId: opts.assignmentId };
  await opts.redis.set(`${TICKET_PREFIX}${ticket}`, JSON.stringify(payload), 'EX', ttl);
  return { ticket, expiresInSec: ttl };
}

/**
 * Valida y CONSUME (single-use) un ticket. Devuelve el `uid` si el ticket
 * existe, no expiró, y su `assignmentId` coincide con el del stream; null en
 * cualquier otro caso. El borrado es atómico (GETDEL) → un ticket no puede
 * reutilizarse aunque dos requests lleguen a la vez.
 */
export async function consumeStreamTicket(opts: {
  redis: Redis;
  ticket: string;
  assignmentId: string;
}): Promise<string | null> {
  if (!opts.ticket) {
    return null;
  }
  const raw = await opts.redis.getdel(`${TICKET_PREFIX}${opts.ticket}`);
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
  return payload.uid;
}
