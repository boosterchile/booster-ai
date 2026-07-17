import tls from 'node:tls';

/**
 * Options del listener TLS del gateway, extraídas a factory para que los
 * tests cubran el código de PRODUCCIÓN (main.ts ejecuta main() al importar
 * — no es importable desde un test).
 *
 * El cert/key vienen del Secret K8s montado por cert-manager
 * (config.TLS_CERT_PATH / TLS_KEY_PATH); esta factory no toca esa fuente.
 */
export function buildTlsServerOptions(cert: Buffer | string, key: Buffer | string): tls.TlsOptions {
  const tlsContext = tls.createSecureContext({
    cert,
    key,
    // Aceptamos TLS 1.2+. Devices Teltonika FMC150 soportan TLS 1.2;
    // 1.3 también pero sin negociación si el firmware es antiguo.
    minVersion: 'TLSv1.2',
  });
  return {
    // Contexto por DEFECTO para clientes sin SNI: Node SOLO invoca el
    // SNICallback si el ClientHello trae la extensión; sin cert/key acá,
    // un cliente sin SNI moría con alert 40 sin recibir certificado
    // (bug nacido en 72d47b4, repro de control 2026-07-15).
    cert,
    key,
    minVersion: 'TLSv1.2',
    // Con SNI, el callback sigue teniendo prioridad y devuelve el MISMO
    // contexto → handshake idéntico para los devices actuales.
    SNICallback: (_servername, cb) => cb(null, tlsContext),
    // Devices Teltonika no presentan client cert — solo verifican el
    // server cert contra raíces públicas. requestCert: false explícito.
    requestCert: false,
  };
}
