# Plan — Historial de trayectos Teltonika

## Enfoque

Función pura en `apps/api/src/domain/segmentar-trayectos-teltonika.ts` (mismo patrón que `calcularCoberturaPura`: sin I/O). El servicio solo lee vehículos con IMEI propio y puntos de la ventana, parsea `io_data` con Zod y pagina. La ruta enforza rol y empresa. La UI es una tabla en `/app/trayectos`.

No hay migración: no existe capacidad de estanque y el brief no pide persistir trayectos. El cálculo es on-read.

AC 3 (texto cerrado, 2026-09-21, umbral actualizado en el slice 2): puntos ordenados por timestamp de dispositivo; ΔL ≤ −U en 5 min con v ≤ 5 km/h; ignición on u off; badge en el historial. U = max(U_empresa, 2 % del estanque) si hay capacidad, si no U_empresa. Default 8 L. Config empresa 5–20 L. El buffer sin celular se evalúa al estar ingerido, con la hora del dispositivo. Sin push. No se marca consumo en marcha.

## Slice 2 — golpe configurable + hormiga

La función pura recibe `ConfigRoboCombustible` (`uGolpeL`, `uHormigaL`; null = default). El servicio la lee de `empresas` (migración 0056, columnas nullable). El PATCH vive en `/me/empresa/umbrales-combustible` con el mismo gate dueño|admin que el opt-in de huella. La hormiga no cruza trayectos: cada episodio se cuelga del trayecto con el mismo criterio que el golpe, y dentro de ese trayecto una ventana de 6 h evita sumar un día entero. El pin del golpe no se pisa si también hay hormiga.

Fuera de este slice: alertas in-app y score de confianza.

## Orden TDD

1. Tests de la función pura (segmentación, km/L, umbral U, badge, sensor ausente/degradado, DIN1 vs 239, 250 de apoyo).
2. Implementación pura hasta verde.
3. Servicio + ruta (403, vacío con CTA, lista paginada, scope de empresa) con DB stub.
4. Nav + página, tests de UI.

## Archivos

- `.specs/historial-trayectos-teltonika/{spec,plan}.md`
- `apps/api/src/domain/segmentar-trayectos-teltonika.ts` + test
- `apps/api/src/services/listar-trayectos-teltonika.ts` + test
- `apps/api/src/routes/trayectos-teltonika.ts` + test
- `apps/api/src/server.ts` (mount + auth, igual que `/vehiculos`)
- `apps/api/scripts/check-route-default-deny.ts` (clasificar el factory como ENFORCED)
- `apps/web/src/routes/trayectos-teltonika.tsx` + test
- `apps/web/src/router.tsx`
- `apps/web/src/components/nav-items.ts` + test

## Slice — pin del aviso

Sin migración y sin endpoint nuevo. `segmentar-trayectos-teltonika` adjunta `eventLat`/`eventLon` al marcar el badge: primer fix válido (`esCoordenadaGpsValida`) dentro de la ventana de ΔL, ordenado por `tMs`, prefiriendo el inicio. Si la primera ventana no tiene fix, se usa la siguiente caída del mismo trayecto que sí lo tenga. Si ninguna lo tiene, null.

La ruta serializa `event_lat`/`event_lon`. La página `/app/trayectos` acepta `?detalle=<id>` (y `page` si no es la primera). Con geo, el detalle monta `EventoCombustibleMap` centrado en ese punto. Sin geo, badge + «sin ubicación», sin mapa. El listado usa «Ver en el mapa» o «Ver detalle» según haya fix.

## Observabilidad

Span `trayectos_teltonika.listar` y contador `trayectos_teltonika_consultas_total`. Log estructurado con `empresa_id`, totales y `truncado`. Sin `console.*`. Sin PII en atributos del span.

## Slice — fuentes CAN y vista limpia (2026-09-22)

Sin migración. Criterios 10–13 de la spec.

- Dominio (`segmentar-trayectos-teltonika.ts`): `combustibleDelTrayecto` elige la fuente (84 > Δ83 > 89), aplica cobertura ≥ 90 % y mínimo 5 L / 10 km sobre el tramo leído. `leerIgnicion` acepta RPM 85 > 0. `resumirCombustibleVehiculos` da la mejor fuente por vehículo. Todo IO CAN pasa por `interpretCanLvcan` (rango del catálogo).
- Servicio: `combustible` = `con_dato` | `sin_dato`, pagina solo ese filtro y devuelve los dos totales y el resumen por vehículo.
- Ruta: query `combustible` validado con Zod; serializa los campos nuevos. Span con `booster.trayectos.con_combustible` / `sin_combustible`.
- Web: pestañas «Con combustible» / «Sin dato de combustible», columnas Nivel ini/fin (L o %), Litros y Consumo. Un mensaje por causa (leyenda por fuente, sin sensor, sin lectura, tramo corto). Sin pestañas si la API no trae los totales (canary con API vieja).
- TDD: rojo exhibido en dominio, servicio, ruta y web antes de implementar. Validación extra: la función corrida sobre la semana real de Van Oosterwyk (export read-only a scratchpad, no versionado).

## Slice — filtro de credibilidad del aviso (2026-09-22)

Sin migración y sin strings de UI. Criterio 14 de la spec.

`detectarRobos` y `detectarEpisodiosHormiga` descartan la caída si el nivel al inicio no es creíble (14 % de la capacidad, o AVL 89 < 14 si no hay capacidad, o 28 L si no hay ninguno de los dos). Al atribuir el aviso, un trayecto de menos de 1 km tampoco emite badge ni pin. U y U_hormiga quedan como en #707.
