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

export function setActiveEmpresaId(empresaId: string | null): void {
  if (empresaId === null) {
    localStorage.removeItem(ACTIVE_EMPRESA_KEY);
  } else {
    localStorage.setItem(ACTIVE_EMPRESA_KEY, empresaId);
  }
}

async function buildHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra);

  const user = firebaseAuth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const activeEmpresaId = getActiveEmpresaId();
  if (activeEmpresaId) {
    headers.set('X-Empresa-Id', activeEmpresaId);
  }

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const url = `${env.VITE_API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = await buildHeaders(init?.headers);

  // Construido como variable separada para que `body` solo se incluya
  // cuando hay payload — exactOptionalPropertyTypes no acepta `body:
  // undefined` explícito en RequestInit.
  const fetchInit: RequestInit = {
    ...init,
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
    const errCode =
      typeof payload === 'object' &&
      payload !== null &&
      'code' in payload &&
      typeof payload.code === 'string'
        ? payload.code
        : undefined;
    const errMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : undefined;
    throw new ApiError(res.status, errCode, payload, errMessage);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>('POST', path, body, init),
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
