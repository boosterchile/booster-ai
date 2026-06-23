/**
 * Tests de publishDriverPosition.
 *
 * Cubre:
 *   1. Publica el mensaje correcto al topic correcto (payload + attributes).
 *   2. No lanza si Pub/Sub falla (fire-and-forget) — loguea el error.
 *   3. No publica si topicName está vacío (guard de dev/test).
 *   4. Payload Zod: rechaza payload inválido antes de publicar.
 */

import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { publishDriverPosition } from './publish-driver-position.js';

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

const validPayload = {
  viajeId: '11111111-1111-1111-1111-111111111111',
  vehiculoId: '22222222-2222-2222-2222-222222222222',
  lat: -33.4489,
  lng: -70.6693,
  registradoEn: '2026-06-23T10:00:00.000Z',
};

describe('publishDriverPosition', () => {
  it('publica el mensaje correcto al topic correcto con attributes', async () => {
    const publishMessage = vi.fn().mockResolvedValue('msg-id-1');
    const topic = vi.fn().mockReturnValue({ publishMessage });
    const logger = fakeLogger();

    await publishDriverPosition({
      topicName: 'driver-positions',
      payload: validPayload,
      logger,
      pubsub: { topic } as never,
    });

    expect(topic).toHaveBeenCalledWith('driver-positions');
    const call = publishMessage.mock.calls[0]?.[0];
    expect(call).toBeDefined();

    const data = JSON.parse(call.data.toString());
    expect(data).toMatchObject({
      viajeId: '11111111-1111-1111-1111-111111111111',
      vehiculoId: '22222222-2222-2222-2222-222222222222',
      lat: -33.4489,
      lng: -70.6693,
      registradoEn: '2026-06-23T10:00:00.000Z',
    });

    expect(call.attributes).toMatchObject({
      viaje_id: '11111111-1111-1111-1111-111111111111',
      vehiculo_id: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('no lanza si Pub/Sub falla (fire-and-forget) y loguea el error', async () => {
    const publishMessage = vi.fn().mockRejectedValue(new Error('pubsub down'));
    const topic = vi.fn().mockReturnValue({ publishMessage });
    const logger = fakeLogger();

    await expect(
      publishDriverPosition({
        topicName: 'driver-positions',
        payload: validPayload,
        logger,
        pubsub: { topic } as never,
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it('no publica si topicName está vacío', async () => {
    const topic = vi.fn();
    const logger = fakeLogger();

    await publishDriverPosition({
      topicName: '',
      payload: validPayload,
      logger,
      pubsub: { topic } as never,
    });

    expect(topic).not.toHaveBeenCalled();
  });

  it('no publica si el payload es inválido (lat fuera de rango) y loguea el error', async () => {
    const publishMessage = vi.fn();
    const topic = vi.fn().mockReturnValue({ publishMessage });
    const logger = fakeLogger();

    await publishDriverPosition({
      topicName: 'driver-positions',
      payload: { ...validPayload, lat: 999 }, // fuera de rango WGS84
      logger,
      pubsub: { topic } as never,
    });

    expect(publishMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
