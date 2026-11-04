import { env } from './env.js';
import { firebaseAuth } from './firebase.js';

/**
 * Cliente HTTP para hablar con apps/api. Auto-injecta:
 *   - Authorization: Bearer <Firebase ID token>
 *   - X-Empresa-Id: <UUID>  si está seteado en localStorage
 *
 * El token Firebase se refresca con `getIdToken(true)` cuando está cerca
 * de expirar (la lib lo maneja). NO cachear manualmente.
 *
 * Uso:
 *   const me = await api.get<MeResponse>('/me');
 *   const trip = await api.post('/trip-requests', { origin: '...', ... });
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly details: unknown,
    message?: string,
  ) {
    super(message ?? `API error ${status}${code ? ` (${code})` : ''}`);
    this.name = 'ApiError';
  }
}

const ACTIVE_EMPRESA_KEY = 'booster.activeEmpresaId';

export function getActiveEmpresaId(): string | null {
  return localStorage.getItem(ACTIVE_EMPRESA_KEY);
}

const activeEmpresaListeners = new Set<() => void>();

/**
 * Avisa cuando cambia la empresa activa. Lo consume `useActiveEmpresaId`
 * (`lib/empresa-activa.ts`) para que las claves de TanStack Query cambien
 * en el mismo render en que cambia el header.
 */
export function subscribeActiveEmpresaId(listener: () => void): () => void {
  activeEmpresaListeners.add(listener);
  return () => {
    activeEmpresaListeners.delete(listener);
  };
}

export function setActiveEmpresaId(empresaId: string | null): void {
  if (empresaId === null) {
    localStorage.removeItem(ACTIVE_EMPRESA_KEY);
  } else {
    localStorage.setItem(ACTIVE_EMPRESA_KEY, empresaId);
  }
  for (const listener of activeEmpresaListeners) {
    listener();
  }
}

async function buildHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra);

  const user = firebaseAuth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Un header explícito gana: las queries de la empresa activa lo fijan desde
  // su propia clave (`empresaInit`), para que la caché y el request no puedan
  // referirse a empresas distintas.
  if (!headers.has('X-Empresa-Id')) {
    const activeEmpresaId = getActiveEmpresaId();
    if (activeEmpresaId) {
      headers.set('X-Empresa-Id', activeEmpresaId);
    }
  }

  return headers;
}

/**
 * zValidator (Hono) responde 400 con `{ error: ZodError }`. El primer issue
 * se muestra como `path: message` para que la UI no quede en «400».
 */
function messageFromFirstZodIssue(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return undefined;
  }
  const { error } = payload;
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return undefined;
  }
  const { issues } = error;
  if (!Array.isArray(issues)) {
    return undefined;
  }
  const first = issues[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) {
    return undefined;
  }
  if (typeof first.message !== 'string' || first.message.length === 0) {
    return undefined;
  }
  const path = zodIssuePath(first);
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}

function zodIssuePath(issue: object): string {
  if (!('path' in issue) || !Array.isArray(issue.path)) {
    return '';
  }
  const parts: string[] = [];
  for (const segment of issue.path) {
    if (typeof segment === 'string' || typeof segment === 'number') {
      parts.push(String(segment));
    }
  }
  return parts.join('.');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
  asForm = false,
): Promise<T> {
  const url = `${env.VITE_API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = await buildHeaders(init?.headers);
  // Content-Type SOLO cuando hay cuerpo JSON. Mandarlo sin cuerpo hacía que el
  // validador json del API intentara parsear un body vacío → «Malformed JSON»
  // (400) que el onError volvía 500 (confirmar-recogida, 2026-09-14).
  // FormData: el browser pone multipart + boundary; no lo pises.
  if (body !== undefined && !asForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Construido como variable separada para que `body` solo se incluya
  // cuando hay payload — exactOptionalPropertyTypes no acepta `body:
  // undefined` explícito en RequestInit.
  const fetchInit: RequestInit = {
    ...init,
    method,
    headers,
    ...(body !== undefined ? { body: asForm ? (body as FormData) : JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, fetchInit);

  // 204 / 205 — sin body
  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const zodMessage = messageFromFirstZodIssue(payload);
    const errCode =
      zodMessage !== undefined
        ? 'validation_error'
        : typeof payload === 'object' &&
            payload !== null &&
            'code' in payload &&
            typeof payload.code === 'string'
          ? payload.code
          : undefined;
    const errMessage =
      zodMessage ??
      (typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : undefined);
    throw new ApiError(res.status, errCode, payload, errMessage);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>('POST', path, body, init),
  /**
   * POST multipart. No setea Content-Type: el browser agrega el boundary.
   * Usado por el gestor documental del viaje (`file` PDF/JPEG/PNG).
   */
  postForm: <T>(path: string, form: FormData, init?: RequestInit) =>
    request<T>('POST', path, form, init, true),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>('PATCH', path, body, init),
  put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>('PUT', path, body, init),
  delete: <T>(path: string, bodyOrInit?: unknown, init?: RequestInit) => {
    // DELETE puede llevar body (RFC 7231 lo permite). Detectamos si el
    // primer arg es un RequestInit (tiene `headers` o `signal`) o un body.
    if (
      bodyOrInit &&
      typeof bodyOrInit === 'object' &&
      ('headers' in bodyOrInit || 'signal' in bodyOrInit) &&
      !('endpoint' in bodyOrInit)
    ) {
      return request<T>('DELETE', path, undefined, bodyOrInit as RequestInit);
    }
    return request<T>('DELETE', path, bodyOrInit, init);
  },
} as const;
