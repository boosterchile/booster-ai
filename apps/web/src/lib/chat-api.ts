/**
 * Wrappers tipados para los endpoints del chat (P3.a + P3.b + P3.e).
 *
 * Endpoints cubiertos:
 *   - GET /assignments/:id/messages — listar (cursor pagination)
 *   - POST /assignments/:id/messages — enviar (3 tipos: texto, foto, ubicacion)
 *   - PATCH /assignments/:id/messages/read — mark as read
 *   - POST /assignments/:id/messages/photo-upload-url — signed URL GCS PUT
 *   - POST /assignments/:id/messages/:msgId/photo-url — signed URL GCS GET
 *
 * El SSE realtime tiene su propio hook (use-chat-stream.ts) porque
 * EventSource no encaja bien con fetch.
 */

import { api } from './api-client.js';

export type ChatSenderRole = 'transportista' | 'generador_carga';
export type ChatMessageType = 'texto' | 'foto' | 'ubicacion';

export interface ChatMessage {
  id: string;
  sender_empresa_id: string;
  sender_user_id: string;
  sender_role: ChatSenderRole;
  sender_name: string | null;
  type: ChatMessageType;
  text: string | null;
  photo_gcs_uri: string | null;
  location_lat: number | null;
  location_lng: number | null;
  read_at: string | null;
  created_at: string;
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
  next_cursor: string | null;
  viewer_role: ChatSenderRole;
}

export async function fetchChatMessages(opts: {
  assignmentId: string;
  cursor?: string;
  limit?: number;
}): Promise<ChatMessagesResponse> {
  const params = new URLSearchParams();
  if (opts.cursor) {
    params.set('cursor', opts.cursor);
  }
  if (opts.limit) {
    params.set('limit', String(opts.limit));
  }
  const qs = params.toString();
  return await api.get<ChatMessagesResponse>(
    `/assignments/${opts.assignmentId}/messages${qs ? `?${qs}` : ''}`,
  );
}

export type SendMessageBody =
  | { type: 'texto'; text: string }
  | { type: 'foto'; photo_gcs_uri: string }
  | { type: 'ubicacion'; location_lat: number; location_lng: number };

export interface SendMessageResponse {
  message: ChatMessage;
}

export async function sendChatMessage(opts: {
  assignmentId: string;
  body: SendMessageBody;
}): Promise<SendMessageResponse> {
  return await api.post<SendMessageResponse>(
    `/assignments/${opts.assignmentId}/messages`,
    opts.body,
  );
}

export interface MarkReadResponse {
  marked_read: number;
}

export async function markChatRead(assignmentId: string): Promise<MarkReadResponse> {
  return await api.patch<MarkReadResponse>(`/assignments/${assignmentId}/messages/read`);
}

export interface PhotoUploadUrlResponse {
  upload_url: string;
  gcs_uri: string;
  expires_in_seconds: number;
  required_content_type: string;
}

export async function requestPhotoUploadUrl(opts: {
  assignmentId: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<PhotoUploadUrlResponse> {
  return await api.post<PhotoUploadUrlResponse>(
    `/assignments/${opts.assignmentId}/messages/photo-upload-url`,
    { content_type: opts.contentType },
  );
}

/**
 * Sube una foto al GCS via signed URL. PUT directo desde el browser, sin
 * proxiar por el api. Retorna el gs:// URI que el caller después manda
 * en el POST /messages como photo_gcs_uri.
 */
export async function uploadChatPhoto(opts: {
  assignmentId: string;
  file: File;
}): Promise<{ gcsUri: string }> {
  const contentType = opts.file.type;
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') {
    throw new Error(`Tipo de imagen no soportado: ${contentType}`);
  }

  const { upload_url, gcs_uri } = await requestPhotoUploadUrl({
    assignmentId: opts.assignmentId,
    contentType,
  });

  // PUT directo a GCS. Header Content-Type debe matchear lo que firmamos.
  const res = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: opts.file,
  });
  if (!res.ok) {
    throw new Error(`Upload a GCS falló: ${res.status}`);
  }
  return { gcsUri: gcs_uri };
}

/**
 * Pide signed URL READ para descargar/visualizar una foto privada del chat.
 * El backend valida que el caller pertenezca al chat y que el mensaje
 * sea efectivamente una foto. TTL 5 min — el caller decide si cachea o
 * pide otra (la UI usa useQuery con staleTime ~4min para evitar refetch).
 */
export interface PhotoDownloadUrlResponse {
  download_url: string;
  expires_in_seconds: number;
}

export async function fetchPhotoDownloadUrl(opts: {
  assignmentId: string;
  messageId: string;
}): Promise<PhotoDownloadUrlResponse> {
  return await api.post<PhotoDownloadUrlResponse>(
    `/assignments/${opts.assignmentId}/messages/${opts.messageId}/photo-url`,
    {},
  );
}

/**
 * Wrapper para mandar mensaje 'foto' con upload directo en 1 sola llamada
 * desde la UI. Hace upload + POST mensaje.
 */
export async function sendPhotoMessage(opts: {
  assignmentId: string;
  file: File;
}): Promise<SendMessageResponse> {
  const { gcsUri } = await uploadChatPhoto(opts);
  return await sendChatMessage({
    assignmentId: opts.assignmentId,
    body: { type: 'foto', photo_gcs_uri: gcsUri },
  });
}

/**
 * Wrapper que pide la ubicación del browser y manda el mensaje.
 */
export async function sendLocationMessage(assignmentId: string): Promise<SendMessageResponse> {
  if (!('geolocation' in navigator)) {
    throw new Error('Geolocalización no soportada en este browser');
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
    });
  });
  return await sendChatMessage({
    assignmentId,
    body: {
      type: 'ubicacion',
      location_lat: position.coords.latitude,
      location_lng: position.coords.longitude,
    },
  });
}
