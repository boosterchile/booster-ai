import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client.js';
import {
  PushDisabledError,
  PushPermissionDefaultError,
  PushPermissionDeniedError,
  PushUnsupportedError,
  hasActiveWebPushSubscription,
  isWebPushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from './web-push.js';

// Helpers para mockear entorno Web Push
function setupSupportedEnv(
  opts: {
    permission?: NotificationPermission;
    existingSubscription?: PushSubscription | null;
  } = {},
) {
  const subscriptionMock = opts.existingSubscription ?? null;
  const subscribeFn = vi.fn(async () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p256-key', auth: 'auth-key' },
    }),
    unsubscribe: vi.fn(async () => true),
  }));
  const getSubscriptionFn = vi.fn(async () => subscriptionMock);
  const pushManager = { subscribe: subscribeFn, getSubscription: getSubscriptionFn };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  });
  (globalThis as any).PushManager = vi.fn();
  const notifPerm = opts.permission ?? 'granted';
  (globalThis as any).Notification = {
    permission: notifPerm,
    requestPermission: vi.fn(async () => notifPerm),
  };
  return { subscribeFn, getSubscriptionFn };
}

function teardownEnv() {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(globalThis as any, 'PushManager');
  Reflect.deleteProperty(globalThis as any, 'Notification');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  teardownEnv();
  vi.restoreAllMocks();
});

describe('isWebPushSupported', () => {
  it('false sin serviceWorker', () => {
    teardownEnv();
    expect(isWebPushSupported()).toBe(false);
  });

  it('true con todos los APIs', () => {
    setupSupportedEnv();
    expect(isWebPushSupported()).toBe(true);
  });
});

describe('subscribeToWebPush', () => {
  it('throw PushUnsupportedError si no hay soporte', async () => {
    teardownEnv();
    await expect(subscribeToWebPush()).rejects.toThrow(PushUnsupportedError);
  });

  it('throw PushPermissionDeniedError si permission=denied', async () => {
    setupSupportedEnv({ permission: 'denied' });
    await expect(subscribeToWebPush()).rejects.toThrow(PushPermissionDeniedError);
  });

  it('throw PushPermissionDeniedError si requestPermission devuelve denied', async () => {
    setupSupportedEnv({ permission: 'default' });
    (Notification as any).requestPermission = vi.fn(async () => 'denied');
    await expect(subscribeToWebPush()).rejects.toThrow(PushPermissionDeniedError);
  });

  it('throw PushPermissionDefaultError si user cierra prompt', async () => {
    setupSupportedEnv({ permission: 'default' });
    (Notification as any).requestPermission = vi.fn(async () => 'default');
    await expect(subscribeToWebPush()).rejects.toThrow(PushPermissionDefaultError);
  });

  it('reusa subscription existente sin nuevo subscribe', async () => {
    const existing = {
      endpoint: 'https://existing/x',
      toJSON: () => ({
        endpoint: 'https://existing/x',
        keys: { p256dh: 'pk', auth: 'ak' },
      }),
      unsubscribe: vi.fn(),
    } as unknown as PushSubscription;
    const { subscribeFn } = setupSupportedEnv({ existingSubscription: existing });
    vi.spyOn(api, 'post').mockResolvedValueOnce(undefined);
    const result = await subscribeToWebPush();
    expect(subscribeFn).not.toHaveBeenCalled();
    expect(result.endpoint).toBe('https://existing/x');
  });

  it('happy path nuevo subscribe: llama VAPID + subscribe + POST backend', async () => {
    const { subscribeFn } = setupSupportedEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ public_key: 'BPubKeyBase64UrlSafe-_' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce(undefined);
    const result = await subscribeToWebPush();
    expect(subscribeFn).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(postSpy).toHaveBeenCalledWith(
      '/me/push-subscription',
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p256-key', auth: 'auth-key' },
      }),
    );
    expect(result.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
  });

  it('VAPID 503 → throw PushDisabledError', async () => {
    setupSupportedEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(subscribeToWebPush()).rejects.toThrow(PushDisabledError);
  });

  it('VAPID otro error → Error genérico', async () => {
    setupSupportedEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(subscribeToWebPush()).rejects.toThrow(/fetchVapidPublicKey/);
  });
});

describe('unsubscribeFromWebPush', () => {
  it('sin soporte → no hace nada (no throw)', async () => {
    teardownEnv();
    await expect(unsubscribeFromWebPush()).resolves.toBeUndefined();
  });

  it('sin subscription previa → no hace nada', async () => {
    setupSupportedEnv();
    const apiSpy = vi.spyOn(api, 'delete');
    await unsubscribeFromWebPush();
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it('happy path: DELETE backend + browser unsubscribe', async () => {
    const unsubMock = vi.fn(async () => true);
    const existing = {
      endpoint: 'https://x',
      unsubscribe: unsubMock,
      toJSON: () => ({}),
    } as unknown as PushSubscription;
    setupSupportedEnv({ existingSubscription: existing });
    const apiSpy = vi.spyOn(api, 'delete').mockResolvedValueOnce(undefined);
    await unsubscribeFromWebPush();
    expect(apiSpy).toHaveBeenCalledWith('/me/push-subscription', { endpoint: 'https://x' });
    expect(unsubMock).toHaveBeenCalled();
  });

  it('backend DELETE falla → log warn pero browser unsubscribe procede', async () => {
    const unsubMock = vi.fn(async () => true);
    const existing = {
      endpoint: 'https://x',
      unsubscribe: unsubMock,
      toJSON: () => ({}),
    } as unknown as PushSubscription;
    setupSupportedEnv({ existingSubscription: existing });
    vi.spyOn(api, 'delete').mockRejectedValueOnce(new Error('network'));
    await unsubscribeFromWebPush();
    expect(unsubMock).toHaveBeenCalled();
  });
});

describe('hasActiveWebPushSubscription', () => {
  it('false sin soporte', async () => {
    teardownEnv();
    expect(await hasActiveWebPushSubscription()).toBe(false);
  });

  it('false si permission != granted', async () => {
    setupSupportedEnv({ permission: 'default' });
    expect(await hasActiveWebPushSubscription()).toBe(false);
  });

  it('false si no hay subscription', async () => {
    setupSupportedEnv({ permission: 'granted' });
    expect(await hasActiveWebPushSubscription()).toBe(false);
  });

  it('true si todo OK', async () => {
    const existing = {
      endpoint: 'https://x',
      toJSON: () => ({}),
      unsubscribe: vi.fn(),
    } as unknown as PushSubscription;
    setupSupportedEnv({ permission: 'granted', existingSubscription: existing });
    expect(await hasActiveWebPushSubscription()).toBe(true);
  });
});
