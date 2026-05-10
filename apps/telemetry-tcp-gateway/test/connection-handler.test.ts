import { EventEmitter } from 'node:events';
import { crc16Ibm } from '@booster-ai/codec8-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleConnection } from '../src/connection-handler.js';

const noop = (): void => undefined;
const childLogFns = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => childLogFns,
};
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => childLogFns,
} as never;

class FakeSocket extends EventEmitter {
  remoteAddress = '127.0.0.1';
  remotePort = 51234;
  setNoDelay = vi.fn();
  setKeepAlive = vi.fn();
  setTimeout = vi.fn();
  write = vi.fn(() => true);
  destroy = vi.fn(() => {
    this.emit('close');
  });
}

function buildHandshake(imei: string): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(imei.length, 0);
  return Buffer.concat([len, Buffer.from(imei, 'ascii')]);
}

function buildCodec8Packet(records: number): Buffer {
  // Construye un packet codec 0x08 mínimo: cada record tiene timestamp + priority + GPS + io vacío.
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x08, records])); // codec id + count1

  for (let i = 0; i < records; i++) {
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(1700000000000n + BigInt(i), 0);
    parts.push(ts);
    parts.push(Buffer.from([1])); // priority

    const gps = Buffer.alloc(15);
    gps.writeInt32BE(Math.round(-70.65 * 1e7), 0);
    gps.writeInt32BE(Math.round(-33.45 * 1e7), 4);
    gps.writeInt16BE(540, 8);
    gps.writeUInt16BE(180, 10);
    gps.writeUInt8(12, 12);
    gps.writeUInt16BE(85, 13);
    parts.push(gps);

    parts.push(Buffer.from([0, 0])); // eventIoId=0, totalIo=0
    parts.push(Buffer.from([0])); // n1
    parts.push(Buffer.from([0])); // n2
    parts.push(Buffer.from([0])); // n4
    parts.push(Buffer.from([0])); // n8
  }

  parts.push(Buffer.from([records])); // count2

  const dataField = Buffer.concat(parts);
  const preamble = Buffer.alloc(4); // 0x00000000
  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataField.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(dataField) & 0xffff, 0);
  return Buffer.concat([preamble, length, dataField, crc]);
}

const VALID_IMEI = '356307042441013';

interface PublisherStub {
  publishRecord: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}
interface CrashStub {
  publishCrashTrace: ReturnType<typeof vi.fn>;
}

function makePublisher(): PublisherStub {
  return {
    publishRecord: vi.fn(async () => 'msg-id'),
    flush: vi.fn(async () => undefined),
  };
}
function makeCrashPublisher(): CrashStub {
  return {
    publishCrashTrace: vi.fn(async () => 'crash-msg-id'),
  };
}

vi.mock('../src/imei-auth.js', () => ({
  resolveImei: vi.fn(async ({ imei }: { imei: string }) => {
    if (imei === VALID_IMEI) {
      return { vehicleId: 'veh-uuid-1', pendingDeviceId: null };
    }
    return { vehicleId: null, pendingDeviceId: 'pend-1' };
  }),
}));

vi.mock('@booster-ai/codec8-parser', async () => {
  const actual = await vi.importActual<typeof import('@booster-ai/codec8-parser')>(
    '@booster-ai/codec8-parser',
  );
  return {
    ...actual,
    isCrashTracePacket: vi.fn(() => false),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeDeps(opts?: { crashPublisher?: CrashStub | null }) {
  return {
    db: {} as never,
    publisher: makePublisher(),
    crashPublisher: opts?.crashPublisher === undefined ? null : opts.crashPublisher,
    logger: noopLogger,
    idleTimeoutSec: 60,
  };
}

describe('handleConnection', () => {
  it('configura socket flags y registra listeners al inicio', () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    expect(sock.setNoDelay).toHaveBeenCalledWith(true);
    expect(sock.setKeepAlive).toHaveBeenCalledWith(true, 60_000);
    expect(sock.setTimeout).toHaveBeenCalledWith(60_000);
  });

  it('handshake IMEI válido → ACK 1 + resolveImei + lee siguientes packets', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    // 1. mandar handshake
    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));

    expect(sock.write).toHaveBeenCalledWith(Buffer.from([0x01]));

    // 2. mandar AVL packet con 2 records
    sock.emit('data', buildCodec8Packet(2));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.publisher.publishRecord).toHaveBeenCalledTimes(2);

    // 3. ACK BE 4B con count = 2
    const expectedAck = Buffer.alloc(4);
    expectedAck.writeUInt32BE(2, 0);
    expect(sock.write).toHaveBeenCalledWith(expectedAck);
  });

  it('handshake IMEI vacío (length=0) → ACK 0 + destroy', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    // length declarado = 0 → parseImeiHandshake throw
    sock.emit('data', Buffer.from([0x00, 0x00]));
    await new Promise((r) => setTimeout(r, 0));

    expect(sock.write).toHaveBeenCalledWith(Buffer.from([0x00]));
    expect(sock.destroy).toHaveBeenCalled();
  });

  it('IMEI no registrado → resolveImei retorna pendingDeviceId, ACK 1 igual', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake('999888777666555'));
    await new Promise((r) => setTimeout(r, 0));

    // ACK 1 igual aunque IMEI no esté registrado (queda pendiente).
    expect(sock.write).toHaveBeenCalledWith(Buffer.from([0x01]));
  });

  it('AVL packet con preamble inválido → destroy', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));

    // preamble != 0x00000000
    const bogus = Buffer.alloc(8);
    bogus.writeUInt32BE(0xdeadbeef, 0);
    bogus.writeUInt32BE(10, 4);
    sock.emit('data', bogus);
    await new Promise((r) => setTimeout(r, 0));

    expect(sock.destroy).toHaveBeenCalled();
  });

  it('AVL packet con CRC corrupto → ACK 0 + destroy', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));

    const packet = buildCodec8Packet(1);
    // Corromper último byte (CRC).
    packet[packet.length - 1] = (packet[packet.length - 1] ?? 0) ^ 0xff;
    sock.emit('data', packet);
    await new Promise((r) => setTimeout(r, 0));

    const ackZero = Buffer.alloc(4);
    expect(sock.write).toHaveBeenCalledWith(ackZero);
    expect(sock.destroy).toHaveBeenCalled();
  });

  it('descarta Network Pings (0xFF) entre packets sin error', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));

    // Pings + packet válido — el handler debe skipearlos.
    sock.emit('data', Buffer.concat([Buffer.from([0xff, 0xff]), buildCodec8Packet(1)]));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.publisher.publishRecord).toHaveBeenCalledTimes(1);
    expect(sock.destroy).not.toHaveBeenCalled();
  });

  it('chunked read: handshake llega en 2 chunks', async () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);

    const handshake = buildHandshake(VALID_IMEI);
    sock.emit('data', handshake.subarray(0, 5));
    await new Promise((r) => setTimeout(r, 0));
    // Aún no debe haber ACK ni publish.
    expect(sock.write).not.toHaveBeenCalled();

    sock.emit('data', handshake.subarray(5));
    await new Promise((r) => setTimeout(r, 0));
    expect(sock.write).toHaveBeenCalledWith(Buffer.from([0x01]));
  });

  it('socket idle timeout → destroy', () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);
    sock.emit('timeout');
    expect(sock.destroy).toHaveBeenCalled();
  });

  it('socket error event no crashea (warn log only)', () => {
    const sock = new FakeSocket();
    const deps = makeDeps();
    handleConnection(sock as never, deps);
    expect(() => sock.emit('error', new Error('reset'))).not.toThrow();
  });

  it('crash trace publisher se invoca cuando isCrashTracePacket=true', async () => {
    const codecModule = (await import('@booster-ai/codec8-parser')) as unknown as {
      isCrashTracePacket: ReturnType<typeof vi.fn>;
    };
    codecModule.isCrashTracePacket.mockReturnValue(true);

    const crashPub = makeCrashPublisher();
    const sock = new FakeSocket();
    const deps = makeDeps({ crashPublisher: crashPub });
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));
    sock.emit('data', buildCodec8Packet(1));
    await new Promise((r) => setTimeout(r, 0));

    expect(crashPub.publishCrashTrace).toHaveBeenCalledTimes(1);
    codecModule.isCrashTracePacket.mockReturnValue(false);
  });

  it('si crash-trace publish falla, continúa publishing records y ACK ok', async () => {
    const codecModule = (await import('@booster-ai/codec8-parser')) as unknown as {
      isCrashTracePacket: ReturnType<typeof vi.fn>;
    };
    codecModule.isCrashTracePacket.mockReturnValue(true);

    const crashPub = makeCrashPublisher();
    crashPub.publishCrashTrace.mockRejectedValueOnce(new Error('pubsub down'));

    const sock = new FakeSocket();
    const deps = makeDeps({ crashPublisher: crashPub });
    handleConnection(sock as never, deps);

    sock.emit('data', buildHandshake(VALID_IMEI));
    await new Promise((r) => setTimeout(r, 0));
    sock.emit('data', buildCodec8Packet(1));
    await new Promise((r) => setTimeout(r, 0));

    expect(deps.publisher.publishRecord).toHaveBeenCalledTimes(1);
    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(1, 0);
    expect(sock.write).toHaveBeenCalledWith(ack);
    codecModule.isCrashTracePacket.mockReturnValue(false);
  });
});
