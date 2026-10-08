# Spec — Eco-routing en tiempo real (T10-23, ADR-012 Capa 1)

**Estado**: Aceptada por el PO el 2026-10-08. Las decisiones vinieron por chat:
- **Diseño**: ADR-012 con respuesta explícita del conductor.
- **Orquestación**: dentro de `apps/api`.

Esta spec supersede la de la rama `feat/eco-routing-realtime-spec`, que nunca se mergeó y quedó en estado Draft (2026-06). Esa spec avisaba solo por voz y no registraba la respuesta del conductor; T10-23 exige registrarla.

## Criterio de término (de `.specs/trl10/spec.md`)

> Durante un viaje activo se detecta congestión en < 60 s, la sugerencia llega al conductor en < 5 s, su respuesta queda registrada y hay una métrica de adopción. Evidencia: test de integración y un viaje real con al menos una sugerencia.

**Cómo se mide cada número.** La condición de congestión de ADR-012 es "< 10 km/h sostenido > 60 s":

- **"Detecta en < 60 s"**: desde que esa condición se cumple hasta que la congestión queda registrada en `sugerencias_ruta`, pasan menos de 60 s. Lo acota el intervalo de reporte de posición (Teltonika o PWA, ≤ 20 s) más una evaluación.
- **"Llega en < 5 s"**: desde la decisión de sugerir (fila persistida) hasta el envío del Web Push. Se mide con el histograma `eco_routing_entrega_ms`.

## Entradas

- Posiciones del viaje activo (`asignaciones.estado ∈ {recogido}` o equivalente en curso), de dos fuentes:
  - `posiciones_movil_conductor`, que la PWA reporta por `POST /assignments/:id/driver-position`;
  - `telemetria_puntos` (Teltonika), por `vehiculo_id`.

  `posicion-en-vivo.ts` ya combina ambas.
- Origen y destino del viaje, para excluir las detenciones de carga y descarga.
- Routes API (`computeRoutes` con `TRAFFIC_AWARE_OPTIMAL` + `computeAlternativeRoutes` + `FUEL_CONSUMPTION`), desde la posición actual hasta el destino.
- Perfil del vehículo: combustible y consumo base.

## Salidas

1. **`packages/eco-routing`** (PR A, este), con lógica pura:
   - `detectarCongestion(muestras, {ahoraMs, zonasExcluidas, config})`: detecta < 10 km/h sostenido ≥ 60 s en la racha más reciente.
     - Corta la racha si hay un hueco > 20 s entre muestras.
     - Si la última muestra tiene más de 20 s, devuelve `datos_obsoletos`.
     - Si falta la velocidad, la deriva del desplazamiento.
     - Excluye un radio de 300 m alrededor del origen y del destino.
   - `evaluarAlternativas({actual, alternativas, combustible, consumoBaseLPor100km})` recomienda **por emisiones primero, con guardrail de ETA**:
     - Elige la alternativa de mínimo kgCO2e WTW (`factorWtw` de carbon-calculator) cuya duración no supere la actual en más de 10 %.
     - Exige que la mejora sea material: más de 10 % en CO2e o en tiempo (ADR-012).
     - Nunca recomienda una ruta que emita más que la actual.
     - Si no hay forma de estimar el combustible (eléctrico, o sin datos de Routes API ni consumo base), evalúa solo por tiempo y no informa CO2e.
2. **`apps/api`** (PR B):
   - Tabla `sugerencias_ruta` (migración 0059, expand-only, con `.down.sql`). Lleva `estado` = `sugerida` | `congestion_sin_alternativa` para registrar también las detecciones sin alternativa. Columnas:
     - `id`, `asignacion_id`, `viaje_id`, `detectada_en`, `posicion_lat`, `posicion_lng`;
     - `velocidad_media_kmh`, `motivo`;
     - `polyline_alternativa`, `ahorro_segundos`, `ahorro_kgco2e`, `kgco2e_actual`;
     - `enviada_en`, `respuesta` (`aceptada` | `rechazada` | `sin_respuesta`), `respondida_en`.
   - Evaluación disparada al recibir cada posición del viaje activo (PWA) y, para viajes con Teltonika (donde la PWA no reporta), por un barrido por minuto de Cloud Scheduler a `POST /admin/jobs/eco-routing-barrido` (mismo SA invocador OIDC, sin IAM nuevo; pausado con el flag OFF). Lleva *cooldown* por asignación (una sugerencia cada 15 min) y *throttle* de Routes API (una evaluación por minuto como máximo).
   - Web Push al conductor (`sendPushToUser`) con payload de sugerencia y acciones `aceptar` / `seguir`.
   - `POST /assignments/:id/sugerencias-ruta/:sid/respuesta`, validado con Zod: solo el conductor asignado, una sola vez.
   - Métricas de negocio:
     - `eco_routing_sugerencias_total{resultado}`
     - `eco_routing_respuestas_total{respuesta}` (de aquí sale la adopción: aceptadas / enviadas)
     - histograma `eco_routing_entrega_ms`
   - Span OTel por evaluación.
   - Flag `ECO_ROUTING_REALTIME_ACTIVATED` (`booleanFlag(false)`).
3. **`apps/web`** (PR C):
   - Card de sugerencia en `conductor.tsx`, con la alternativa en el mapa y botones Aceptar / Seguir.
   - Acciones de notificación en `sw.ts`: el service worker no tiene sesión, así que la acción abre `/app/conductor?sugerencia=<id>&respuesta=<aceptada|rechazada>` y la PWA registra la respuesta al montar. La card además sondea `GET .../sugerencias-ruta/activa` cada 20 s como respaldo del push.
   - Si acepta, abre la navegación con la polilínea alternativa.

## Criterios de éxito

- [x] PR A: tests del detector (12) y del evaluador (9) con **rojo exhibido** antes de implementar. Coverage del package ≥ 80 %.
- [x] PR B: test de integración (`test/integration/eco-routing-tiempo-real.integration.test.ts`, 9 casos contra Postgres real): posición lenta del viaje recogido → fila `sugerencias_ruta` (detección < 60 s desde la condición) → push con acciones y `enviada_en` → respuesta registrada una sola vez por el conductor; cooldown, throttle, sin alternativa, sin congestión, viaje no activo, error de Routes API.
- [x] PR C: tests de la card (`SugerenciaRutaCard`), del hook, de los helpers de navegación y del clic de notificación (`urlClickNotificacion`, que usa el service worker), y del montaje en `conductor` (en ruta sí, antes de recoger no).
- [ ] Viaje real en prod con al menos una sugerencia y su respuesta (evidencia del PO tras activar el flag).

## Fuera de alcance

- Sugerencia de "parada temporal" y coaching de eco-driving por CAN (variantes de ADR-012).
- Aceptar por voz (depende del wake-word, T10-22).
- Servicio Cloud Run propio: la orquestación queda en el api por decisión del PO. Extraerla es materia de T10-21.
