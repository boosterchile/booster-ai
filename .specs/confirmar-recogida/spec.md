# Confirmar recogida — cerrar el paso muerto de la máquina de estados

**Estado**: aceptada · **Fecha**: 2026-08-03 · **Pedido por**: PO
> «resolver la deuda que sigue viva definitivamente»

## 1. La deuda

La máquina de estados tiene el paso del medio **modelado y sin nadie que lo
escriba**, en las dos capas:

| Capa | Estado inicial | Paso muerto | Terminal |
|---|---|---|---|
| `viajes.estado` | `asignado` | **`en_proceso`** | `entregado` |
| `asignaciones.estado` | `asignado` | **`recogido`** | `entregado` |

No es un descuido reciente: el propio `packages/trip-state-machine` lo documenta
desde 2026-06-11.

> `pickup (PoD-geofence, MODELADO pero aún sin flujo que lo dispare): asignado → en_proceso.`

## 2. Por qué se implementa y no se elimina

Consideré las dos salidas. Eliminar el estado exigiría tocar el schema y romper
consumidores reales. Está modelado de punta a punta:

- **Columnas que existen y nadie llena**: `asignaciones.recogido_en` y
  `asignaciones.evidencia_recogida_url`.
- **El tipo de evento ya existe**: `'recogida_confirmada'` en
  `tipo_evento_viaje` (schema.ts:307) y en `packages/shared-schemas`, con el
  comentario «transportista reportó recogida».
- **Ocho sitios lo LEEN hoy** como estado activo válido: `route-safety-recipients`,
  `/me/assignments`, `GET /assignments`, `asignar-conductor`, documentos de
  transporte, `DriverAssignmentCard`, el enum de dominio, y la pantalla de
  Servicios que muestra «En ruta» vs «Por recoger».
- **La superficie pública lo usa**: `get-public-tracking.ts` solo muestra la
  posición del vehículo cuando el viaje está en `asignado|en_proceso`.

O sea: media plataforma ya sabe leer el estado. Lo único que falta es quién lo
escribe. Eliminarlo sería tirar trabajo hecho para tapar un hueco de una línea.

**Hoy el costo es concreto**: la pantalla de Servicios muestra «Por recoger»
para todo, siempre — incluso para un camión que va por la Ruta 5 con la carga
arriba. Y el consignatario que abre su link de tracking ve un viaje que nunca
arranca.

## 3. Decisiones

### 3.1 Quién confirma

**El conductor asignado, o un miembro del transportista con rol de escritura**
(`dueno|admin|despachador`).

El conductor es quien está físicamente en el punto de recogida — es el actor
natural y ya tiene la pantalla. El transportista entra como respaldo: un
conductor sin smartphone, o sin señal en un patio, no puede dejar la operación
congelada.

Esto imita la autorización de `POST /:id/driver-position` (que autoriza por
`driverUserId`, no por rol) unida a la de `PATCH /:id/confirmar-entrega`.

### 3.2 NO se exige recogida antes de entrega

`asignado → entregado` **sigue siendo legal**. La tabla de transiciones ya lo
permite y no se toca.

Forzar la secuencia sería castigar al conductor que olvidó apretar un botón:
llegaría a destino con la carga entregada y la app le diría que no puede
cerrar. En terreno, un dato faltante es mejor que una operación bloqueada.

### 3.3 La evidencia de recogida es opcional

`evidencia_recogida_url` queda nullable y no gatea nada. Exigir una foto para
confirmar recogida bloquearía a quien tiene mala señal — el mismo error que
`documento_requerido` ya nos mostró en el cierre de entrega.

### 3.4 Idempotente

Confirmar dos veces devuelve 200 con `already_picked_up: true`. Un conductor con
señal intermitente va a tocar el botón dos veces; eso no puede ser un error.

## 4. Salidas

### API — `PATCH /assignments/:id/confirmar-recogida` (nuevo)

En **una transacción**:

1. `asignaciones.estado = 'recogido'`, `recogido_en = now()`
2. `viajes.estado = 'en_proceso'` — validado con `assertTransicion` del
   `trip-state-machine`, que es la fuente de verdad de la legalidad (ADR-061).
   El service orquesta; la tabla decide.
3. Evento `recogida_confirmada` en `eventos_viaje`, con quién y desde dónde.

Respuestas: `200 { ok, already_picked_up, picked_up_at }` · `403` si el actor no
es ni el conductor asignado ni un rol de escritura del transportista · `404` si
no existe · `409 invalid_status` si ya está entregado o cancelado.

### Web — botón en la pantalla del conductor

`/app/conductor` muestra **«Confirmar recogida»** mientras el servicio está en
`asignado`, y pasa a mostrar la recogida como hecha cuando está en `recogido`.
Mismo patrón de confirmación previa que la entrega: es una acción operacional
irreversible y el teléfono va en el bolsillo.

## 5. Criterios de éxito

1. Confirmar recogida deja `asignaciones.estado='recogido'`, `recogido_en`
   escrito, y `viajes.estado='en_proceso'` — verificado **en la base**, no por
   el 200.
2. Queda el evento `recogida_confirmada` con el actor.
3. Confirmar dos veces no rompe ni duplica el evento.
4. Un conductor ajeno al servicio recibe 403.
5. La entrega **sigue funcionando sin recogida previa**.
6. Tras la recogida, Servicios muestra «En ruta» y el tracking público muestra
   la posición.
7. Evidencia fresca: rojo exhibido, tests, typecheck, lint, e2e real.

## 6. Fuera de alcance

- **Geofence automático** (el «PoD-geofence» del comentario original). Requiere
  confiabilidad de GPS que hoy no tenemos medida. La confirmación manual es el
  piso; el geofence, si se hace, se apoya sobre esto.
- **Métricas estimadas al pickup.** El comentario de `metricas_viaje` dice
  «Estimadas: al confirmar pickup», pero `calcularMetricasEstimadas` ya corre en
  `offer-actions` al aceptar la oferta. El comentario está desactualizado; no se
  mueve el cálculo, solo se deja anotado.
- **Evidencia fotográfica de recogida.** La columna queda; el flujo de subida es
  otro frente.
