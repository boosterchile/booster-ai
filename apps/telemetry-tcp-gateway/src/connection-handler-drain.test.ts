import { describe, expect, it, vi } from 'vitest';

/**
 * Wiring drain ↔ connection-handler: un socket con packet EN VUELO
 * (publish+ACK a medias) no puede cerrarse hasta quiescencia. Codec y
 * resolución de IMEI van mockeados — acá se prueba el ciclo de vida, no
 * el parseo (eso ya lo cubren los tests del parser).
 */

vi.mock('@booster-ai/codec8-parser', () => {
  class CodecCrcError extends Error {}
  class CodecParseError extends Error {}
  return {
    CodecCrcError,
    CodecParseError,
    parseImeiHandshake: () => ({ imei: '860693088550059' }),
    parseAvlPacket: () => ({
      codecId: 8,
      recordCount: 1,
      records: [
        {
          timestampMs: 1n,
          priority: 0,
          gps: { longitude: 0, latitude: 0, altitude: 0, angle: 0, satellites: 0, speedKmh: 0 },
          io: { eventIoId: 0, totalIo: 0, entries: [] },
        },
      ],
    }),
    isCrashTracePacket: () => false,
    encodeImeiAck: (ok: boolean) => Buffer.from([ok ? 1 : 0]),
    encodeAvlAck: (n: number) => Buffer.from([0, 0, 0, n]),
  };
});

vi.mock('./imei-auth.js', () => ({
  resolveImei: async () => ({ vehicleId: 'veh-1', pendingDeviceId: null }),
}));

const { handleConnection } = await import('./connection-handler.js');
const { createDrainController } = await import('./drain.js');

function makeLoggerSpy() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child() {
      return this;
    },
  } as never;
  return logger;
}

function makeFakeSocket() {
  const order: string[] = [];
  const handlers = new Map<string, (arg?: unknown) => void>();
  const closeCbs: Array<() => void> = [];
  const socket = {
    remoteAddress: '10.0.0.1',
    remotePort: 40000,
    setNoDelay: vi.fn(),
    setKeepAlive: vi.fn(),
    setTimeout: vi.fn(),
    on: (event: string, cb: (arg?: unknown) => void) => {
      handlers.set(event, cb);
      return socket;
    },
    once: (event: string, cb: () => void) => {
      if (event === 'close') {
        closeCbs.push(cb);
      }
      return socket;
    },
    write: vi.fn((buf: Buffer) => {
      order.push(`write:${buf.toString('hex')}`);
      return true;
    }),
    end: vi.fn(() => {
      order.push('end');
      for (const cb of closeCbs.splice(0)) {
        cb();
      }
    }),
    destroy: vi.fn(() => {
      order.push('destroy');
      for (const cb of closeCbs.splice(0)) {
        cb();
      }
    }),
  };
  return { socket, order, handlers };
}

function makeDeferredPublisher() {
  const pending: Array<(id: string) => void> = [];
  const publisher = {
    publishRecord: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          pending.push(resolve);
        }),
    ),
  };
  return { publisher, pending };
}

const IMEI_CHUNK = Buffer.concat([Buffer.from([0x00, 0x0f]), Buffer.from('860693088550059')]);
// preamble(4B=0) + dataLen(4B=2) + 2B data + 4B crc — el parser va mockeado.
const AVL_CHUNK = Buffer.concat([
  Buffer.from([0, 0, 0, 0, 0, 0, 0, 2]),
  Buffer.from([0xaa, 0xbb]),
  Buffer.from([0, 0, 0, 0]),
]);
const AVL_ACK_HEX = '00000001';

const tick = () => new Promise((r) => setTimeout(r, 0));

async function montarConexion() {
  const { socket, order, handlers } = makeFakeSocket();
  const { publisher, pending } = makeDeferredPublisher();
  const drain = createDrainController(makeLoggerSpy());
  drain.register(socket);
  handleConnection(socket as never, {
    db: {} as never,
    publisher: publisher as never,
    crashPublisher: null,
    logger: makeLoggerSpy(),
    idleTimeoutSec: 300,
    enrollmentLimiter: { tryConsume: () => true },
    drain,
  });
  const data = handlers.get('data');
  if (!data) {
    throw new Error('handler data no registrado');
  }
  data(IMEI_CHUNK);
  await tick(); // resolveImei + ImeiAck
  return { socket, order, pending, drain, data };
}

describe('drain ↔ connection-handler (quiescencia real)', () => {
  it('packet EN VUELO: el drain NO corta; espera publish+ACK y recién ahí FIN limpio', async () => {
    const { socket, order, pending, drain, data } = await montarConexion();
    data(AVL_CHUNK); // processBuffer arranca; publish queda pendiente
    await tick();
    expect(pending).toHaveLength(1); // publish en vuelo

    const p = drain.drain(1_000);
    // El corazón del fix: con op en vuelo el socket NO se toca.
    expect(socket.end).not.toHaveBeenCalled();

    pending[0]?.('msg-1'); // Pub/Sub confirma
    await tick();

    // ACK al device ANTES del FIN — el device NO reenvía este lote.
    const ackIdx = order.indexOf(`write:${AVL_ACK_HEX}`);
    const endIdx = order.indexOf('end');
    expect(ackIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(ackIdx).toBeLessThan(endIdx);

    await expect(p).resolves.toMatchObject({ outcome: 'drained' });
  });

  it('re-entrada: DOS processBuffer en vuelo → cierra recién cuando el último termina', async () => {
    const { socket, pending, drain, data } = await montarConexion();
    data(AVL_CHUNK);
    await tick();
    data(AVL_CHUNK);
    await tick();
    expect(pending).toHaveLength(2);

    void drain.drain(1_000);
    pending[0]?.('msg-1');
    await tick();
    expect(socket.end).not.toHaveBeenCalled(); // queda 1 en vuelo

    pending[1]?.('msg-2');
    await tick();
    expect(socket.end).toHaveBeenCalledTimes(1);
  });

  it('socket idle (handshake hecho, sin packet en vuelo) → drain cierra de inmediato', async () => {
    const { socket, drain } = await montarConexion();
    const p = drain.drain(1_000);
    expect(socket.end).toHaveBeenCalledTimes(1);
    await expect(p).resolves.toMatchObject({ outcome: 'drained' });
  });
});
