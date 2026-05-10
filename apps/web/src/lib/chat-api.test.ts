import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api-client.js';
import {
  fetchChatMessages,
  fetchPhotoDownloadUrl,
  markChatRead,
  requestPhotoUploadUrl,
  sendChatMessage,
  sendLocationMessage,
  sendPhotoMessage,
  uploadChatPhoto,
} from './chat-api.js';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchChatMessages', () => {
  it('GET sin cursor ni limit', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      messages: [],
      next_cursor: null,
      viewer_role: 'transportista',
    });
    await fetchChatMessages({ assignmentId: 'a1' });
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages');
  });

  it('GET con cursor + limit en querystring', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      messages: [],
      next_cursor: null,
      viewer_role: 'generador_carga',
    });
    await fetchChatMessages({ assignmentId: 'a1', cursor: 'c-1', limit: 25 });
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages?cursor=c-1&limit=25');
  });
});

describe('sendChatMessage', () => {
  it('POST texto', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({ message: { id: 'm1' } });
    await sendChatMessage({ assignmentId: 'a1', body: { type: 'texto', text: 'hola' } });
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages', { type: 'texto', text: 'hola' });
  });
});

describe('markChatRead', () => {
  it('PATCH /messages/read', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({ marked_read: 5 });
    const result = await markChatRead('a1');
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages/read');
    expect(result.marked_read).toBe(5);
  });
});

describe('requestPhotoUploadUrl', () => {
  it('POST con content_type', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      upload_url: 'https://gcs/...',
      gcs_uri: 'gs://b/c.jpg',
      expires_in_seconds: 300,
      required_content_type: 'image/jpeg',
    });
    await requestPhotoUploadUrl({ assignmentId: 'a1', contentType: 'image/jpeg' });
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages/photo-upload-url', {
      content_type: 'image/jpeg',
    });
  });
});

describe('uploadChatPhoto', () => {
  it('rechaza tipo no soportado con throw', async () => {
    const file = new File(['x'], 'a.gif', { type: 'image/gif' });
    await expect(uploadChatPhoto({ assignmentId: 'a1', file })).rejects.toThrow(/no soportado/);
  });

  it('happy path: upload exitoso retorna gcsUri', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      upload_url: 'https://gcs/signed',
      gcs_uri: 'gs://b/chat/a1/abc.jpg',
      expires_in_seconds: 300,
      required_content_type: 'image/jpeg',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }));
    const file = new File(['data'], 'p.jpg', { type: 'image/jpeg' });
    const result = await uploadChatPhoto({ assignmentId: 'a1', file });
    expect(result.gcsUri).toBe('gs://b/chat/a1/abc.jpg');
  });

  it('upload GCS falla → throw con status', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      upload_url: 'https://gcs/signed',
      gcs_uri: 'gs://b/x.jpg',
      expires_in_seconds: 300,
      required_content_type: 'image/png',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 403 }));
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    await expect(uploadChatPhoto({ assignmentId: 'a1', file })).rejects.toThrow(/403/);
  });
});

describe('fetchPhotoDownloadUrl', () => {
  it('POST /:msgId/photo-url', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      download_url: 'https://gcs/dl',
      expires_in_seconds: 300,
    });
    await fetchPhotoDownloadUrl({ assignmentId: 'a1', messageId: 'm1' });
    expect(spy).toHaveBeenCalledWith('/assignments/a1/messages/m1/photo-url', {});
  });
});

describe('sendPhotoMessage', () => {
  it('compone upload + sendChatMessage(foto)', async () => {
    const postSpy = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({
        upload_url: 'https://gcs/x',
        gcs_uri: 'gs://b/chat/a/abc.jpg',
        expires_in_seconds: 300,
        required_content_type: 'image/jpeg',
      })
      .mockResolvedValueOnce({ message: { id: 'm1' } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }));
    const file = new File(['d'], 'p.jpg', { type: 'image/jpeg' });
    await sendPhotoMessage({ assignmentId: 'a', file });
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[1]?.[1]).toEqual({
      type: 'foto',
      photo_gcs_uri: 'gs://b/chat/a/abc.jpg',
    });
  });
});

describe('sendLocationMessage', () => {
  it('rechaza si geolocation no disponible', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Reflect.deleteProperty(navigator, 'geolocation');
    await expect(sendLocationMessage('a1')).rejects.toThrow(/Geolocalización/);
    if (original) {
      Object.defineProperty(navigator, 'geolocation', original);
    }
  });

  it('happy path: pide ubicación + sendChatMessage(ubicacion)', async () => {
    const getCurrentPositionMock = vi.fn((resolve: (pos: GeolocationPosition) => void) => {
      resolve({
        coords: {
          latitude: -33.45,
          longitude: -70.65,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      } as unknown as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: getCurrentPositionMock },
      configurable: true,
    });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({ message: { id: 'm1' } });
    await sendLocationMessage('a1');
    expect(postSpy).toHaveBeenCalledWith('/assignments/a1/messages', {
      type: 'ubicacion',
      location_lat: -33.45,
      location_lng: -70.65,
    });
  });
});
