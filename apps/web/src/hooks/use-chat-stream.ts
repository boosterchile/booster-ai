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
 * Auth: el endpoint SSE requiere Firebase ID token. EventSource NO
 * soporta headers custom, así que el token va como query param. El
 * server lee ?auth=<token> en el middleware especial. Trade-off: el
 * token aparece en logs server. Mitigado por:
 *   - Tokens Firebase tienen TTL 1h.
 *   - URL es HTTPS only.
 *   - El uso es interno (no compartido).
 *
 * Si en el futuro queremos eliminar este trade-off, migrar a WebSocket
 * (donde sí podemos mandar headers en el handshake) o a fetch streaming
 * con ReadableStream (no soportado en todos los browsers).
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

      // Firebase token para auth — va como query param porque EventSource
      // no soporta headers.
      const user = firebaseAuth.currentUser;
      if (!user) {
        // Sin user, no hay auth posible. Reintentamos en un rato (puede
        // ser un mount antes del onAuthStateChanged firme).
        reconnectTimer = setTimeout(connect, 2000);
        return;
      }
      const token = await user.getIdToken();

      const url = new URL(`${env.VITE_API_URL}/assignments/${opts.assignmentId}/messages/stream`);
      url.searchParams.set('auth', token);

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
