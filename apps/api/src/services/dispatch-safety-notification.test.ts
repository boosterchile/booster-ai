/**
 * Tests de dispatchSafetyNotification (Task 9 — dedupe + push + WhatsApp).
 *
 * Cubre:
 *   1. deduped: redis.set devuelve null → 'deduped', sendPush/sendWhatsapp NO llamados.
 *   2. no_recipient: redis.set devuelve 'OK', recipients=[] → 'no_recipient'.
 *   3. notified con WhatsApp: 'OK', 1 recipient con phone, contentSidSafety set
 *      → sendPush llamado 1x, sendWhatsapp llamado 1x con contentVariables correctas.
 *   4. sin contentSid → WhatsApp saltado: sendPush llamado, sendWhatsapp NO.
 *   5. push throws → best-effort: resultado sigue 'notified', sendWhatsapp aún llamado.
 *   6. recipient con phone null → WhatsApp saltado para ese recipient, push intentado.
 */

import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { dispatchSafetyNotification } from './dispatch-safety-notification.js';
import type { SafetyRouting } from './route-safety-recipients.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const safetyEvent: SafetyEvent = {
  eventType: 'crash',
  imei: '351756051523010',
  occurredAt: '2026-06-15T10:00:00.000Z',
  vehicleId: 'v-uuid',
};

const routingWithRecipient: SafetyRouting = {
  empresaId: 'emp-uuid',
  vehicleLabel: 'ABCD12',
  trackingCode: 'TRK-001',
  recipients: [{ userId: 'user-1', phoneE164: '+56912345678' }],
};

const routingNoRecipients: SafetyRouting = {
  empresaId: 'emp-uuid',
  vehicleLabel: 'ABCD12',
  trackingCode: null,
  recipients: [],
};

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// DB stub (not used by dispatchSafetyNotification directly, just passed through)
// ---------------------------------------------------------------------------
const dbStub = {} as unknown as Db;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchSafetyNotification', () => {
  it('deduped: redis.set devuelve null → retorna deduped, sendPush/sendWhatsapp NO llamados', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null) } as never;
    const sendPush = vi.fn();
    const sendWhatsapp = vi.fn();
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingWithRecipient,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    expect(outcome).toBe('deduped');
    expect(sendPush).not.toHaveBeenCalled();
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it('no_recipient: redis.set devuelve OK, recipients=[] → retorna no_recipient', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn();
    const sendWhatsapp = vi.fn();
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingNoRecipients,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    expect(outcome).toBe('no_recipient');
    expect(sendPush).not.toHaveBeenCalled();
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it('notified con whatsapp: sendPush 1x, sendWhatsapp 1x con contentVariables correctas', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn().mockResolvedValue(undefined);
    const sendWhatsapp = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingWithRecipient,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    expect(outcome).toBe('notified');

    // Push llamado una vez con el userId correcto
    expect(sendPush).toHaveBeenCalledTimes(1);
    const pushCall = sendPush.mock.calls[0]?.[0];
    expect(pushCall.userId).toBe('user-1');
    expect(pushCall.payload.title).toBe('🚨 Alerta de seguridad');
    expect(pushCall.payload.body).toBe('ABCD12: Posible colisión');
    expect(pushCall.payload.tag).toBe(`safety-${safetyEvent.imei}-${safetyEvent.eventType}`);
    expect(pushCall.payload.data.url).toBe('/app/flota');

    // WhatsApp llamado una vez
    expect(sendWhatsapp).toHaveBeenCalledTimes(1);
    const waCall = sendWhatsapp.mock.calls[0]?.[0];
    expect(waCall.to).toBe('+56912345678');
    expect(waCall.contentSid).toBe('HX123');
    // Variable 1: vehicleLabel
    expect(waCall.contentVariables['1']).toBe('ABCD12');
    // Variable 2: label del evento
    expect(waCall.contentVariables['2']).toBe('Posible colisión');
    // Variable 3: hora (non-empty string)
    expect(typeof waCall.contentVariables['3']).toBe('string');
    expect(waCall.contentVariables['3'].length).toBeGreaterThan(0);
    // Variable 4: viaje = trackingCode
    expect(waCall.contentVariables['4']).toBe('TRK-001');
  });

  it('sin contentSid → sendWhatsapp NO llamado, sendPush sí', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn().mockResolvedValue(undefined);
    const sendWhatsapp = vi.fn();
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingWithRecipient,
      // contentSidSafety: undefined
      sendPush,
      sendWhatsapp,
    });

    expect(outcome).toBe('notified');
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it('push throws → best-effort: resultado es notified, sendWhatsapp igual se llama', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn().mockRejectedValue(new Error('push timeout'));
    const sendWhatsapp = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingWithRecipient,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    // A pesar del fallo en push, se retorna 'notified' y se intentó WhatsApp
    expect(outcome).toBe('notified');
    expect(sendWhatsapp).toHaveBeenCalledTimes(1);
    // El error fue logueado
    expect(logger.error).toHaveBeenCalled();
  });

  it('recipient con phone null → WhatsApp saltado para ese recipient, push sí intentado', async () => {
    const routingNullPhone: SafetyRouting = {
      empresaId: 'emp-uuid',
      vehicleLabel: 'ABCD12',
      trackingCode: null,
      recipients: [{ userId: 'user-no-phone', phoneE164: null }],
    };

    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn().mockResolvedValue(undefined);
    const sendWhatsapp = vi.fn();
    const logger = makeLogger();

    const outcome = await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingNullPhone,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    expect(outcome).toBe('notified');
    // Push intentado a pesar de no tener phone
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0]?.[0].userId).toBe('user-no-phone');
    // WhatsApp NO llamado porque phoneE164 es null
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it('viaje null → variable 4 dice "Sin viaje activo"', async () => {
    const routingNoViaje: SafetyRouting = {
      empresaId: 'emp-uuid',
      vehicleLabel: 'ABCD12',
      trackingCode: null,
      recipients: [{ userId: 'user-1', phoneE164: '+56912345678' }],
    };

    const redis = { set: vi.fn().mockResolvedValue('OK') } as never;
    const sendPush = vi.fn().mockResolvedValue(undefined);
    const sendWhatsapp = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();

    await dispatchSafetyNotification({
      redis,
      db: dbStub,
      logger,
      event: safetyEvent,
      routing: routingNoViaje,
      contentSidSafety: 'HX123',
      sendPush,
      sendWhatsapp,
    });

    const waCall = sendWhatsapp.mock.calls[0]?.[0];
    expect(waCall.contentVariables['4']).toBe('Sin viaje activo');
  });
});
