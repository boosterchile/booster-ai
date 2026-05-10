/**
 * Helpers cliente para Web Push (P3.c+e).
 *
 * Flujo de subscribe:
 *   1. fetchVapidPublicKey() — GET /webpush/vapid-public-key (público).
 *   2. navigator.serviceWorker.register(...) — el SW ya está registrado
 *      por vite-plugin-pwa al boot del app, esto solo obtiene la
 *      registration existente.
 *   3. Notification.requestPermission() — UI prompt nativo del browser.
 *   4. registration.pushManager.subscribe({applicationServerKey: vapidKey})
 *   5. POST /me/push-subscription con endpoint + p256dh + auth.
 *
 * Errores comunes que el caller debe manejar:
 *   - 'permission_denied': user dijo no a la notif.
 *   - 'permission_default': user cerró el prompt sin elegir.
 *   - 'unsupported': browser sin Push API (Safari iOS <16.4 ej.).
 *   - 'no_vapid_key': server devolvió 503 (env vars ausentes).
 */

import { api } from './api-client.js';
import { logger } from './logger.js';

export class PushUnsupportedError extends Error {
  constructor() {
    super('Este navegador no soporta Web Push notifications');
    this.name = 'PushUnsupportedError';
  }
}

export class PushPermissionDeniedError extends Error {
  constructor() {
    super('Permiso de notificaciones denegado por el usuario');
    this.name = 'PushPermissionDeniedError';
  }
}

export class PushPermissionDefaultError extends Error {
  constructor() {
    super('El usuario cerró el prompt de permiso sin elegir');
    this.name = 'PushPermissionDefaultError';
  }
}

export class PushDisabledError extends Error {
  constructor() {
    super('Web Push está deshabilitado en este entorno (sin VAPID config)');
    this.name = 'PushDisabledError';
  }
}

/**
 * Detecta soporte mínimo. Necesitamos:
 *   - serviceWorker (para registrar el SW)
 *   - PushManager (para subscribe)
 *   - Notification (para showNotification + requestPermission)
 *   - window.atob (para parsear la VAPID key)
 *
 * En iOS Safari el soporte llegó en 16.4 (marzo 2023).
 */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

interface VapidKeyResponse {
  public_key: string;
}

async function fetchVapidPublicKey(): Promise<string> {
  // GET público sin auth — usa fetch directo para no pasar por el api-client
  // que injecta Authorization header (no es necesario y agrega round-trip).
  const baseUrl = (await import('./env.js')).env.VITE_API_URL;
  const res = await fetch(`${baseUrl}/webpush/vapid-public-key`);
  if (res.status === 503) {
    throw new PushDisabledError();
  }
  if (!res.ok) {
    throw new Error(`fetchVapidPublicKey: ${res.status}`);
  }
  const json = (await res.json()) as VapidKeyResponse;
  return json.public_key;
}

/**
 * Convierte la VAPID public key (base64url) a Uint8Array que pushManager
 * espera. Browser Push API requiere este formato exacto.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe al user a Web Push. Retorna el endpoint creado.
 *
 * Flujo:
 *   - Pide permiso si todavía no fue concedido.
 *   - Crea PushSubscription via service worker.
 *   - Registra en backend con POST /me/push-subscription.
 *
 * Idempotente: si ya hay una subscription, la reutiliza.
 */
export async function subscribeToWebPush(): Promise<{ endpoint: string }> {
  if (!isWebPushSupported()) {
    throw new PushUnsupportedError();
  }

  // 1. Permiso. Notification.permission puede ser 'granted'|'denied'|'default'.
  if (Notification.permission === 'denied') {
    throw new PushPermissionDeniedError();
  }
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result === 'denied') {
      throw new PushPermissionDeniedError();
    }
    if (result === 'default') {
      throw new PushPermissionDefaultError();
    }
  }

  // 2. Service worker registration. Esperar a que esté lista (vite-plugin-pwa
  // la registra al boot, pero puede tomar algunos ms en cold load).
  const registration = await navigator.serviceWorker.ready;

  // 3. ¿Ya hay subscription? Reusar (UPSERT en backend) en lugar de crear otra.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const vapidPublicKey = await fetchVapidPublicKey();
    // applicationServerKey espera BufferSource. urlBase64ToUint8Array
    // devuelve Uint8Array<ArrayBufferLike> que TS no acepta directo
    // (ArrayBufferLike admite SharedArrayBuffer). Re-creamos sobre un
    // ArrayBuffer concreto.
    const keyArray = urlBase64ToUint8Array(vapidPublicKey);
    const keyBuffer = new ArrayBuffer(keyArray.byteLength);
    new Uint8Array(keyBuffer).set(keyArray);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true, // requerido por Chrome — no permite silent push
      applicationServerKey: keyBuffer,
    });
  }

  // 4. Registrar en backend. El POST hace UPSERT por endpoint, así que
  // si ya existía con otras keys, las actualiza.
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error('PushSubscription sin keys completas (browser bug?)');
  }

  await api.post('/me/push-subscription', {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
  });

  return { endpoint: subscription.endpoint };
}

/**
 * Unsubscribe del Web Push. Borra la subscription en el browser y en el
 * backend.
 */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!isWebPushSupported()) {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  // Backend primero — si falla, mantenemos browser subscription sincronizada.
  try {
    await api.delete('/me/push-subscription', { endpoint: subscription.endpoint });
  } catch (err) {
    // Loggeamos pero no abortamos — el unsubscribe browser-side procede.
    logger.warn({ err }, 'DELETE /me/push-subscription falló');
  }

  await subscription.unsubscribe();
}

/**
 * Devuelve true si el user tiene una subscription activa en este browser.
 * Usado por la UI para mostrar el toggle "ON" o "OFF".
 */
export async function hasActiveWebPushSubscription(): Promise<boolean> {
  if (!isWebPushSupported()) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
