# «Confirmar recogida» → 500: cuerpo vacío con Content-Type json + onError opaco

**Estado**: aceptada · **Fecha**: 2026-09-14 · **Pedido por**: PO (tap en el iPhone: «No pudimos registrar la recogida. Avísale a tu empresa»)

## 1. El problema (medido en producción)

`PATCH /assignments/d087f1ef…/confirmar-recogida` → **500** a las 13:04:27Z; log
`unhandled error {"err": {"status": 400}}`. Dos causas encadenadas:

1. Para el tap manual (sin geofence) la PWA llama `api.patch(url)` **sin cuerpo**,
   pero `api-client.ts` pone `Content-Type: application/json` siempre. El
   validador json de Hono, al ver ese header, hace `c.req.json()` sobre un cuerpo
   vacío y lanza `HTTPException(400, 'Malformed JSON in request body')`.
   Sin el header, el validador no parsea nada, el schema (todo opcional) recibe
   `{}` y la recogida se registra (así lo prueban los tests de la ruta).
2. `app.onError` en `server.ts` convierte **cualquier** error en 500
   `internal_server_error`, incluidas las `HTTPException` que el propio framework
   lanza con un status y un mensaje pensados para el cliente. El 400 se volvió un
   500 opaco y el logger, además, pierde el mensaje (deuda ya anotada).

## 2. Entradas y salidas

- `apps/web/src/lib/api-client.ts`: `Content-Type: application/json` solo cuando
  hay cuerpo. Sin cuerpo, sin header (semántica HTTP correcta). Los demás headers
  (Authorization, X-Empresa-Id) no cambian.
- `apps/api/src/server.ts` `onError`: si `err instanceof HTTPException` →
  `err.getResponse()` (status y mensaje del framework), con log `warn` de
  `{ status, message, path }`; cualquier otro error sigue siendo 500
  `internal_server_error` con log `error`. Es el comportamiento por defecto de
  Hono que el handler propio había pisado.
- Contrato HTTP: las respuestas 4xx que hoy salían como 500 pasan a salir con su
  status real. Ningún 2xx cambia.

## 3. Criterios de salida

- [x] Rojo exhibido: test del cliente (patch sin body no manda Content-Type) y
      tests de `createServer` (HTTPException 400 → 400; validador json con
      cuerpo vacío → 400; Error genérico → 500).
- [x] Verde: esos tests + suites de `apps/web` y `apps/api`, typecheck, biome.
- [x] En producción: el tap «Confirmar recogida» en BOO-BKAXIK registra la
      recogida (asignación en `recogido`, `recogido_en` poblado). — verificado 2026-09-22: PATCH 200 2026-09-14T16:44:35Z en api-00590-bik (commit 2388bb43 ⊇ #681); evento recogida_confirmada (picked_up_at_source=servidor = tap sin cuerpo, fvp@live.cl), recogido_en 16:44:36Z; hoy `entregado` (17:01:57Z); 0 respuestas 500 en confirmar-recogida desde el fix (Cloud Logging).
