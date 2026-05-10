import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { procesarMensajesNoLeidos } from '../../src/services/chat-whatsapp-fallback.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  updates?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };
  const buildUpdateChain = () => ({
    set: vi.fn(() => ({ where: vi.fn(async () => updates.shift() ?? []) })),
  });
  return {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

function makeTwilio(): TwilioWhatsAppClient {
  return {
    sendContent: vi.fn(async () => undefined),
  } as unknown as TwilioWhatsAppClient;
}

const CAND_BASE = {
  messageId: 'msg-1',
  assignmentId: 'assign-1',
  senderUserId: 'sender',
  senderRole: 'transportista',
  messageType: 'texto',
  textContent: 'hola',
  shipperEmpresaId: 'shipper-emp',
  carrierEmpresaId: 'carrier-emp',
  trackingCode: 'TR-1',
  senderName: 'Juan Pérez',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('procesarMensajesNoLeidos', () => {
  const baseOpts = {
    contentSid: 'HX-content-1',
    webAppUrl: 'https://app.test',
  };

  it('twilioClient null → skip con warn', async () => {
    const db = makeDb();
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: null,
    });
    expect(result.candidates).toBe(0);
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it('contentSid null → skip con warn', async () => {
    const db = makeDb();
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      contentSid: null,
      db: db as never,
      logger: noopLogger,
      twilioClient: makeTwilio(),
    });
    expect(result.candidates).toBe(0);
  });

  it('0 candidatos → retorna ceros', async () => {
    const db = makeDb({ selects: [[]] });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: makeTwilio(),
    });
    expect(result).toEqual({
      candidates: 0,
      notified: 0,
      skippedNoOwner: 0,
      skippedNoWhatsapp: 0,
      errored: 0,
    });
  });

  it('shipperEmpresaId null + sender=transportista → skippedNoOwner + marca notif', async () => {
    const db = makeDb({
      selects: [[{ ...CAND_BASE, shipperEmpresaId: null }]],
      updates: [[]], // markNotifSent
    });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: makeTwilio(),
    });
    expect(result.skippedNoOwner).toBe(1);
  });

  it('empresa destinataria sin dueño activo → skippedNoOwner', async () => {
    const db = makeDb({
      selects: [
        [CAND_BASE], // candidates
        [], // owners vacío
      ],
      updates: [[]],
    });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: makeTwilio(),
    });
    expect(result.skippedNoOwner).toBe(1);
  });

  it('dueño existe pero whatsappE164 null → skippedNoWhatsapp', async () => {
    const db = makeDb({
      selects: [[CAND_BASE], [{ userId: 'owner-1', whatsappE164: null }]],
      updates: [[]],
    });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: makeTwilio(),
    });
    expect(result.skippedNoWhatsapp).toBe(1);
  });

  it('happy path: notif enviada via Twilio sendContent', async () => {
    const twilio = makeTwilio();
    const db = makeDb({
      selects: [[CAND_BASE], [{ userId: 'owner-1', whatsappE164: '+56912345678' }]],
      updates: [[]], // markNotifSent
    });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: twilio,
    });
    expect(result.notified).toBe(1);
    expect(twilio.sendContent).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+56912345678',
        contentSid: 'HX-content-1',
        contentVariables: expect.objectContaining({
          '1': 'TR-1',
          '4': 'https://app.test/app/chat/assign-1',
        }),
      }),
    );
  });

  it('Twilio sendContent throwea → errored++', async () => {
    const twilio = {
      sendContent: vi.fn(async () => {
        throw new Error('Twilio API down');
      }),
    } as unknown as TwilioWhatsAppClient;
    const db = makeDb({
      selects: [[CAND_BASE], [{ userId: 'owner', whatsappE164: '+56912345678' }]],
      updates: [[]],
    });
    const result = await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: twilio,
    });
    expect(result.errored).toBe(1);
  });

  it('mensaje foto → preview "📷 Foto adjunta" en variable 3', async () => {
    const twilio = makeTwilio();
    const db = makeDb({
      selects: [
        [{ ...CAND_BASE, messageType: 'foto', textContent: null }],
        [{ userId: 'owner', whatsappE164: '+56912345678' }],
      ],
      updates: [[]],
    });
    await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: twilio,
    });
    const call = (twilio.sendContent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.contentVariables['3']).toContain('📷');
  });

  it('mensaje ubicacion → preview "📍" en variable 3', async () => {
    const twilio = makeTwilio();
    const db = makeDb({
      selects: [
        [{ ...CAND_BASE, messageType: 'ubicacion', textContent: null }],
        [{ userId: 'owner', whatsappE164: '+56912345678' }],
      ],
      updates: [[]],
    });
    await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: twilio,
    });
    const call = (twilio.sendContent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.contentVariables['3']).toContain('📍');
  });

  it('senderName null → fallback a label genérico ("Transportista" o "Generador de carga")', async () => {
    const twilio = makeTwilio();
    const db = makeDb({
      selects: [
        [{ ...CAND_BASE, senderName: null }],
        [{ userId: 'owner', whatsappE164: '+56912345678' }],
      ],
      updates: [[]],
    });
    await procesarMensajesNoLeidos({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
      twilioClient: twilio,
    });
    const call = (twilio.sendContent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.contentVariables['2']).toBe('Transportista');
  });
});
