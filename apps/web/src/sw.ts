/// <reference lib="webworker" />
/**
 * Service Worker custom para Booster PWA (P3.c + P3.e).
 *
 * Hace dos cosas:
 *   1. Precaching estándar Workbox (igual que el modo generateSW que
 *      teníamos antes). injectManifest() inyecta la lista de assets al
 *      build.
 *   2. Push handler: cuando llega una notificación Web Push, parsea el
 *      payload y muestra una notificación nativa con showNotification.
 *      Click → openWindow al deep-link al chat.
 *
 * Migración generateSW → injectManifest:
 *   - skipWaiting + clientsClaim ahora son llamadas explícitas acá.
 *   - runtimeCaching de Google Fonts ahora se hace con registerRoute() de
 *     workbox-routing.
 *   - Lo demás es idéntico.
 */

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

// vite-plugin-pwa inyecta __WB_MANIFEST en build time con la lista de
// assets a precachear (matching globPatterns del config).
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// =============================================================================
// Workbox precaching (mismo comportamiento que el modo generateSW anterior)
// =============================================================================

self.skipWaiting();
clientsClaim();

// __WB_MANIFEST es inyectado en build time por vite-plugin-pwa con la
// lista de assets a precachear (matching globPatterns del config).
precacheAndRoute(self.__WB_MANIFEST);

// Google Fonts CSS — CacheFirst, expira en 1 año (max 4 entries).
registerRoute(
  ({ url }: { url: URL }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-stylesheets',
    plugins: [
      // @ts-expect-error workbox-expiration ExpirationPlugin tipa cacheDidUpdate como required pero exactOptionalPropertyTypes:true del tsconfig base lo exige sin '| undefined'
      new ExpirationPlugin({
        maxEntries: 4,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

// Google Fonts WebFont files — CacheFirst, expira en 1 año (max 20 entries).
registerRoute(
  ({ url }: { url: URL }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      // @ts-expect-error workbox-expiration ExpirationPlugin tipa cacheDidUpdate como required pero exactOptionalPropertyTypes:true del tsconfig base lo exige sin '| undefined'
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

// =============================================================================
// Web Push handlers (P3.c)
// =============================================================================

interface PushPayload {
  title: string;
  body: string;
  tag: string;
  data: {
    assignment_id: string;
    message_id: string;
    url: string;
  };
}

/**
 * `push` event: el push service del browser entrega un payload encriptado
 * que ya viene desencriptado en `event.data`. Lo parseamos como JSON y
 * mostramos la notificación nativa.
 *
 * Si el payload no parsea (corrupción, schema obsoleto), mostramos una
 * notificación genérica para no perder el aviso al user.
 */
self.addEventListener('push', (event) => {
  let payload: PushPayload | null = null;
  try {
    payload = event.data?.json() ?? null;
  } catch {
    payload = null;
  }

  const title = payload?.title ?? 'Booster';
  // Construimos options con spread condicional para no setear props en
  // undefined (exactOptionalPropertyTypes).
  const options: NotificationOptions = {
    body: payload?.body ?? 'Nuevo mensaje',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    requireInteraction: false,
    ...(payload?.tag ? { tag: payload.tag } : {}),
    ...(payload?.data ? { data: payload.data } : {}),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * `notificationclick`: cuando el user clickea la notificación, abrimos
 * el deep-link al chat (data.url). Si ya hay una tab/window abierta del
 * app, le damos foco e instruimos navegar; si no, abrimos una nueva.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as PushPayload['data'] | undefined)?.url;
  if (!url) return;

  event.waitUntil(
    (async () => {
      // Buscar una window/tab del app ya abierta. matchAll(includeUncontrolled)
      // devuelve TODAS las tabs del origin, no solo las controladas por este SW.
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Preferir una que esté en el deep-link exacto (focus + nada más).
      // Si no, buscar cualquiera del app y navegarla. Si no hay ninguna,
      // abrir una nueva.
      const target = new URL(url, self.location.origin);
      const exactMatch = allClients.find((c) => c.url === target.toString());
      if (exactMatch) {
        await exactMatch.focus();
        return;
      }
      const sameOrigin = allClients.find(
        (c) => new URL(c.url).origin === target.origin,
      );
      if (sameOrigin) {
        await sameOrigin.focus();
        if ('navigate' in sameOrigin) {
          await sameOrigin.navigate(target.toString());
        }
        return;
      }
      await self.clients.openWindow(target.toString());
    })(),
  );
});
