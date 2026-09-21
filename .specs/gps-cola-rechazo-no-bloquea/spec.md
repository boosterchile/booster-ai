# Cola GPS: un rechazo de precisión no atasca el drenaje

**Estado**: aceptada (pedido del PO tras validación prod Slot 3) · **Fecha**: 2026-09-21 · **Viaje**: BOO-KJHITL · **Slot**: 3 «Conductor operativo», endurecimiento del paso 3 (`.specs/conductor-gps-resiliente/`).

Enmienda el drenaje FIFO de `ColaPosiciones`: el «se detiene en el primer fallo» de aquella spec sigue valiendo para fallos **transitorios** (red, 5xx, 401/403, 429). No aplica a un punto que el API **rechaza para siempre**.

## 1. El problema (medido en producción)

Viaje BOO-KJHITL (2026-09-21), GPS del móvil sin Teltonika:

1. El browser encoló un fix grosero (aprox. lat 39.95, lng -75.30, `accuracy_m` ~4.7 millones de metros).
2. `POST /assignments/:id/driver-position` rechaza `accuracy_m` > 10000 (Zod `.max(10_000)`).
3. El drenaje es FIFO estricto y trata el 400 como «fallo de red»: reintenta la cabeza y no toca el resto.
4. La UI quedó en «Sin señal» / «pendientes de envío» aunque después había puntos buenos de Valparaíso. Al borrar a mano la cabeza inválida, dos puntos válidos salieron y la entrega cerró; al confirmar aún había ~4 pendientes.

Un solo ping basura no puede congelar la cobertura del tramo.

## 2. Entradas y salidas

**Sin cambio de contrato HTTP ni de schema.** El API sigue rechazando precisión > 10 km (no queremos persistir Filadelfia como si fuera Valparaíso). El arreglo es la cola del cliente.

- `apps/web/src/services/driver-position-queue.ts`
  - `esPuntoEnviable`: espejo del body Zod del API. `accuracy_m` ausente o nulo es válido; si viene, debe ser `0 < x ≤ 10_000`. Lat/lng en rango WGS84; `timestamp_device` parseable.
  - `encolar` no persiste un punto no enviable (el grosero no entra).
  - `drenar`: antes de POST, descarta la cabeza no enviable y sigue. Si el POST responde **400 o 422** (rechazo permanente de validación), descarta esa cabeza y sigue con las siguientes. 409 `assignment_not_active` sigue vaciando toda la cola. Red / 5xx / 401 / 403 / 429 siguen deteniendo el ciclo y reintentando la cabeza después.
- `apps/web/src/services/driver-position-reporter.ts`: si `encolar` rechaza el fix, no actualiza `ultimoEnviado` (el throttle no se ancla a basura). Un descarte no pone `lastError` «Sin señal».
- Copy de UI: no cambia. El síntoma «Sin señal» era el 400 tratado como red.

## 3. Fuera de alcance (declarado)

- Relajar el `max(10_000)` del API o aceptar el punto sin `accuracy_m`.
- Endpoint de lote, posiciones póstumas, app nativa.
- Cambiar throttle, latido, tope 3000 o el texto de la tarjeta.

## 4. Criterios de salida

- [x] Rojo exhibido: test de cola (cabeza `accuracy_m` ~4.7e6 + puntos Valparaíso; drenaje envía solo los válidos) y test de reporter (400 en la cabeza no deja `queued` ni «Sin señal» con puntos buenos detrás).
- [x] Verde: esos tests + suite `apps/web` tocada, typecheck, biome.
- [ ] En producción, un fix grosero encolado no impide que los puntos posteriores del mismo viaje lleguen al API.
