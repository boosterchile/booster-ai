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
   - Tabla `sugerencias_ruta` (expand-only, con `.down.sql`). Columnas:
     - `id`, `asignacion_id`, `viaje_id`, `detectada_en`, `posicion_lat`, `posicion_lng`;
     - `velocidad_media_kmh`, `motivo`;
     - `polyline_alternativa`, `ahorro_segundos`, `ahorro_kgco2e`, `kgco2e_actual`;
     - `enviada_en`, `respuesta` (`aceptada` | `rechazada` | `sin_respuesta`), `respondida_en`.
   - Evaluación disparada al recibir cada posición del viaje activo. Lleva *cooldown* por asignación (una sugerencia cada 15 min) y *throttle* de Routes API (una evaluación por minuto como máximo).
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
   - Acciones de notificación en `sw.ts` que llaman al endpoint de respuesta.
   - Si acepta, abre la navegación con la polilínea alternativa.

## Criterios de éxito

- [x] PR A: tests del detector (12) y del evaluador (9) con **rojo exhibido** antes de implementar. Coverage del package ≥ 80 %.
- [ ] PR B: test de integración (`test/integration/`): posición lenta del viaje activo → fila `sugerencias_ruta` → push enviado → `POST` de respuesta registrada → métrica.
- [ ] PR C: test de componente de la card y de las acciones del service worker.
- [ ] Viaje real en prod con al menos una sugerencia y su respuesta (evidencia del PO tras activar el flag).

## Fuera de alcance

- Sugerencia de "parada temporal" y coaching de eco-driving por CAN (variantes de ADR-012).
- Aceptar por voz (depende del wake-word, T10-22).
- Servicio Cloud Run propio: la orquestación queda en el api por decisión del PO. Extraerla es materia de T10-21.
