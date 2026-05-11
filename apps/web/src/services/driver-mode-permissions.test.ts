import { describe, expect, it, vi } from 'vitest';
import {
  queryDriverPermissions,
  requestGeolocationPermission,
  requestMicrophonePermission,
} from './driver-mode-permissions.js';

describe('queryDriverPermissions', () => {
  it('returns unsupported when Permissions API missing', async () => {
    const nav = {} as Navigator;
    const res = await queryDriverPermissions({ navigatorOverride: nav });
    expect(res).toEqual({ mic: 'unsupported', geo: 'unsupported' });
  });

  it('returns granted/granted when both grants', async () => {
    const permissions = {
      query: vi.fn().mockResolvedValue({ state: 'granted' }),
    } as unknown as Permissions;
    const nav = { permissions } as Navigator;
    const res = await queryDriverPermissions({ navigatorOverride: nav });
    expect(res).toEqual({ mic: 'granted', geo: 'granted' });
    expect(permissions.query).toHaveBeenCalledTimes(2);
  });

  it('returns denied when Permissions API reports denied', async () => {
    const permissions = {
      query: vi.fn().mockResolvedValue({ state: 'denied' }),
    } as unknown as Permissions;
    const res = await queryDriverPermissions({
      navigatorOverride: { permissions } as Navigator,
    });
    expect(res).toEqual({ mic: 'denied', geo: 'denied' });
  });

  it('returns unknown when query rejects (Safari TypeError simulation)', async () => {
    const permissions = {
      query: vi.fn().mockRejectedValue(new TypeError('not supported')),
    } as unknown as Permissions;
    const res = await queryDriverPermissions({
      navigatorOverride: { permissions } as Navigator,
    });
    expect(res).toEqual({ mic: 'unknown', geo: 'unknown' });
  });

  it('returns prompt independently for mic and geo', async () => {
    const permissions = {
      query: vi.fn().mockImplementation(({ name }: { name: string }) => {
        if (name === 'microphone') {
          return Promise.resolve({ state: 'prompt' });
        }
        return Promise.resolve({ state: 'granted' });
      }),
    } as unknown as Permissions;
    const res = await queryDriverPermissions({
      navigatorOverride: { permissions } as Navigator,
    });
    expect(res).toEqual({ mic: 'prompt', geo: 'granted' });
  });
});

describe('requestMicrophonePermission', () => {
  it('returns unsupported when mediaDevices missing', async () => {
    const res = await requestMicrophonePermission({
      mediaDevices: undefined as unknown as MediaDevices,
    });
    expect(res).toBe('unsupported');
  });

  it('returns granted and stops tracks on success', async () => {
    const stopSpy = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopSpy }, { stop: stopSpy }],
    } as unknown as MediaStream;
    const md = {
      getUserMedia: vi.fn().mockResolvedValue(stream),
    } as unknown as MediaDevices;
    const res = await requestMicrophonePermission({ mediaDevices: md });
    expect(res).toBe('granted');
    expect(stopSpy).toHaveBeenCalledTimes(2);
  });

  it('returns denied on NotAllowedError', async () => {
    const err = new Error('blocked');
    err.name = 'NotAllowedError';
    const md = {
      getUserMedia: vi.fn().mockRejectedValue(err),
    } as unknown as MediaDevices;
    const res = await requestMicrophonePermission({ mediaDevices: md });
    expect(res).toBe('denied');
  });

  it('returns unknown on other errors', async () => {
    const md = {
      getUserMedia: vi.fn().mockRejectedValue(new Error('hardware busted')),
    } as unknown as MediaDevices;
    const res = await requestMicrophonePermission({ mediaDevices: md });
    expect(res).toBe('unknown');
  });
});

describe('requestGeolocationPermission', () => {
  it('returns unsupported when geolocation missing', async () => {
    const res = await requestGeolocationPermission({
      geolocation: undefined as unknown as Geolocation,
    });
    expect(res).toBe('unsupported');
  });

  it('returns granted on successful position', async () => {
    const geo = {
      getCurrentPosition: vi.fn().mockImplementation((onOk: PositionCallback) => {
        onOk({
          coords: { latitude: -33, longitude: -70 },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition);
      }),
    } as unknown as Geolocation;
    const res = await requestGeolocationPermission({ geolocation: geo });
    expect(res).toBe('granted');
  });

  it('returns denied when code=1 (PERMISSION_DENIED)', async () => {
    const geo = {
      getCurrentPosition: vi
        .fn()
        .mockImplementation((_onOk: PositionCallback, onErr: PositionErrorCallback) => {
          onErr({ code: 1, message: 'denied' } as GeolocationPositionError);
        }),
    } as unknown as Geolocation;
    const res = await requestGeolocationPermission({ geolocation: geo });
    expect(res).toBe('denied');
  });

  it('returns unknown on other geolocation error codes', async () => {
    const geo = {
      getCurrentPosition: vi
        .fn()
        .mockImplementation((_onOk: PositionCallback, onErr: PositionErrorCallback) => {
          onErr({ code: 3, message: 'timeout' } as GeolocationPositionError);
        }),
    } as unknown as Geolocation;
    const res = await requestGeolocationPermission({ geolocation: geo });
    expect(res).toBe('unknown');
  });
});
