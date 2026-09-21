# Wake lock de pantalla mientras el conductor reporta

**Estado**: aceptada por el pedido de producto (complemento corto de la semana de UX web) · **Slot**: 3 «Conductor operativo», junto al GPS resiliente (`.specs/conductor-gps-resiliente/`).

No abre ADR. No cambia API, schema ni copy. El wake lock **no** habilita GPS en segundo plano: solo hace más probable que la pantalla siga encendida mientras el conductor permanece en Conductor y el documento está visible. Con la app cerrada, Maps al frente o el teléfono bloqueado, el sitio no puede seguir reportando (eso sigue fuera de alcance: nativo o Teltonika).

## 1. El problema

`driver-position-reporter` ya llama `navigator.wakeLock.request('screen')` al empezar a observar. La Screen Wake Lock API suelta el lock cuando el documento pasa a `hidden` y dispara `release` en el sentinel. El reporter se queda con ese sentinel: al volver a `visible`, `pedirWakeLock` cree que el lock sigue tomado y no lo pide de nuevo. Tampoco lo suelta al desmontar la pantalla de Conductor, así que la pantalla puede quedarse despierta fuera de esa ruta, o no volver a despertarse al regresar.

## 2. Entradas y salidas

**Sin cambio de contrato HTTP ni de schema.** Sin texto nuevo en la UI.

- `apps/web/src/services/driver-position-reporter.ts`
  - Pide el lock de pantalla al `start` si el navegador lo ofrece y el documento está visible.
  - Lo suelta en `stop` (entrega o permiso de ubicación denegado), al pasar a `hidden`, y cuando se desmonta la última pantalla de Conductor que lo retiene.
  - Si el sistema lo suelta solo (`release`), olvida el sentinel y lo vuelve a pedir al quedar `visible` mientras sigue observando y Conductor está montado.
  - Si la API no existe o `request` rechaza, el reporte GPS sigue igual y no se escribe `lastError`.
  - Un `request` que resuelve después de `stop`, de ocultar el documento o de desmontar no deja el lock tomado.
- `apps/web/src/hooks/use-driver-position-reporter.ts`: al montar retiene el lock; al desmontar lo suelta. Varias tarjetas comparten un conteo: solo la última en desmontar lo suelta. Salir de la ruta no para el watcher GPS (sigue en el módulo).

## 3. Fuera de alcance (declarado)

- GPS con la app cerrada, el teléfono bloqueado o Maps en primer plano.
- App nativa, Teltonika, deep link a Maps (eso es #701).
- Copy, permisos nuevos, cambios de API.

## 4. Criterios de salida

- [x] Con la API disponible, `start` pide `request('screen')` una vez mientras observa.
- [x] Sin API, o si `request` rechaza, `isWatching` sigue y `lastError` no cambia por el lock.
- [x] `stop` y un `PERMISSION_DENIED` llaman `release`.
- [x] Al ocultar el documento se suelta; al volver a `visible` se pide de nuevo.
- [x] Si el sentinel dispara `release` solo, el siguiente `visible` vuelve a pedirlo.
- [x] Si `stop` ocurre antes de que `request` resuelva, ese sentinel se suelta y no queda retenido.
- [x] Desmontar la última pantalla de Conductor suelta el lock y un `visibilitychange` posterior no lo repide; volver a montar, si sigue observando, sí.
- [x] Tests con mocks. Suite del reporter y del hook en verde.
