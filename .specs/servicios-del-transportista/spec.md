# Servicios del transportista — cerrar el hueco entre aceptar y despachar

**Estado**: aceptada · **Fecha**: 2026-08-03 · **Decidido por**: PO (Felipe Vicencio)

## 1. El problema, medido

Consulta a la base de producción, 2026-08-03:

```
conductores | activados | con_email_real | asig_con_conductor | asig_activas
     6      |     0     |       1        |         0          |      1
```

**Ninguna asignación en producción tiene conductor.** Hay una activa, sin
conductor, y no es descuido de nadie: **no existe un camino para llegar a
asignarlo.**

La pantalla que asigna conductor (`/app/asignaciones/:id`, con el
`DriverAssignmentCard` que ya llama a `POST /assignments/:id/asignar-conductor`)
**no está en el menú**. Los únicos dos enlaces a esa ruta en toda la app salen
de `/app/cobra-hoy/historial` y `/app/liquidaciones` — dos pantallas de plata.
Y al aceptar una oferta, `/app/ofertas` descarta el `assignment.id` que el API
ya le devuelve, y se queda en la lista.

Consecuencia en cadena: sin `conductor_id`, `POST /assignments/:id/driver-position`
rechaza el reporte de GPS, y el dashboard del conductor —recién arreglado en
[#642](../ui-conductor-operativa/spec.md)— muestra vacío aunque el conductor
active su cuenta correctamente. El eslabón roto no está en la UI del conductor:
está aguas arriba.

## 2. Entradas

- `POST /offers/:id/accept` ya devuelve `assignment.id` (`AcceptResponse` en
  `apps/web/src/hooks/use-offers.ts:42`). Hoy se descarta.
- `GET /me/assignments` (`apps/api/src/routes/me.ts:295`) hace exactamente el
  join que necesitamos (assignment + trip + vehículo + empresa), solo que
  scopeado por `driverUserId`. Es el patrón a espejar.
- `assignmentsRouter` ya está clasificado `ENFORCED` en el harness ADR-057
  (`check-route-default-deny.ts:99`). La clasificación es **por mount**, así
  que un método nuevo en ese router no toca la tabla — verificado, no supuesto.

## 3. Salidas

### 3.1 API — `GET /assignments` (nuevo)

Lista las asignaciones de la **empresa activa** del usuario. Espejo de
`GET /me/assignments`, pero scopeado por `assignments.empresa_id` en vez de
`driver_user_id`.

- **Auth**: `requireCarrierAuth` — el mismo guard que el resto del router.
  Exige `activeMembership` + empresa transportista + activa. Sin rol-gate: un
  conductor con membresía en la empresa puede *ver* la lista (igual que ya
  puede ver `GET /assignments/:id`); **escribir** el conductor sigue exigiendo
  `dueno|admin|despachador`, que es donde vive el rol-gate hoy.
- **Filtro**: `estado IN ('asignado','recogido')` — los operacionales. Los
  terminales (`entregado`, `cancelado`) quedan fuera; el histórico es otra
  superficie.
- **Orden**: `aceptado_en DESC`.
- **Sin paginación**: un transportista chico corre unidades, no miles. Si
  crece, se agrega con un `limit` explícito, no con scroll infinito silencioso.
- **Forma de respuesta**: idéntica a `GET /me/assignments` más
  `driver: { user_id, full_name } | null` — que es justamente el dato que la
  pantalla necesita para marcar "sin conductor".

```jsonc
{ "assignments": [ {
    "id": "...", "status": "asignado",
    "accepted_at": "...", "picked_up_at": null, "agreed_price_clp": 850000,
    "driver": null,                          // ← el campo que motiva todo esto
    "vehicle": { "id": "...", "plate": "UICO01" },
    "trip": { "id": "...", "tracking_code": "BOO-4F2A", "status": "asignado",
              "origin": { "address_raw": "...", "region_code": "13" },
              "destination": { "address_raw": "...", "region_code": "10" },
              "cargo_type": "carga_seca", "cargo_weight_kg": 12000,
              "pickup_window_start": null, "pickup_window_end": null }
} ] }
```

### 3.2 Web — `/app/servicios` (nueva ruta) + ítem en el menú

- Ítem **«Servicios»** en la sección Transporte del sidebar, entre «Ofertas» y
  «Vehículos» — el orden sigue el flujo real: llega la oferta, se acepta, se
  despacha.
- Cada tarjeta: código de seguimiento, origen → destino, patente, precio, y el
  **estado del conductor**. Sin conductor ⇒ aviso visible + acción directa.
- Vacío ⇒ `EmptyState` que explica que los servicios aparecen al aceptar una
  oferta, con enlace a `/app/ofertas`.

### 3.3 Web — salto al aceptar una oferta

Al aceptar, `OfferCard` navega a `/app/asignaciones/:id` usando el
`assignment.id` que la respuesta ya trae. Atrapa el caso en el momento exacto
en que el despachador tiene la carga en la cabeza.

## 4. Criterios de éxito

1. Un despachador que acepta una oferta **termina en la pantalla donde asigna
   conductor**, sin saber ninguna URL.
2. Un despachador que cerró la pestaña **puede volver** desde el menú.
3. Un servicio sin conductor **se ve como problema** en el listado, no como una
   fila más.
4. La lista **solo muestra lo de su empresa**: un transportista no ve servicios
   de otro (verificado con dos empresas, no solo con una).
5. Un rol sin permiso de escritura ve la lista pero **no puede asignar**.
6. Evidencia fresca: rojo exhibido, tests, typecheck, lint, y e2e contra el API
   real que termine con `conductor_id` escrito.

## 5. Lo que NO entra

- **Histórico de servicios entregados.** Otra superficie, otro frente.
- **Paginación.** Declarada como deuda consciente: hoy no hay volumen que la
  justifique y un `limit` implícito sería peor que ninguno.
- **Cambiar `/app/asignaciones/:id`.** La pantalla y su `DriverAssignmentCard`
  ya funcionan; lo que falta es cómo llegar. No se toca.
- **El estado `recogido` sigue muerto** — ningún endpoint lo escribe, en todo
  el repo. Se arrastra desde #642 y se reporta de nuevo acá; no se resuelve en
  este frente.
