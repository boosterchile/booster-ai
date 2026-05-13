/**
 * Devuelve la URL base del API.
 *
 * En dev se inyecta via `VITE_API_URL` (e.g. `http://localhost:3000`).
 * En producción, si se usa path relativo via reverse proxy (mismo dominio),
 * la env queda vacía y el cliente arma URLs relativas como `/auth/login-rut`.
 *
 * Útil principalmente para endpoints PRE-auth donde el `api-client.ts`
 * (que agrega `Authorization: Bearer <firebase-id-token>` automáticamente)
 * NO aplica — el usuario todavía no tiene sesión.
 */
export function getApiUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  return typeof apiUrl === 'string' ? apiUrl : '';
}
