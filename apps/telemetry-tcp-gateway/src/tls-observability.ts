import net from 'node:net';
import type tls from 'node:tls';
import type { Logger } from '@booster-ai/logger';

/**
 * Observabilidad de fallos de handshake TLS (puerto 5061).
 *
 * Dos bugs de observabilidad que este módulo corrige (verificados en prod,
 * 2026-07-14: 12 warns en 20 min, remoteAddress vacío en el 100%,
 * err.code=ECONNRESET en las muestras):
 *
 *   1. **La IP se perdía.** Cuando el handshake falla, Node destruye el
 *      TLSSocket ANTES de emitir 'tlsClientError' → `socket.remoteAddress`
 *      ya devuelve undefined en el handler. El peername hay que capturarlo
 *      ANTES: el evento 'connection' (net.Server) entrega el socket TCP
 *      crudo pre-handshake, con el peername garantizado vivo. Sin IP no se
 *      distingue un device Teltonika de un scanner de internet (el 5061
 *      está indexado por Censys/Shodan).
 *
 *   2. **El mensaje afirmaba una causa.** "cert chain inválido o protocolo
 *      viejo" era una conjetura que el err.code real contradice (ECONNRESET
 *      = el cliente cortó el socket, típico de scanners). El log emite el
 *      hecho crudo — err.code + err.message — y deja el diagnóstico al
 *      operador.
 *
 * SOLO observabilidad: no toca el comportamiento de red (no destroy, no
 * write, no timeouts). Node ya destruye el socket fallido por su cuenta.
 */

interface PeerInfo {
  remoteAddress: string | null;
  remotePort: number | null;
}

/**
 * Puente TLSSocket → socket TCP crudo. `_parent` es API interna de Node
 * (estable Node 8 → 24; el TLSSocket en modo wrap guarda ahí el net.Socket
 * original). Se valida en runtime con `instanceof` — si un bump de Node la
 * rompe, devuelve null (degrada a `socket.remoteAddress`) y el test de este
 * módulo falla en CI, que es la alarma correcta.
 */
function socketCrudo(socket: tls.TLSSocket): net.Socket | null {
  const candidate = (socket as tls.TLSSocket & { _parent?: unknown })._parent;
  return candidate instanceof net.Socket ? candidate : null;
}

export function attachTlsObservability(server: tls.Server, logger: Logger): void {
  const peers = new WeakMap<net.Socket, PeerInfo>();

  // 'connection' (heredado de net.Server) entrega el socket TCP crudo ANTES
  // del handshake TLS — el único momento donde el peername está garantizado.
  server.on('connection', (raw: net.Socket) => {
    peers.set(raw, {
      remoteAddress: raw.remoteAddress ?? null,
      remotePort: raw.remotePort ?? null,
    });
  });

  server.on('tlsClientError', (err: Error & { code?: string }, socket: tls.TLSSocket) => {
    const raw = socketCrudo(socket);
    const peer = raw ? (peers.get(raw) ?? null) : null;
    logger.warn(
      {
        err,
        errCode: err.code ?? null,
        errMessage: err.message,
        // El socket ya suele estar destruido acá → preferimos el peer
        // capturado en 'connection'; el read directo queda de fallback.
        remoteAddress: peer?.remoteAddress ?? socket.remoteAddress ?? null,
        remotePort: peer?.remotePort ?? socket.remotePort ?? null,
      },
      'tls handshake fallido',
    );
  });
}
