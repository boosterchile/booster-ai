# Plan — Historial de trayectos Teltonika

## Enfoque

Función pura en `apps/api/src/domain/segmentar-trayectos-teltonika.ts` (mismo patrón que `calcularCoberturaPura`: sin I/O). El servicio solo lee vehículos con IMEI propio y puntos de la ventana, parsea `io_data` con Zod y pagina. La ruta enforza rol y empresa. La UI es una tabla en `/app/trayectos`.

No hay migración: no existe capacidad de estanque y el brief no pide persistir trayectos. El cálculo es on-read.

AC 3 (texto cerrado, 2026-09-21): puntos ordenados por timestamp de dispositivo; ΔL ≤ −U en 5 min con v ≤ 5 km/h; ignición on u off; badge en el historial. U = max(15 L, 3 % del estanque) si hay capacidad, si no 15 L. El buffer sin celular se evalúa al estar ingerido, con la hora del dispositivo. Sin push. No se marca consumo en marcha.

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
