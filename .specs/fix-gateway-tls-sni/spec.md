# Spec — fix/gateway-tls-sni-default-cert

## Contexto

El listener TLS del gateway (nacido en `72d47b4`, Wave 3) creaba `tls.createServer` con el
cert SOLO dentro del `SNICallback` — Node no invoca ese callback si el ClientHello no trae
la extensión SNI, y sin contexto por defecto el handshake muere con alert 40
(`ERR_SSL_NO_SUITABLE_SIGNATURE_ALGORITHM`). Verificado con experimento de control
(2026-07-15): conSni ok / sinSni falla; con el fix ambos ok. No fue la causa del incidente
de mayo (CA faltante, ECONNRESET), pero es fragilidad real de cara a los ~10 camiones
CORFO: un firmware sin SNI hoy sería un "no conecta" indistinguible del incidente de CA.

## Entradas / salidas

- **Entrada**: ClientHello al puerto 5061, con o sin extensión SNI.
- **Salida**: handshake completo en ambos casos, con el mismo certificado (fuente única:
  Secret de cert-manager vía `TLS_CERT_PATH`/`TLS_KEY_PATH`, sin duplicar).

## Criterios de éxito

1. `buildTlsServerOptions(cert, key)` extraída a `tls-server.ts` (factory testeable —
   main.ts ejecuta `main()` al importar); `tls.createServer` de main.ts la consume.
2. Fix: `cert`, `key`, `minVersion: 'TLSv1.2'` en la RAÍZ de las options, conservando el
   `SNICallback` (cambio mínimo) y `requestCert: false`.
3. TDD con rojo exhibido: test sin-SNI contra la factory en su forma buggy → alert 40
   literal; verde con el fix. Test con-SNI invariante: handshake OK y el SNICallback
   invocado con el servername (no-regresión de VFZH-68/PLFL57/KZBB26/KZXB64).
4. Suite gateway + tsc + biome verdes. PR sin merge (PO).

## Fuera de alcance

Pipeline de cert-manager (fuente del cert intacta) · eliminar el SNICallback (peso muerto
con el cert en raíz — candidato a limpieza futura, no parte del cambio mínimo).
