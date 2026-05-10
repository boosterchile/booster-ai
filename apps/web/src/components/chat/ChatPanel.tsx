/**
 * ChatPanel — UI completa del chat shipper↔transportista por assignment.
 *
 * Layout (mobile-first, también funciona como drawer en desktop):
 *
 *   ┌──────────────────────────────────────┐
 *   │ ← [Header con título + live status]  │
 *   ├──────────────────────────────────────┤
 *   │                                      │
 *   │  [Mensajes — scroll desde el fondo]  │
 *   │                                      │
 *   │  [otro lado]                         │
 *   │                          [yo]        │
 *   │                                      │
 *   │  [Cargar más viejos] (si hay)        │
 *   ├──────────────────────────────────────┤
 *   │ [📷] [📍] [_____ texto _____] [➤]    │
 *   └──────────────────────────────────────┘
 *
 * Props:
 *   - assignmentId: required.
 *   - onClose: para drawer modo (X en el header).
 *   - title: típicamente "Chat con [Nombre del otro lado]".
 *   - subtitle: opcional, tipo "Carga BOO-XYZ123 · En ruta".
 *   - readOnly: si true, oculta el input footer (chat de viaje cerrado).
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Loader2, MapPin, RefreshCw, Send, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useChatMessages } from '../../hooks/use-chat-messages.js';
import {
  type ChatMessage,
  fetchPhotoDownloadUrl,
  sendChatMessage,
  sendLocationMessage,
  sendPhotoMessage,
} from '../../lib/chat-api.js';
import { logger } from '../../lib/logger.js';
import { VehicleMap } from '../map/VehicleMap.js';

interface ChatPanelProps {
  assignmentId: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  /** Si true, deshabilita el input. Para chats de viajes cerrados. */
  readOnly?: boolean;
}

export function ChatPanel({
  assignmentId,
  title = 'Chat',
  subtitle,
  onClose,
  readOnly = false,
}: ChatPanelProps) {
  const { messages, viewerRole, isLoading, error, hasMore, loadMore, isLive, isLoadingMore } =
    useChatMessages(assignmentId);

  // Mensajes vienen DESC del server. Para chat estilo WhatsApp queremos
  // ASC visual con scroll desde abajo. Reverse la lista local.
  const messagesAsc = [...messages].reverse();

  return (
    <div className="flex h-full w-full flex-col bg-neutral-50">
      {/* Header */}
      <header className="flex items-center justify-between border-neutral-200 border-b bg-white px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
              aria-label="Cerrar chat"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-neutral-900">{title}</h2>
            {subtitle && <p className="truncate text-neutral-500 text-xs">{subtitle}</p>}
          </div>
          <span
            className={`flex items-center gap-1 text-xs ${
              isLive ? 'text-emerald-600' : 'text-neutral-400'
            }`}
            aria-live="polite"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-neutral-400'}`}
              aria-hidden
            />
            {isLive ? 'En vivo' : 'Reconectando…'}
          </span>
        </div>
      </header>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto" id="chat-messages-scroll">
        {isLoading && <p className="p-6 text-center text-neutral-500">Cargando mensajes…</p>}
        {error ? (
          <p className="p-6 text-center text-danger-700">No pudimos cargar los mensajes.</p>
        ) : null}
        {!isLoading && !error && messagesAsc.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="font-medium text-neutral-900">Sin mensajes todavía</p>
            <p className="mt-1 text-neutral-600 text-sm">
              {readOnly ? 'Este chat ya está cerrado.' : 'Empezá la conversación con el otro lado.'}
            </p>
          </div>
        )}

        {messagesAsc.length > 0 && (
          <div className="flex flex-col gap-2 p-4">
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="mx-auto flex items-center gap-1 self-center rounded-full border border-neutral-300 bg-white px-3 py-1 text-neutral-600 text-xs hover:bg-neutral-50 disabled:opacity-60"
              >
                {isLoadingMore ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3 w-3" aria-hidden />
                )}
                {isLoadingMore ? 'Cargando…' : 'Cargar más viejos'}
              </button>
            )}
            {messagesAsc.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isMine={viewerRole === msg.sender_role}
                assignmentId={assignmentId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer composer */}
      {!readOnly && <ChatComposer assignmentId={assignmentId} />}
    </div>
  );
}

// =============================================================================
// MessageBubble — render por tipo
// =============================================================================

function MessageBubble({
  message,
  isMine,
  assignmentId,
}: { message: ChatMessage; isMine: boolean; assignmentId: string }) {
  return (
    <div className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
      {!isMine && message.sender_name && (
        <span className="px-2 text-neutral-500 text-xs">{message.sender_name}</span>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 ${
          isMine
            ? 'rounded-br-sm bg-primary-600 text-white'
            : 'rounded-bl-sm bg-white text-neutral-900 shadow-sm'
        }`}
      >
        <MessageContent message={message} isMine={isMine} assignmentId={assignmentId} />
      </div>
      <span className="px-2 text-[10px] text-neutral-400">
        {formatTime(message.created_at)}
        {isMine && message.read_at && ' · Leído'}
      </span>
    </div>
  );
}

function MessageContent({
  message,
  isMine,
  assignmentId,
}: { message: ChatMessage; isMine: boolean; assignmentId: string }) {
  if (message.type === 'texto' && message.text) {
    return <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>;
  }
  if (message.type === 'foto' && message.photo_gcs_uri) {
    return <PhotoMessage assignmentId={assignmentId} messageId={message.id} isMine={isMine} />;
  }
  if (
    message.type === 'ubicacion' &&
    message.location_lat !== null &&
    message.location_lng !== null
  ) {
    return (
      <div className="flex flex-col gap-2">
        <div
          className={`flex items-center gap-2 text-xs ${isMine ? 'text-white' : 'text-neutral-700'}`}
        >
          <MapPin className="h-4 w-4" aria-hidden />
          <span>Ubicación compartida</span>
        </div>
        <div className="overflow-hidden rounded-md">
          <VehicleMap
            latitude={message.location_lat}
            longitude={message.location_lng}
            plate=""
            height={160}
            zoom={15}
          />
        </div>
        <a
          href={`https://www.google.com/maps?q=${message.location_lat},${message.location_lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-[10px] underline ${isMine ? 'text-primary-100' : 'text-primary-600'}`}
        >
          Abrir en Google Maps
        </a>
      </div>
    );
  }
  return <p className="text-neutral-400 text-xs">Mensaje sin contenido</p>;
}

// =============================================================================
// PhotoMessage — fetch signed URL + render <img>
// =============================================================================
//
// Las fotos del chat son privadas en GCS (uniform bucket-level access). Para
// renderizar el <img>, pedimos un signed URL READ al backend. El TTL es 5
// min, así que cacheamos con staleTime 4 min y refetch al expirar (la UI
// se mantiene viva si el user deja el chat abierto mucho rato).
//
// Click en la imagen abre la versión grande en una pestaña nueva. No
// hacemos lightbox v1 — agregar después si UX lo pide.
function PhotoMessage({
  assignmentId,
  messageId,
  isMine,
}: { assignmentId: string; messageId: string; isMine: boolean }) {
  const photoQ = useQuery({
    queryKey: ['chat-photo-url', assignmentId, messageId],
    queryFn: () => fetchPhotoDownloadUrl({ assignmentId, messageId }),
    staleTime: 4 * 60 * 1000, // 4 min — un minuto antes del TTL backend
    refetchOnWindowFocus: false,
    retry: 1,
  });

  if (photoQ.isLoading) {
    return (
      <div
        className={`flex items-center gap-2 text-xs ${isMine ? 'text-white' : 'text-neutral-700'}`}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>Cargando foto…</span>
      </div>
    );
  }
  if (photoQ.error || !photoQ.data) {
    return (
      <div
        className={`flex items-center gap-2 text-xs ${isMine ? 'text-white' : 'text-neutral-700'}`}
      >
        <Camera className="h-4 w-4" aria-hidden />
        <span>No se pudo cargar la foto</span>
      </div>
    );
  }
  return (
    <a
      href={photoQ.data.download_url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-md"
    >
      <img
        src={photoQ.data.download_url}
        alt="Foto adjunta del chat"
        className="max-h-64 w-full max-w-xs object-cover"
        loading="lazy"
      />
    </a>
  );
}

// =============================================================================
// ChatComposer — input footer
// =============================================================================

function ChatComposer({ assignmentId }: { assignmentId: string }) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendTextM = useMutation({
    mutationFn: (textValue: string) =>
      sendChatMessage({
        assignmentId,
        body: { type: 'texto', text: textValue },
      }),
    onSuccess: () => {
      setText('');
    },
  });

  const sendPhotoM = useMutation({
    mutationFn: (file: File) => sendPhotoMessage({ assignmentId, file }),
    onError: (err) => {
      logger.error({ err }, 'sendPhotoMessage error');
      window.alert('No se pudo enviar la foto. Inténtalo de nuevo.');
    },
  });

  const sendLocationM = useMutation({
    mutationFn: () => sendLocationMessage(assignmentId),
    onError: (err) => {
      logger.error({ err }, 'sendLocationMessage error');
      window.alert('No pudimos obtener tu ubicación. Verifica los permisos del navegador.');
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sendTextM.isPending) {
      return;
    }
    sendTextM.mutate(trimmed);
  };

  const onPhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    sendPhotoM.mutate(file);
    // Reset input para permitir seleccionar la misma foto otra vez si falló.
    e.target.value = '';
  };

  const isSending = sendTextM.isPending || sendPhotoM.isPending || sendLocationM.isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-end gap-2 border-neutral-200 border-t bg-white p-3"
    >
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isSending}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-60"
        aria-label="Adjuntar foto"
      >
        <Camera className="h-5 w-5" aria-hidden />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onPhotoChange}
      />
      <button
        type="button"
        onClick={() => sendLocationM.mutate()}
        disabled={isSending}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-60"
        aria-label="Compartir ubicación"
      >
        <MapPin className="h-5 w-5" aria-hidden />
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const form = e.currentTarget.form;
            if (form) {
              form.requestSubmit();
            }
          }
        }}
        placeholder="Escribe un mensaje…"
        rows={1}
        maxLength={4000}
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!text.trim() || isSending}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        aria-label="Enviar"
      >
        {sendTextM.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Send className="h-5 w-5" aria-hidden />
        )}
      </button>
    </form>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
