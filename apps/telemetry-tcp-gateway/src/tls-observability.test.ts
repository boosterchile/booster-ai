import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import forge from 'node-forge';
import { afterEach, describe, expect, it, vi } from 'vitest';
// RED: `tls-observability.ts` aún no existe. Bug verificado en prod (2026-07-14):
// el handler inline de tlsClientError (main.ts:165-174) loguea remoteAddress
// VACÍO en el 100% de los fallos (12 filas/20min) y un mensaje que AFIRMA una
// causa ("cert chain inválido o protocolo viejo") que contradice el err.code
// real (ECONNRESET = el cliente cortó). Sin IP no se distingue un device de un
// scanner (el 5061 está indexado por Censys/Shodan).
import { attachTlsObservability } from './tls-observability.js';

/**
 * Cert self-signed minteado EN RUNTIME (nunca un PEM commiteado — gitleaks).
 * Keygen nativo (rápido) + firma X.509 con node-forge. Solo para levantar el
 * tls.Server del test; el caso de fallo ni siquiera llega a validar el cert.
 */
function mintCertLocalhost(): { key: string; cert: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 24 * 3600 * 1000);
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  return { key: privateKey, cert: forge.pki.certificateToPem(cert) };
}

interface WarnCall {
  fields: Record<string, unknown>;
  msg: string;
}

function makeLoggerSpy() {
  const warns: WarnCall[] = [];
  const warn = vi.fn((fields: Record<string, unknown>, msg: string) => {
    warns.push({ fields, msg });
  });
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
    fatal: vi.fn(),
    child() {
      return this;
    },
  } as never;
  return { logger, warns };
}

async function listen(server: tls.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('sin puerto asignado');
  }
  return addr.port;
}

/** Espera hasta que `cond()` sea true o venza el timeout. */
async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout esperando la condición');
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('attachTlsObservability', () => {
  const servers: tls.Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('handshake abortado → warn con remoteAddress NO vacío, remotePort, y err.code/message crudos', async () => {
    const { key, cert } = mintCertLocalhost();
    const { logger, warns } = makeLoggerSpy();
    const server = tls.createServer({ key, cert, minVersion: 'TLSv1.2' });
    servers.push(server);
    attachTlsObservability(server, logger);
    const port = await listen(server);

    // Cliente que abre TCP, manda bytes que NO son un ClientHello y corta —
    // exactamente lo que hace un scanner (y lo que produce el ECONNRESET de prod).
    const client = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
    client.write(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
    client.destroy();

    await waitFor(() => warns.length > 0);
    const w = warns[0];
    expect(w).toBeDefined();
    if (!w) {
      return;
    }
    // CRITERIO 1: la IP de origen NO se pierde (prod hoy: vacía en el 100%).
    expect(w.fields.remoteAddress).toBeTruthy();
    expect(String(w.fields.remoteAddress)).toContain('127.0.0.1');
    expect(w.fields.remotePort).toBeTypeOf('number');
    // CRITERIO 2: err.code y err.message crudos, sin causa inventada.
    expect(
      (typeof w.fields.errCode === 'string' && w.fields.errCode.length > 0) ||
        (typeof w.fields.errMessage === 'string' && w.fields.errMessage.length > 0),
    ).toBe(true);
    // El mensaje NO afirma una causa que el err.code puede contradecir.
    expect(w.msg).toBe('tls handshake fallido');
    expect(w.msg).not.toMatch(/cert chain|protocolo viejo/i);
  });

  it('handshake OK → cero warns y la conexión funciona (solo observabilidad, sin cambio de red)', async () => {
    const { key, cert } = mintCertLocalhost();
    const { logger, warns } = makeLoggerSpy();
    const conexionesOk = vi.fn();
    const server = tls.createServer({ key, cert, minVersion: 'TLSv1.2' }, conexionesOk);
    servers.push(server);
    attachTlsObservability(server, logger);
    const port = await listen(server);

    const client = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
    await new Promise<void>((resolve, reject) => {
      client.once('secureConnect', () => resolve());
      client.once('error', reject);
    });
    client.end();

    await waitFor(() => conexionesOk.mock.calls.length > 0);
    expect(conexionesOk).toHaveBeenCalledTimes(1); // el path de red sigue intacto
    expect(warns.length).toBe(0); // sin falsos positivos en handshake sano
  });
});

describe('attachTlsObservability — degradación (sin _parent / sin peername)', () => {
  it('TLSSocket sin _parent (Node cambió la interna) → degrada a socket.remoteAddress; err sin code → errCode null', () => {
    const { logger, warns } = makeLoggerSpy();
    const fakeServer = new EventEmitter();
    attachTlsObservability(fakeServer as never, logger);

    // Sin 'connection' previo y sin _parent: el puente devuelve null y el
    // handler cae al read directo del socket (que acá SÍ tiene valor).
    const fakeTlsSocket = { remoteAddress: '10.0.0.9', remotePort: 4444 };
    fakeServer.emit('tlsClientError', new Error('boom sin code'), fakeTlsSocket);

    expect(warns.length).toBe(1);
    const w = warns[0];
    if (!w) {
      return;
    }
    expect(w.fields.remoteAddress).toBe('10.0.0.9');
    expect(w.fields.remotePort).toBe(4444);
    expect(w.fields.errCode).toBeNull(); // err.code ausente → null explícito, no undefined
    expect(w.fields.errMessage).toBe('boom sin code');
  });

  it('raw socket sin peername (nunca conectado) + socket destruido → null/null, jamás revienta', () => {
    const { logger, warns } = makeLoggerSpy();
    const fakeServer = new EventEmitter();
    attachTlsObservability(fakeServer as never, logger);

    const rawSinPeer = new net.Socket(); // unconnected → remoteAddress undefined
    fakeServer.emit('connection', rawSinPeer);
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const fakeTlsSocket = { remoteAddress: undefined, remotePort: undefined, _parent: rawSinPeer };
    fakeServer.emit('tlsClientError', err, fakeTlsSocket);

    expect(warns.length).toBe(1);
    const w = warns[0];
    if (!w) {
      return;
    }
    expect(w.fields.remoteAddress).toBeNull();
    expect(w.fields.remotePort).toBeNull();
    expect(w.fields.errCode).toBe('ECONNRESET');
  });
});
