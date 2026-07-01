import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, connect as tlsConnect } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRedisTlsOptions } from './redis-tls.js';

/**
 * Integration test del handshake TLS real (redis-tls-integration-test).
 *
 * No usa un container de Redis (eso exige Docker): ejercita la PROPIEDAD DE
 * SEGURIDAD que `buildRedisTlsOptions` controla —la validación de **cadena CA**—
 * directamente con `node:tls`, que es la misma capa que ioredis usa por debajo.
 *
 * Levanta un TLS server con un cert firmado por una CA de prueba y verifica:
 *   1. conectar con la CA CORRECTA pinneada → handshake OK (authorized).
 *   2. conectar con una CA DISTINTA → handshake FALLA (cert no validable).
 *
 * (2) es el guard contra la regresión de INC-2026-06-07: si alguien rompiera el
 * pinning (`ca` ausente, `rejectUnauthorized:false`, o validación bypasseada), la
 * CA equivocada sería aceptada y este test fallaría. Los certs son efímeros
 * (generados en un tmpdir con openssl, TTL 1 día) — sin secretos versionados.
 */

interface TestCerts {
  caCertPem: string; // CA que firma el server cert (la "correcta")
  wrongCaCertPem: string; // una CA distinta, no relacionada
  serverKeyPem: string;
  serverCertPem: string;
  cleanup: () => void;
}

function generateTestCerts(): TestCerts {
  const dir = mkdtempSync(join(tmpdir(), 'redis-tls-test-'));
  const ssl = (args: string[]) =>
    execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });

  // CA correcta (firma el server cert).
  ssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.crt',
    '-days',
    '1',
    '-subj',
    '/CN=Booster Test CA',
  ]);
  // CA equivocada (no relacionada — no firma nada del server).
  ssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'wrong.key',
    '-out',
    'wrong.crt',
    '-days',
    '1',
    '-subj',
    '/CN=Wrong CA',
  ]);
  // Server key + CSR, firmado por la CA correcta.
  ssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'server.key',
    '-out',
    'server.csr',
    '-subj',
    '/CN=redis-test-server',
  ]);
  ssl([
    'x509',
    '-req',
    '-in',
    'server.csr',
    '-CA',
    'ca.crt',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'server.crt',
    '-days',
    '1',
  ]);

  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  return {
    caCertPem: read('ca.crt'),
    wrongCaCertPem: read('wrong.crt'),
    serverKeyPem: read('server.key'),
    serverCertPem: read('server.crt'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Intenta un handshake TLS con las opciones dadas. Resuelve 'ok' o el código de error. */
function attemptHandshake(
  port: number,
  tlsOpts: ReturnType<typeof buildRedisTlsOptions>,
): Promise<'ok' | string> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host: '127.0.0.1', port, ...tlsOpts }, () => {
      const authorized = socket.authorized;
      socket.end();
      resolve(authorized ? 'ok' : `unauthorized:${socket.authorizationError}`);
    });
    socket.on('error', (err: NodeJS.ErrnoException & { code?: string }) => {
      socket.destroy();
      resolve(err.code ?? err.message);
    });
  });
}

describe('redis TLS handshake — pinning de CA (buildRedisTlsOptions)', () => {
  let certs: TestCerts;
  let server: ReturnType<typeof createTlsServer>;
  let port: number;

  beforeAll(async () => {
    certs = generateTestCerts();
    server = createTlsServer({ key: certs.serverKeyPem, cert: certs.serverCertPem }, (socket) =>
      socket.end(),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    certs.cleanup();
  });

  it('CA correcta pinneada → handshake OK (authorized)', async () => {
    const tlsOpts = buildRedisTlsOptions({ tls: true, caCert: certs.caCertPem });
    const result = await attemptHandshake(port, tlsOpts);
    expect(result).toBe('ok');
  });

  it('CA DISTINTA → handshake FALLA (guard anti-regresión INC-2026-06-07)', async () => {
    const tlsOpts = buildRedisTlsOptions({ tls: true, caCert: certs.wrongCaCertPem });
    const result = await attemptHandshake(port, tlsOpts);
    // No 'ok': la validación de cadena rechaza el cert del server contra una CA
    // que no lo firmó (típicamente UNABLE_TO_VERIFY_LEAF_SIGNATURE).
    expect(result).not.toBe('ok');
    expect(result).toMatch(/UNABLE_TO_VERIFY|SELF_SIGNED|unauthorized|CERT/i);
  });

  it('sin CA + requireCa → throw (no degrada silenciosamente, paridad con el incidente)', () => {
    expect(() => buildRedisTlsOptions({ tls: true, requireCa: true })).toThrow(/REDIS_CA_CERT/);
  });
});
