/**
 * Hook que combina:
 *   - useInfiniteQuery para paginación (cursor) con `react-query`.
 *   - useChatStream (SSE) para empujar mensajes nuevos al cache.
 *   - markChatRead automático al recibir mensajes del otro lado.
 *
 * Uso típico desde ChatPanel:
 *
 *   const {
 *     messages,            // ChatMessage[] ordenados desc por created_at
 *     viewerRole,          // 'shipper' | 'carrier' resuelto por el server
 *     isLoading,
 *     error,
 *     hasMore,
 *     loadMore,            // () => void — paginar más viejos
 *     isLive,              // boolean — SSE conectado ahora mismo
 *   } = useChatMessages(assignmentId, { enabled: drawerOpen });
 *
 * Ordenamiento: el hook devuelve mensajes en orden DESC (más nuevo
 * primero) — la UI típicamente los renderiza ASC con flex-col-reverse y
 * scroll desde el fondo (chat estilo WhatsApp).
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  type ChatMessage,
  type ChatMessagesResponse,
  type ChatSenderRole,
  fetchChatMessages,
  markChatRead,
} from '../lib/chat-api.js';
import { useChatStream } from './use-chat-stream.js';

interface UseChatMessagesOptions {
  /**
   * Si false, no abre el SSE ni hace fetch (drawer cerrado / tab oculta).
   * Default true.
   */
  enabled?: boolean;
}

interface UseChatMessagesResult {
  messages: ChatMessage[];
  viewerRole: ChatSenderRole | null;
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  isLive: boolean;
  isLoadingMore: boolean;
}

const PAGE_SIZE = 50;

export function useChatMessages(
  assignmentId: string,
  options: UseChatMessagesOptions = {},
): UseChatMessagesResult {
  const enabled = options.enabled !== false;
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(false);

  const queryKey = ['chat-messages', assignmentId];

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchChatMessages({
        assignmentId,
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage: ChatMessagesResponse) => lastPage.next_cursor ?? undefined,
  });

  // Mark-as-read mutation. Solo importa la parte fire-and-forget; no
  // tocamos cache porque el server respeta la semántica de "los del otro
  // lado", y si lo hacemos local-first podríamos marcar de menos.
  const markReadM = useMutation({
    mutationFn: () => markChatRead(assignmentId),
  });

  // Aplanar pages en orden desc (más nuevo primero — server ya devuelve
  // así por desc(created_at)). Cada page ya viene en orden desc
  // internamente.
  const messages = query.data?.pages.flatMap((p) => p.messages) ?? [];
  const viewerRole = query.data?.pages[0]?.viewer_role ?? null;

  // SSE realtime: cuando llega un mensaje nuevo, refetch del primer page
  // para que aparezca arriba. Es más simple que mergear el mensaje
  // individual al cache (que requeriría fetch del mensaje por ID, ahora
  // los endpoints solo paginan).
  useChatStream({
    assignmentId: enabled ? assignmentId : null,
    onMessage: (msg) => {
      // Invalidate solo la primera page (mensajes recientes); las viejas
      // están en cache y no cambiaron.
      void queryClient.invalidateQueries({ queryKey });
      // Si el mensaje es del otro lado, marcar como leído inmediato.
      // Pero necesitamos saber el viewerRole — lo tomamos del primer
      // page actual.
      const currentViewerRole = queryClient.getQueryData<{ pages: ChatMessagesResponse[] }>(
        queryKey,
      )?.pages[0]?.viewer_role;
      if (currentViewerRole) {
        // Llegó un mensaje nuevo — el server no nos dice el sender role
        // sin fetch. Si es del otro lado, mark-read; si es nuestro,
        // skipeamos (el server marca read solo del otro lado igual).
        markReadM.mutate();
      }
      // Suprimir warn de unused.
      void msg;
    },
    onConnect: () => setIsLive(true),
    onDisconnect: () => setIsLive(false),
    enabled,
  });

  // Mark-as-read inicial cuando se abre el chat. Sin esto, los unread
  // de sesiones anteriores quedarían colgados.
  const initialMarkRef = useRef(false);
  useEffect(() => {
    if (!enabled || initialMarkRef.current) {
      return;
    }
    if (query.data && query.data.pages.length > 0) {
      initialMarkRef.current = true;
      markReadM.mutate();
    }
  }, [enabled, query.data, markReadM]);

  return {
    messages,
    viewerRole,
    isLoading: query.isLoading,
    error: query.error,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    isLive,
    isLoadingMore: query.isFetchingNextPage,
  };
}
