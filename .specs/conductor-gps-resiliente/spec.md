# GPS del móvil resiliente (Slot 3, paso 3)

**Estado**: aceptada (PO: «arranca el GPS resiliente», 2026-09-14) · **Slot**: 3 «Conductor operativo de punta a punta», paso 3 de `docs/frentes-vivos.md`: «un solo watcher por sesión, throttle por tiempo y distancia, cola offline con reintento, arranque al confirmar recogida y parada al entregar». Arranque y parada ya están en #682.

## 1. El problema

Hoy `useDriverPositionReporter` abre un `watchPosition` por tarjeta, hace un `POST` por cada
callback (puede ser cada segundo) y **pierde** toda posición cuyo `POST` falla: sin señal, el
tramo desaparece. Además `watchPosition` solo dispara cuando la posición cambia: con el
camión detenido no hay pings y el tramo queda «sin cobertura». El cálculo de cobertura
(`calcular-cobertura-telemetria.ts`, `CONTINUITY_GAP_S = 60`) exige menos de 60 s entre
pings consecutivos para contar un tramo como cubierto. Resultado: con `movil_gps` la huella
queda casi siempre `degradada_cobertura`.

## 2. Entradas y salidas

**Sin cambios de API ni de schema.** `POST /assignments/:id/driver-position` sigue igual
(un punto por request, `timestamp_device` del dispositivo).

**Web, módulos nuevos (puros, testeables):**

- `services/driver-position-queue.ts`
  - `decidirReporte(prev, next, opts)`: se envía si no hay anterior, si pasaron
    ≥ `minIntervalMs` (10 s) **y** se movió ≥ `minDistanceM` (10 m), o si pasaron
    ≥ `heartbeatMs` (25 s) sin enviar. Decide con `timestamp_device`, no con reloj de pared.
  - `ColaPosiciones`: cola FIFO persistida en `localStorage` por asignación
    (`booster.posiciones.<assignmentId>`), tope 3000 puntos (se descarta el más viejo).
    `drenar(enviar)` manda en orden, se detiene en el primer **fallo transitorio**
    (red / 5xx / 401 / 403 / 429) y conserva el resto; ante `409 assignment_not_active`
    vacía la cola (la asignación ya cerró). Enmienda 2026-09-21 (BOO-KJHITL): un 400/422
    de validación o un punto no enviable (`accuracy_m` > 10 km) se descarta y el drenaje
    sigue — ver `.specs/gps-cola-rechazo-no-bloquea/`.
- `services/driver-position-reporter.ts`: **un solo reporter por sesión** (store de módulo,
  `useSyncExternalStore`). `start(assignmentId)` es idempotente; con otra asignación cierra el
  watcher anterior. Cada fix pasa por `decidirReporte`; lo que se envía va primero a la cola y
  se drena en el momento; si falla, queda persistido. Se drena también al volver `online`, al
  volver la pestaña a `visible`, cada 20 s mientras observa, y en `flush()`.
  Latido: si en 25 s no hubo fix, pide `getCurrentPosition` (maximumAge 20 s) y lo trata como
  latido (salta la regla de distancia). Wake lock de pantalla (`navigator.wakeLock`) mientras
  observa, si el navegador lo ofrece; se re-pide al volver a `visible`.
- `hooks/use-driver-position-reporter.ts`: misma forma de resultado que hoy
  (`isWatching`, `lastPosition`, `lastError`, `pointsSent`, `lastGeofence`, `start`, `stop`)
  más `queued` (pendientes en cola) y `flush()`.
- Tarjeta (`conductor.tsx`): «Confirmar entrega» drena la cola **antes** del `PATCH`
  (acotado a 8 s; si no alcanza, confirma igual: un dato faltante es mejor que una operación
  congelada). Mientras reporta muestra «N pendientes de envío» cuando hay cola.

## 3. Fuera de alcance (declarado)

- Reportar con la app cerrada o el teléfono bloqueado: un sitio web no puede. El wake lock
  mitiga (pantalla encendida mientras la app está abierta); la solución completa es app
  nativa o Teltonika.
- Endpoint de lote (`POST …/driver-positions`) y aceptar posiciones dentro de la ventana
  para asignaciones ya entregadas: cambios de contrato, quedan como deuda con OK del PO.

## 4. Criterios de salida

- [x] Rojo exhibido: módulos inexistentes (`Failed to resolve import`), 9 tests del
      reporter/hook en rojo por concurrencia del drenaje (corregida), permiso denegado
      (`expected true to be false`) y los 2 de la tarjeta.
- [x] Verde: suite `apps/web`, typecheck, biome, build.
- [x] Preview `/apariencia/conductor?fase=en_ruta&teltonika=0` (375×812, permiso negado por el
      navegador): aviso «No estamos recibiendo tu posición», «Reintentar ubicación» y el motivo.
      Hallazgo del preview: con `PERMISSION_DENIED` el reporter ahora deja de observar y lo
      explica, en vez de mostrar «Reportando» con 0 puntos.
- [ ] En producción, viaje sin Teltonika: cobertura ≥ 80 % con `movil_gps` en un trayecto
      con pérdida de señal.
