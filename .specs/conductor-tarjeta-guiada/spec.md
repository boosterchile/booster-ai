# Tarjeta del conductor guiada: una acción principal por estado, GPS automático

**Estado**: aceptada (OK del PO 2026-09-14) · **Slot**: 3 «Conductor operativo de punta a punta», paso «vista conductor» · **Pedido por**: PO tras probar BOO-BKAXIK en el iPhone («se produce una confusión para el conductor: iniciar reporte GPS ó navegar al destino ó confirmar recogida»).

## 1. El problema

La tarjeta del servicio muestra cuatro acciones a la vez y sin orden: «Iniciar
reporte GPS», «Navegar al destino», «Confirmar recogida» y «Confirmar entrega».
Tres defectos concretos:

- El bloque GPS aparece siempre. El comentario del archivo dice «si el vehículo no
  tiene Teltonika», pero `/me/assignments` no informa si lo tiene. En JLKT54 (con
  Teltonika, 917 posiciones/24 h) la huella se mide con el equipo del camión; el
  botón es ruido y el conductor cree que debe tocarlo.
- «Navegar al destino» antes de recoger: el conductor va primero al origen.
- «Confirmar entrega» como botón grande antes de la recogida invita a saltarse el
  paso, aunque la tabla de transiciones lo permita (asignado → entregado).

## 2. Entradas y salidas

**API** `GET /me/assignments`: `vehicle` gana `has_teltonika: boolean`
(`vehicles.teltonika_imei IS NOT NULL`). Campo aditivo; sin cambio para
quien no lo lee.

**Web** `apps/web/src/routes/conductor.tsx`, tarjeta del servicio:

- Fase derivada: `por_recoger` (asignado) → `en_ruta` (recogido) → `entregada`.
- `por_recoger`: acción principal «Confirmar recogida»; secundaria «Ir al origen»
  (Google Maps al origen); la sugerencia del geofence se mantiene. «Entregar sin
  haber confirmado la recogida» sigue posible, como enlace discreto (nombre
  accesible «Confirmar entrega sin haber confirmado la recogida»).
- `en_ruta`: acción principal «Confirmar entrega»; secundaria «Ir al destino».
- `entregada`: solo el mensaje de cierre.
- Posición, sin botones:
  - Vehículo con Teltonika: «Tu camión reporta la posición automáticamente»; el
    teléfono no observa la ubicación.
  - Sin Teltonika: el reporte del teléfono arranca solo al confirmar la recogida
    (iOS pide la ubicación en ese momento, no antes) y se detiene al confirmar la
    entrega. Si el permiso ya estaba concedido, arranca también antes de recoger,
    en silencio, para que el geofence del origen pueda sugerir la recogida. En
    ruta sin posición: aviso «No estamos recibiendo tu posición» + «Reintentar».
- «Actualizar» muestra «Actualizando…» y se deshabilita mientras carga.

**Docs**: la consulta de verificación del Slot 1 en `docs/frentes-vivos.md`
apuntaba a columnas que no existen en `viajes`; se reemplaza por la real sobre
`asignaciones` + `metricas_viaje`.

## 3. Fuera de alcance

- Reporte GPS que sobreviva a la pérdida de señal o a la app en segundo plano
  (paso «GPS resiliente» del Slot 3).
- Sugerencia de recogida por geofence en vehículos con Teltonika (hoy solo se
  evalúa con posiciones del teléfono).
- La pantalla de configuración: sigue consultando permisos sin pedirlos; los
  pide solo al tocar «Permitir».

## 4. Criterios de salida

- [x] Rojo exhibido: tests de la tarjeta (sin botón GPS, texto por fase, origen
      vs destino, arranque al recoger, parada al entregar, reintento en ruta,
      «Actualizando…») y test de `/me/assignments` (`has_teltonika`).
- [x] Verde: suites de `apps/web` y `apps/api`, typecheck, biome, build.
- [x] Preview a 375×812 (`/apariencia/conductor?fase=por_recoger|en_ruta&teltonika=1|0`,
      ruta pública con datos mock, nueva): una acción principal por fase.
- [ ] En producción, el PO recorre recogida → entrega en BOO-BKAXIK sin dudar
      qué tocar.

## 5. Pasada 2 (2026-09-14, misma fecha): «Ir al destino» abría un mapa vacío

Reporte del PO en BOO-BKAXIK: «abre el mapa de Google sin mostrar la ruta, inicio y
destino». Reproducido en escritorio: Google Maps responde «no puede encontrar Ruta 5
Norte km 470, La Serena». El enlace pedía direcciones bien; la dirección en texto no es
geocodificable por Maps. En la base ningún viaje (0 de 9) tiene coordenadas de destino,
y el origen geocodificado (T2/T4) solo aplica a viajes nuevos.

Lo que sí existe: la **ruta eco** de la asignación (`eco_route_polyline_encoded`,
Routes API), que resolvió ambos extremos. Para BOO-BKAXIK su último punto cae en
La Serena (-29.90626, -71.25743) y Google Maps sí lo navega («Tu ubicación a Ruta 5,
La Serena»).

- `conductor.tsx`: la tarjeta lee la ruta eco con el hook existente
  `useAssignmentEcoRoute` (ya autorizado para el conductor) y usa el primer y el
  último punto de la polyline como coordenadas de «Ir al origen» e «Ir al destino».
  Sin ruta eco, cae al texto de la dirección como antes. Se agrega
  `travelmode=driving&dir_action=navigate` para que la app de Maps arranque la
  navegación.
- Sin cambios de API ni migración. Deuda declarada: geocodificar también el destino
  al crear el viaje (columnas `destino_latitude/longitude`), que además necesitan el
  ETA y el hito «llegó» al destinatario; requiere aprobación del PO por schema.

Criterios: tests rojo→verde (destino y origen por coordenadas; sin ruta, texto +
modo auto), suite web, typecheck, biome, build.
