# Verify — Observabilidad real del handshake TLS fallido (telemetry-tcp-gateway)

Evidencia corrida el 2026-07-14 bajo node@24 (Homebrew `/opt/homebrew/opt/node@24`;
el node default del host es v26 y el repo pinea 24 — correr tests bajo 26 despista).

## Criterio 1 y 2 — IP + puerto, undefined→null, mensaje neutro con err crudos

- `apps/telemetry-tcp-gateway/src/tls-observability.ts`: captura peername en el
  evento `'connection'` (socket TCP crudo PRE-handshake, único momento con peername
  garantizado); puente TLSSocket→raw vía `_parent` validado con `instanceof`
  (degrada a `socket.remoteAddress` si un bump de Node rompe la interna — y el test
  E2E lo alarma en CI); `errCode: err.code ?? null` / `errMessage` crudos; mensaje
  `'tls handshake fallido'`.
- Rojo exhibido en `3f81f8e` (output en el PR); verde en `5c97965`.
- Tests de degradación (este cierre): sin `_parent` → fallback a
  `socket.remoteAddress`; raw socket sin peername → `null`/`null` sin romper, con
  `errCode: 'ECONNRESET'`.
- **Mutation check** (los tests de degradación pasan de inmediato porque pinean
  código ya implementado — para probar que muerden se rompió `err.code ?? null` →
  `err.code`): 1 test falló (`errCode` esperaba `null`, llegó `undefined`) →
  revertido. 49/49 verde tras revertir.
- **Logger real end-to-end** (tsx + `createLogger` de producción, no el spy del
  test): `remoteAddress` IPv4 (`167.94.146.55`) e IPv6-mapped
  (`::ffff:167.94.146.55`) sobreviven las DOS capas de redaction PII del logger
  (path-based: `*.address` matchea la key `address`, no `remoteAddress`;
  value-based: `PHONE_RE` no incluye `.`/`:` en su clase media y `RUT_RE` exige 7-8
  dígitos corridos — ninguno matchea una IP). `errCode`/`errMessage` intactos,
  `severity: WARNING` (mismo nivel `warn` de antes → criterio 5 OK).

```
{"remoteAddress":"167.94.146.55","remotePort":43210,"errCode":"ECONNRESET","errMessage":"read ECONNRESET","message":"tls handshake fallido","severity":"WARNING"}
{"remoteAddress":"::ffff:167.94.146.55","remotePort":1,"errCode":null,"errMessage":"x","message":"tls handshake fallido","severity":"WARNING"}
```

- Grep del string viejo en el repo: 0 matches como mensaje emitido. Menciones
  restantes legítimas: docstring de `tls-observability.ts` (documenta el bug) y
  `scripts/smoke-test-wave-3-tls.sh:113` (ahí "cert chain inválido" sale de una
  verificación real con openssl, no de una conjetura).

## Criterio 3 — auditoría de los otros handlers

| archivo:línea | ¿tiene IP? | ¿miente? |
|---|---|---|
| `connection-handler.ts:120` (socket error) | SÍ — child logger bindings `sourceIp`/`sourcePort` (:93-98); propagación verificada empíricamente con pino | NO — "socket error" no afirma causa; el `err` serializado trae `code`+`message`+`stack` |
| `connection-handler.ts:115` (idle timeout) | SÍ — mismos bindings | NO — el evento `'timeout'` ES el idle timer configurado en :112; la causa la garantiza el evento |
| `connection-handler.ts:203-207` (preamble) | SÍ — `opts.logger` = childLogger (:137) | NO — respaldado por el check directo `preamble !== 0x00000000` y loguea el valor real en hex |
| `main.ts:96-102` (cap concurrente) | SÍ — `sourceIp` explícito (:100) | NO — `tryAcquire()` falló = causa directa; loguea `active`/`max` |

Los 4 PASAN → sin fixes adicionales. El único handler que fallaba ambas preguntas
era `tlsClientError` (main.ts:165-174 pre-fix), corregido en `5c97965`.

## Criterio 4 — test en CI

`tls-observability.test.ts` corre bajo el `vitest run` estándar del workspace
(turbo `test` lo incluye en CI). Caso E2E real: cliente `net.connect` manda bytes
no-ClientHello y corta → warn con `remoteAddress` conteniendo `127.0.0.1`,
`remotePort` numérico y `errCode`/`errMessage` no vacíos. Caso de no-regresión de
red: handshake sano → 0 warns y la conexión sigue funcionando.

## Criterio 5 — sin cambios de niveles ni alertas

El handler emite `warn` igual que el código pre-fix (diff de `5c97965` lo muestra);
no se tocó configuración de alertas. Verificado también en el output del logger real
(`severity: WARNING`).

## Suite / calidad (fresca, ver PR para output completo)

- Tests: 49/49 verde (7 files). Coverage `tls-observability.ts`: 100% stmts/líneas/
  funcs, 94.4% branches (umbral 80/80/75/80 del workspace: OK).
- Lint (biome), typecheck (tsc), build (tsup): output en la sección Evidencia del PR.

## Pendiente post-deploy (monitoreo 2h)

- [ ] Grep en Cloud Logging del string viejo (`cert chain inválido o protocolo
      viejo`) → 0 matches tras el rollout.
- [ ] Confirmar que los warns de `tls handshake fallido` traen `remoteAddress`
      poblado (≠ null en la mayoría; null solo es esperable en resets pre-accept).
- [ ] Con las IPs a la vista: resolver la bifurcación (a) camión llega y falla TLS
      vs (b) camión nunca llega (las IPs observadas serían solo scanners).
