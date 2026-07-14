# Spec — Observabilidad real del handshake TLS fallido (telemetry-tcp-gateway)

> **Nota de proceso**: esta spec se escribe RETROACTIVA al primer commit de código
> (`3f81f8e` rojo / `5c97965` fix, misma rama, misma sesión de trabajo). El contrato
> exige spec antes del primer commit; se declara la desviación aquí y en el PR en vez
> de silenciarla. El contenido refleja los criterios fijados por el PO, no lo que el
> código "resultó" hacer.

## Problema

Un vehículo (patente KZBB26; el IMEI vive en `vehiculos` y **no se transcribe** a
docs/PRs) lleva 0 puntos de telemetría desde el 2026-06-22, con el pipeline vivo
(VFZH-68 emitió 102 puntos en 2h por el mismo gateway). Un device encendido acumula
records en flash: la primera conexión exitosa habría volcado el backlog → 0 filas en
3 semanas = cero conexiones exitosas, jamás.

Queda una bifurcación que los logs actuales no permiten resolver:

- (a) el device abre el socket y el handshake TLS falla → el corte es TLS;
- (b) nunca abre el socket → red / APN / endpoint en flash.

Dos bugs de observabilidad lo impiden (verificados en prod 2026-07-14, ~12 filas
cada 20 min):

1. **El mensaje miente**: `'tls handshake error — cliente con cert chain inválido o
   protocolo viejo'` afirma una causa que el `err.code` real contradice
   (`ECONNRESET` en las 3 filas muestreadas = el cliente cortó el socket). Costó una
   hora de diagnóstico.
2. **`remoteAddress` se pierde**: vacío en el 100% de las filas. Node destruye el
   TLSSocket antes de emitir `tlsClientError` → el peername ya no está. Sin IP no se
   distingue el camión de un scanner: el 5061 está indexado por Censys/Shodan
   (ClientHellos reales desde 167.94.146.55, 205.210.31.75, 87.236.176.x,
   195.96.139.x, 185.247.137.x).

## Alcance

**SOLO logging.** Cero cambio de comportamiento de red (no destroy, no write, no
timeouts, no niveles de log nuevos, no alertas).

## Criterios de éxito (verificables)

1. `tlsClientError` loguea `remoteAddress` y `remotePort`. En ECONNRESET el socket
   puede venir sin peername: el `undefined` se maneja explícito (se loguea `null`,
   no revienta).
2. El mensaje deja de afirmar una causa. `err.code` y `err.message` crudos como
   campos estructurados; texto neutro. **Criterio**: grep del string viejo → sin
   matches en prod (verificable post-deploy; en repo: sin matches como mensaje
   emitido).
3. Auditoría de los otros handlers por el mismo bug: `connection-handler.ts:120`
   (socket error), `:115` (idle timeout), `:203-207` (preamble), `main.ts:101`
   (cap concurrente). Por cada uno: (a) ¿loguea IP de origen? (b) ¿el mensaje afirma
   una causa que el error no respalda? Salida: tabla `archivo:línea | tiene IP? |
   miente?`. Arreglar los que fallen.
4. TEST (TDD, rojo primero): cliente que abre TCP contra el listener TLS y corta a
   mitad de handshake → el log lleva `remoteAddress` no-vacío y el `err.code` real.
   Corre en CI.
5. NO cambiar niveles de log ni agregar alertas (otro PR, decisión PO).

## Fuera de alcance / ya resuelto

- "handshake IMEI completado" con 0 filas en 20 min NO es bug: el `.cfg` del device
  tiene Send Period 120s y Min Period en STOP 3600s → un vehículo detenido conecta
  poco. No investigar.
- Resolver la bifurcación (a)/(b) en sí: eso es lo que estos logs habilitan, no lo
  que este PR entrega.
