/**
 * Hook React que abre un EventSource al endpoint SSE del chat (P3.b) y
 * dispara un callback por cada mensaje nuevo recibido.
 *
 * Patrón:
 *   - El componente ChatPanel monta este hook con assignmentId + callback.
 *   - El callback típicamente invalida el cache de useQuery del listado
 *     o hace un fetch del mensaje nuevo y lo merge al cache.
 *   - Reconnect automático con exponential backoff (max 30s) si el SSE
 *     falla. EventSource ya hace reconnect nativo pero podemos perderlo
 *     en errores transitorios — agregamos backoff manual.
 *
 * Auth (fix-sse-ticket-auth): EventSource NO soporta headers custom, así
 * que el auth viaja en la URL. NO mandamos el Firebase ID token — se
 * filtraba EN CRUDO a Cloud Trace/Logging (telemetría de plataforma de
 * Cloud Run que ningún scrubbing de app alcanza). En su lugar:
 *   1. POST /assignments/:id/messages/stream-ticket con el Bearer header
 *      (autenticación normal, sin exponer el token en la URL) → {ticket}.
 *   2. EventSource a `...?ticket=<ticket>`. El ticket es de UN SOLO USO,
 *      TTL ~60s, scoped al assignment → su filtrado post-consumo es inocuo.
 * Cada reconnect pide un ticket nuevo (son single-use).
 */

import { useEffect, useRef } from 'react';
import { env } from '../lib/env.js';
import { firebaseAuth } from '../lib/firebase.js';
import { logger } from '../lib/logger.js';

export interface ChatStreamMessage {
  message_id: string;
  assignment_id: string;
}

export interface UseChatStreamOptions {
  assignmentId: string | null;
  /** Llamado cuando llega un mensaje nuevo via SSE. */
  onMessage: (msg: ChatStreamMessage) => void;
  /** Llamado al conectar (debug / UI "live indicator"). */
  onConnect?: () => void;
  /** Llamado al desconectar (UI "reconnecting indicator"). */
  onDisconnect?: () => void;
  /**
   * Si true, abre el stream. Si false, lo cierra. Útil para pausar
   * cuando el componente está oculto (drawer cerrado, tab inactiva).
   */
  enabled?: boolean;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useChatStream(opts: UseChatStreamOptions): void {
  const enabled = opts.enabled !== false && opts.assignmentId !== null;
  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;
  const onConnectRef = useRef(opts.onConnect);
  onConnectRef.current = opts.onConnect;
  const onDisconnectRef = useRef(opts.onDisconnect);
  onDisconnectRef.current = opts.onDisconnect;

  useEffect(() => {
    if (!enabled || !opts.assignmentId) {
      return;
    }

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const connect = async () => {
      if (cancelled) {
        return;
      }

      const user = firebaseAuth.currentUser;
      if (!user) {
        // Sin user, no hay auth posible. Reintentamos en un rato (puede
        // ser un mount antes del onAuthStateChanged firme).
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }

      // 1. Pedir un ticket efímero con el Bearer header (el token NO va en la
      //    URL — fix-sse-ticket-auth). single-use, así que se pide en cada
      //    connect/reconnect.
      let ticket: string;
      try {
        const token = await user.getIdToken();
        // Timeout duro: si Redis/el api cuelga, no dejamos el connect colgado
        // sin caer al backoff de reconnect.
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 10_000);
        let res: Response;
        try {
          res = await fetch(
            `${env.VITE_API_URL}/assignments/${opts.assignmentId}/messages/stream-ticket`,
            { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: abort.signal },
          );
        } finally {
          clearTimeout(timeout);
        }
        if (!res.ok) {
          throw new Error(`stream-ticket ${res.status}`);
        }
        ticket = ((await res.json()) as { ticket: string }).ticket;
      } catch (err) {
        if (cancelled) {
          return;
        }
        // Sin ticket no hay stream — reconnect con backoff (el realtime es
        // no-crítico; el cliente sigue refrescando por polling/useQuery).
        logger.warn({ err }, 'useChatStream: no se pudo obtener stream-ticket');
        onDisconnectRef.current?.();
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(connect, backoff);
        return;
      }
      if (cancelled) {
        return;
      }

      // 2. Abrir el EventSource con el ticket en la URL.
      const url = new URL(`${env.VITE_API_URL}/assignments/${opts.assignmentId}/messages/stream`);
      url.searchParams.set('ticket', ticket);

      eventSource = new EventSource(url.toString());

      eventSource.addEventListener('connected', () => {
        if (cancelled) {
          return;
        }
        backoff = INITIAL_BACKOFF_MS;
        onConnectRef.current?.();
      });

      eventSource.addEventListener('message', (ev) => {
        if (cancelled) {
          return;
        }
        try {
          const data = JSON.parse(ev.data) as ChatStreamMessage;
          onMessageRef.current(data);
        } catch (err) {
          logger.warn({ err }, 'useChatStream: payload no parseable');
        }
      });

      eventSource.addEventListener('heartbeat', () => {
        // No-op — el heartbeat existe solo para mantener viva la conexión
        // contra proxies que cierran idle.
      });

      eventSource.onerror = () => {
        // EventSource intenta reconnect nativo, pero si el server cerró
        // (5xx / 401 expirado), preferimos cerrar y reconnect manual con
        // backoff exponencial + token fresco.
        if (cancelled) {
          return;
        }
        eventSource?.close();
        eventSource = null;
        onDisconnectRef.current?.();
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(connect, backoff);
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      eventSource?.close();
    };
  }, [enabled, opts.assignmentId]);
}
