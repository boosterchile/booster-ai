import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientsClaimMock = vi.fn();
vi.mock('workbox-core', () => ({ clientsClaim: clientsClaimMock }));

const precacheAndRouteMock = vi.fn();
vi.mock('workbox-precaching', () => ({ precacheAndRoute: precacheAndRouteMock }));

const registerRouteMock = vi.fn();
vi.mock('workbox-routing', () => ({ registerRoute: registerRouteMock }));

const CacheFirstMock = vi.fn(function CacheFirst(this: Record<string, unknown>, opts: unknown) {
  this.opts = opts;
});
vi.mock('workbox-strategies', () => ({ CacheFirst: CacheFirstMock }));

const ExpirationPluginMock = vi.fn(function ExpirationPlugin(
  this: Record<string, unknown>,
  opts: unknown,
) {
  this.opts = opts;
});
vi.mock('workbox-expiration', () => ({ ExpirationPlugin: ExpirationPluginMock }));

interface SwGlobal {
  skipWaiting: ReturnType<typeof vi.fn>;
  __WB_MANIFEST: unknown[];
  addEventListener: ReturnType<typeof vi.fn>;
  registration: { showNotification: ReturnType<typeof vi.fn> };
  clients: { matchAll: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn> };
  location: { origin: string };
}

let swGlobal: SwGlobal;
const listeners = new Map<string, ((ev: unknown) => void)[]>();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  listeners.clear();
  swGlobal = {
    skipWaiting: vi.fn(),
    __WB_MANIFEST: [{ url: '/a.js', revision: 'abc' }],
    addEventListener: vi.fn((type: string, cb: (ev: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    }),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(),
      openWindow: vi.fn(async () => undefined),
    },
    location: { origin: 'https://app.boosterchile.com' },
  };
  // El módulo sw.ts referencia `self` como ServiceWorkerGlobalScope.
  (globalThis as unknown as { self: SwGlobal }).self = swGlobal;
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: cleanup after test
  delete (globalThis as unknown as { self?: SwGlobal }).self;
  vi.restoreAllMocks();
});

describe('sw — bootstrap', () => {
  it('llama skipWaiting + clientsClaim + precacheAndRoute', async () => {
    await import('./sw.js');
    expect(swGlobal.skipWaiting).toHaveBeenCalled();
    expect(clientsClaimMock).toHaveBeenCalled();
    expect(precacheAndRouteMock).toHaveBeenCalledWith(swGlobal.__WB_MANIFEST);
  });

  it('registra rutas para Google Fonts stylesheets y webfonts', async () => {
    await import('./sw.js');
    expect(registerRouteMock).toHaveBeenCalledTimes(2);
    expect(CacheFirstMock).toHaveBeenCalledTimes(2);
    const cacheNames = CacheFirstMock.mock.calls.map(
      (c) => (c[0] as { cacheName: string }).cacheName,
    );
    expect(cacheNames).toEqual(
      expect.arrayContaining(['google-fonts-stylesheets', 'google-fonts-webfonts']),
    );
  });

  it('registra listeners push y notificationclick', async () => {
    await import('./sw.js');
    expect(listeners.has('push')).toBe(true);
    expect(listeners.has('notificationclick')).toBe(true);
  });
});

describe('sw — push handler', () => {
  async function getPushHandler() {
    await import('./sw.js');
    return listeners.get('push')?.[0];
  }

  it('payload válido → showNotification con title + body + data', async () => {
    const handler = await getPushHandler();
    const event = {
      data: {
        json: () => ({
          title: 'Nueva oferta',
          body: 'Carga Santiago → Concepción',
          tag: 'offer-123',
          data: { assignment_id: 'a1', message_id: 'm1', url: '/app/ofertas' },
        }),
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    handler?.(event);
    expect(swGlobal.registration.showNotification).toHaveBeenCalledWith(
      'Nueva oferta',
      expect.objectContaining({
        body: 'Carga Santiago → Concepción',
        tag: 'offer-123',
      }),
    );
  });

  it('payload corrupto (json throws) → notificación genérica', async () => {
    const handler = await getPushHandler();
    const event = {
      data: {
        json: () => {
          throw new Error('bad json');
        },
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    handler?.(event);
    expect(swGlobal.registration.showNotification).toHaveBeenCalledWith(
      'Booster',
      expect.objectContaining({ body: 'Nuevo mensaje' }),
    );
  });

  it('event.data undefined → notificación genérica', async () => {
    const handler = await getPushHandler();
    const event = { data: undefined, waitUntil: (p: Promise<unknown>) => p };
    handler?.(event);
    expect(swGlobal.registration.showNotification).toHaveBeenCalledWith(
      'Booster',
      expect.objectContaining({ body: 'Nuevo mensaje' }),
    );
  });
});

describe('sw — notificationclick handler', () => {
  async function getClickHandler() {
    await import('./sw.js');
    return listeners.get('notificationclick')?.[0];
  }

  it('sin url en data → no abre window', async () => {
    const handler = await getClickHandler();
    const event = {
      notification: { close: vi.fn(), data: undefined },
      waitUntil: (p: Promise<unknown>) => p,
    };
    handler?.(event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(swGlobal.clients.openWindow).not.toHaveBeenCalled();
  });

  it('exact match URL → focus en el client existente', async () => {
    const handler = await getClickHandler();
    const focusMock = vi.fn(async () => undefined);
    swGlobal.clients.matchAll.mockResolvedValueOnce([
      { url: 'https://app.boosterchile.com/app/chat', focus: focusMock, navigate: vi.fn() },
    ]);
    const event = {
      notification: { close: vi.fn(), data: { url: '/app/chat' } },
      waitUntil: (p: Promise<unknown>) => p,
    };
    await handler?.(event);
    // Sleep a bit so the IIFE inside waitUntil ejecuta.
    await new Promise((r) => setTimeout(r, 10));
    expect(focusMock).toHaveBeenCalled();
  });

  it('same origin pero distinta URL → focus + navigate', async () => {
    const handler = await getClickHandler();
    const focusMock = vi.fn(async () => undefined);
    const navigateMock = vi.fn(async () => undefined);
    swGlobal.clients.matchAll.mockResolvedValueOnce([
      {
        url: 'https://app.boosterchile.com/app/dashboard',
        focus: focusMock,
        navigate: navigateMock,
      },
    ]);
    const event = {
      notification: { close: vi.fn(), data: { url: '/app/chat' } },
      waitUntil: (p: Promise<unknown>) => p,
    };
    await handler?.(event);
    await new Promise((r) => setTimeout(r, 10));
    expect(focusMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('https://app.boosterchile.com/app/chat');
  });

  it('sin clients abiertos → openWindow', async () => {
    const handler = await getClickHandler();
    swGlobal.clients.matchAll.mockResolvedValueOnce([]);
    const event = {
      notification: { close: vi.fn(), data: { url: '/app/chat' } },
      waitUntil: (p: Promise<unknown>) => p,
    };
    await handler?.(event);
    await new Promise((r) => setTimeout(r, 10));
    expect(swGlobal.clients.openWindow).toHaveBeenCalledWith(
      'https://app.boosterchile.com/app/chat',
    );
  });
});
