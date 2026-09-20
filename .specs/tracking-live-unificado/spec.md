# Tracking en vivo unificado (Teltonika o móvil del conductor) + ETA al generador

**Estado**: aceptada (brief del PO, 2026-09-20) · **Rama**: `feat/tracking-live-unificado` · **Base**: `origin/main` @ `71e1d7f`

**Slot**: ninguno de los tres de `docs/frentes-vivos.md`. **Excepción explícita del PO** (2026-09-20),
acotada y ligada al Slot 3 «Conductor operativo»: consume el GPS del móvil que ese slot dejó
reportando (#686). No abre serie ni frente nuevo; la enmienda de `frentes-vivos.md`, si el PO la
quiere, es suya.

## 1. El problema

El conductor escribe su GPS en `posiciones_movil_conductor` (`POST /assignments/:id/driver-position`,
con `asignacion_id` y `vehiculo_id`), pero las dos lecturas de tracking en vivo miran **solo**
`telemetria_puntos` (Teltonika):

- público: `getPublicTracking` (`GET /public/tracking/:token`);
- generador: `GET /trip-requests-v2/:id` → `assignment.ubicacion_actual`, que alimenta
  `/app/cargas/$id/track`.

Sin FMC150 → `position: null` aunque la PWA reporte, y sin posición no hay ETA. Además el detalle
del generador no tiene ventana de frescura ni corte por estado: sigue mostrando el camión después
de `entregado` (misma fuga que `.specs/tracking-privacy-position-ttl/` cerró en el público), y no
trae ETA.

**Live ≠ certificación.** ADR-077 y `posicion-segmento.ts` enrutan la fuente para la **huella**
post-entrega (una sola fuente por vehículo, decidida por su dispositivo). Esto es otra lectura: la
**última posición viva**, decidida por **frescura**. No toca `fuente_dato_ruta`, cobertura ni
certificado.

## 2. Regla de fuente (una sola, para ambas lecturas)

Servicio `resolverPosicionEnVivo` (`apps/api/src/services/posicion-en-vivo.ts`):

1. Estado del viaje fuera de `asignado | en_proceso` → sin posición, **sin consultar la BD**
   (allowlist fail-closed, igual que el público hoy).
2. Hay ping Teltonika del vehículo en los últimos **30 min** (misma ventana de hoy) → Teltonika;
   `position_source = "teltonika"`.
3. Si no: pings del móvil en los últimos 30 min **de esta asignación** (`asignacion_id` +
   `vehiculo_id`) → `position_source = "mobile"`. Acotar por asignación impide exponer posiciones
   que el mismo vehículo/conductor reportó para otro viaje.
4. Ninguno → `position = null`, `position_source = null`, ETA según contrato actual (`null`).

Sin merge de streams: posición, `progress` (velocidad promedio 15 min) y ETA salen de **la fuente
elegida**. No se inventan puntos ni se derivan velocidades: si el móvil no reporta
`coords.speed`, `avg_speed` es `null` y `eta_minutes` es `null` (degradación explícita del contrato
vigente). Ambas fuentes descartan null y «null island» (0,0).

## 3. Entradas y salidas

**API (cambios aditivos autorizados por el brief):**

- `GET /public/tracking/:token`: nuevo campo `position_source: "teltonika" | "mobile" | null`.
  `position`, `progress` y `eta_minutes` no cambian de forma.
- `GET /trip-requests-v2/:id`: `assignment.position_source` y `assignment.eta_minutes` (nuevos).
  `assignment.ubicacion_actual` conserva su forma (`timestamp_device`, `latitude`, `longitude`,
  `speed_kmh`, `angle_deg`), pero **cambia de regla** (decisión del PO, 2026-09-20: «unificar
  también la regla de privacidad»): solo en `asignado | en_proceso` y con ping < 30 min, para
  ambas fuentes. Fuera de eso, `null`.

**Web (texto mínimo, sin rediseño):**

- `/tracking/$token`: en la tarjeta de progreso, «Llegada estimada: en X» cuando hay
  `eta_minutes`, y la fuente («Posición reportada por el GPS del vehículo» / «…por el teléfono
  del conductor»).
- `/app/cargas/$id/track`: en la tarjeta inferior, la misma ETA y la misma línea de fuente; con
  posición y sin ETA, «Llegada estimada: no disponible aún».

**No se toca**: la PWA del conductor (ya escribe `vehiculo_id` y `asignacion_id`), ADR-077,
`posicion-segmento.ts`, `compute-route-eta.ts` (contrato `eta_minutes` intacto), trails
históricos, esquema de BD.

## 4. Criterios de salida

- [x] Rojo exhibido (servicio + público + detalle del generador + web), luego verde:
  - solo móvil fresco en `en_proceso` → `position` no null, `position_source = "mobile"`;
  - Teltonika fresco + móvil fresco → gana Teltonika, el móvil ni se consulta;
  - ninguno → `position = null`, `position_source = null`, `eta_minutes = null`;
  - móvil con velocidades → `eta_minutes` numérico; móvil sin velocidad → `eta_minutes = null`;
  - estado no activo → sin consultas de posición, todo `null` (público y generador);
  - la consulta móvil filtra por `asignacion_id`.
- [x] Integración contra Postgres real (PG17 efímero): 4/4 — ventana, asignación y null island en
      SQL. La suite completa: 22 archivos verdes; los 4 rojos son testcontainers sin Docker local
      (corren en CI).
- [x] Web: ETA y fuente visibles en ambas pantallas; tipos espejados (25 tests).
- [x] Suites `apps/api` (171/2094) y `apps/web` (137/1373), typecheck, biome, `lint:rls`, build.
- [x] Evidencia local: `curl` a `/public/tracking/:token` (ruta real sobre PG efímero) con solo GPS
      móvil → `position` + `position_source: "mobile"` + `eta_minutes`; con ping Teltonika fresco →
      `"teltonika"`; en `entregado` → todo `null`. Captura 375×812 de `/tracking/$token`.
- [ ] En producción (tras deploy manual del PO): viaje T2 sin Teltonika, el generador ve posición y
      ETA en `/app/cargas/$id/track` sin SQL. La pantalla autenticada no se verificó en navegador
      local (exige Auth Emulator + API completo); la cubren los tests de componente.

## 5. Deudas conscientes (no se resuelven acá)

- Con Teltonika silencioso hace < 30 min y móvil reportando, gana Teltonika hasta que vence la
  ventana (regla del brief). Una regla «gana el más reciente» es cambio de producto.
- ETA con fuente móvil depende de `coords.speed` del navegador; sin ella no hay ETA (no se deriva
  velocidad por desplazamiento).
- Vehículos con `teltonika_imei_espejo` siguen sin posición Teltonika en vivo (el público ya leía
  solo por `vehiculo_id`); caen al móvil si el conductor reporta.
- `GET /assignments/:id` (vista del transportista) conserva su `ubicacion_actual` solo-Teltonika.
- Tras `entregado`, la tarjeta «Ubicación del vehículo» de `/app/cargas/$id` dice «sin posición
  todavía» (consecuencia del corte por estado). Ocultarla o cambiar el texto es decisión de UI.
- El detalle del generador ahora calcula ETA (Routes API con la caché de 5 min por viaje que ya
  comparte con el público); `/track` consulta cada 15 s.
