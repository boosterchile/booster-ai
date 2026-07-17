import crypto from 'node:crypto';
import tls from 'node:tls';
import forge from 'node-forge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTlsServerOptions } from './tls-server.js';

/**
 * Bug SNI (nacido en 72d47b4): con el cert SOLO dentro del SNICallback,
 * Node no tiene contexto por defecto — un ClientHello SIN la extensión SNI
 * (firmware Teltonika que no la mande, server configurado por IP) moría
 * con alert 40 sin recibir certificado. Verificado con experimento de
 * control 2026-07-15: conSni ok / sinSni handshake failure.
 *
 * Cert minteado en runtime (jamás un PEM commiteado — gitleaks), mismo
 * patrón que tls-observability.test.ts, con SAN localhost + 127.0.0.1
 * para que el cliente valide DE VERDAD pineando la CA.
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
  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' }, // dNSName
        { type: 7, ip: '127.0.0.1' }, // iPAddress
      ],
    },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  return { key: privateKey, cert: forge.pki.certificateToPem(cert) };
}

async function listen(server: tls.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('sin puerto asignado');
  }
  return addr.port;
}

function handshake(opts: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const client = tls.connect(opts, () => resolve(client));
    client.once('error', reject);
  });
}

describe('buildTlsServerOptions — SNI y contexto por defecto', () => {
  const servers: tls.Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('cliente SIN SNI completa el handshake (firmware sin la extensión / server por IP)', async () => {
    const { key, cert } = mintCertLocalhost();
    const server = tls.createServer(buildTlsServerOptions(cert, key), (s) => s.end());
    servers.push(server);
    const port = await listen(server);

    // host IP + sin servername → Node NO emite la extensión SNI
    // (RFC 6066 prohíbe IP literales en SNI). CA pineada: validación real.
    const client = await handshake({ port, host: '127.0.0.1', ca: [cert] });
    expect(client.authorized).toBe(true);
    client.end();
  });

  it('cliente CON SNI: invariante — handshake OK y el SNICallback se sigue invocando', async () => {
    const { key, cert } = mintCertLocalhost();
    const opts = buildTlsServerOptions(cert, key);
    const originalSni = opts.SNICallback;
    if (!originalSni) {
      throw new Error('la factory debe conservar el SNICallback (cambio mínimo)');
    }
    const sniSpy = vi.fn(originalSni);
    const server = tls.createServer({ ...opts, SNICallback: sniSpy }, (s) => s.end());
    servers.push(server);
    const port = await listen(server);

    const client = await handshake({
      port,
      host: '127.0.0.1',
      servername: 'localhost', // ClientHello CON extensión SNI
      ca: [cert],
    });
    expect(client.authorized).toBe(true);
    expect(sniSpy).toHaveBeenCalledTimes(1);
    expect(sniSpy.mock.calls[0]?.[0]).toBe('localhost');
    client.end();
  });

  it('requestCert se mantiene en false (los FMC150 no presentan client cert)', () => {
    const { key, cert } = mintCertLocalhost();
    expect(buildTlsServerOptions(cert, key).requestCert).toBe(false);
  });
});
