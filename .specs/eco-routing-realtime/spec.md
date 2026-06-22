# Spec — Eco-routing en tiempo real (ADR-012 Capa 1)

**Estado**: Draft (salida de brainstorming 2026-06-22 — pendiente de tu review antes de pasar a plan)
**Origen**: ADR-012 Capa 1 ("durante un trip activo, sugerir al conductor rutas alternativas o paradas cuando el tráfico hace la ruta actual ineficiente energéticamente"). Reescritura como **producto definitivo** (no MVP — ADR-009 / plan phase-0: "no tomar atajos").

---

## 1. Objetivo

Durante un viaje activo, **anticipar** congestión en la ruta del conductor y, si existe una alternativa más limpia, **avisarle por voz con tiempo para decidir** — antes de quedar atrapado. El conductor decide y navega como ya lo hace (advisory); Booster mide la adopción por telemetría para el storytelling de ahorro de CO₂e.

Diferenciador "moat" (ADR-009): no es solo "ruta más rápida" — es **ruta de menor emisión** (el guardrail de ETA evita sugerir algo mucho más lento).

## 2. Decisiones cerradas (brainstorming)

| Dimensión | Decisión |
|---|---|
| **Trigger** | Degradación de ETA detectada vía **Routes API con tráfico en vivo** (Google) sobre la ruta restante. No detección de congestión propia. |
| **Criterio de sugerencia** | **Emisiones primero, con guardrail de ETA**: sugerir la alternativa de mínimo kgCO₂e que NO empeore la ETA más de un umbral (ej. +10%). |
| **Carácter** | **Anticipatorio** — avisar antes del punto de decisión/congestión, con margen para tomar la alternativa. |
| **Entrega** | **Voice coaching** (TTS client-side, hands-free), reusando la infra `coaching-voice.ts` / `CoachingVoicePlayer`. Opt-in mute-by-default. |
| **Acción del conductor** | **Advisory puro** — la voz avisa, el conductor decide y navega; Booster muestra la alternativa en el mapa; se mide adopción por telemetría (¿se desvió?). (Nota: el voice-input para "aceptar por voz" depende del wake-word, hoy bloqueado por Picovoice.) |
| **Arquitectura** | **B — servicio dedicado event-driven + packages de dominio** (la visión ADR-012, bien construida). |

## 3. Arquitectura y componentes

Regla no-negociable CLAUDE.md: **algoritmos en packages (puros), el servicio orquesta DB/IO**.

### 3.1 `apps/eco-routing-service` (Cloud Run, event-driven) — orquestador
- Consume **posición en vivo** de viajes en estado `en_proceso` (ver §4).
- Mantiene **estado por viaje** (posición actual, ruta planificada + ETA baseline, timestamp de última evaluación, última sugerencia + cooldown).
- En cada update significativo de posición (con debounce/throttle para controlar costo de Routes API): orquesta detectar → (si degradado) pedir alternativas a Routes API → evaluar → (si recomendación) entregar por voz + persistir.
- **No** contiene lógica de algoritmo. Best-effort: nunca bloquea el viaje.

### 3.2 `packages/traffic-condition-detector` (puro, sin I/O)
- Input (Zod): `{ posiciónActual, rutaRestante, etaEnVivoSegundos, etaBaselineSegundos, leadTime }`.
- Output: `{ degradado: boolean, severidad, razón }` — ¿hay degradación material **adelante** que amerite evaluar alternativas, con suficiente margen de anticipación?
- Testeable aislado (umbrales, edge cases: sin baseline, posición stale, etc.).

### 3.3 `packages/route-alternatives-evaluator` (puro, sin I/O)
- Input (Zod): `{ origen=posiciónActual, destino, alternativas[] (de Routes API: distancia/duración-con-tráfico/fuelConsumption), vehículo+combustible, guardrailEtaPct }`.
- Computa emisiones por alternativa (vía `@booster-ai/carbon-calculator` — ya existe), elige la de **mínima emisión que respeta el guardrail de ETA**.
- Output: `{ recomendada, deltaEtaSegundos, deltaCo2eKg, polyline } | { tipo: 'ninguna_mejor' }`.

### 3.4 Entrega (reusa coaching-voice)
El servicio encola un **evento de sugerencia** al PWA del conductor (canal existente: push / SSE) con `{ texto, alternativa, deltas, polyline }`. El PWA lo **habla client-side** (TTS) si el conductor optó-in; muestra la alternativa en el mapa. Sin audio en el backend.

### 3.5 Persistencia: tabla `sugerencias_ruta` (nueva)
Ciclo de vida de cada sugerencia. Campos (naming bilingüe SQL español):
`id`, `viaje_id` (FK), `emitida_en`, `polyline_alternativa`, `delta_eta_segundos`, `delta_co2e_kg`, `eta_baseline_segundos`, `posicion_lat`/`posicion_lng` (al emitir), `entregada` (bool), `adoptada` (bool, nullable — se resuelve post-hoc por telemetría), `evaluada_adopcion_en`. Migration expand-only + `.down.sql` (ADR-066).

## 4. Data flow

```
[Teltonika] → telemetry-tcp-gateway → telemetry-processor → telemetry-events (Pub/Sub)
[PWA driver] → driver-position-reporter → (endpoint api) ──────────┐
                                                                    ▼
                                          posición en vivo por viaje activo
                                                                    ▼
                                  apps/eco-routing-service (consume posición)
                                                                    ▼
                  traffic-condition-detector  ──degradado?──►  Routes API computeRoutes
                     (ETA en vivo vs baseline)                  (TRAFFIC_AWARE_OPTIMAL +
                                                                computeAlternativeRoutes +
                                                                FUEL_CONSUMPTION) ── ya existe
                                                                    ▼
                                  route-alternatives-evaluator (emisiones + guardrail ETA)
                                                                    ▼
                                  ¿recomendación? → persistir sugerencias_ruta + push al PWA
                                                                    ▼
                                  PWA: CoachingVoicePlayer habla (opt-in) + alternativa en mapa
```

**Punto de integración a resolver en el plan**: cómo el servicio recibe la posición del PWA. Hoy `driver-position-reporter` (cliente) reporta al api; la posición Teltonika va a `telemetry-events`. El servicio event-driven necesita una **señal de posición unificada**. Opciones (decidir en plan): (a) publicar la posición del PWA al mismo topic de posición que el servicio consume; (b) el servicio lee last-known-position de Redis (ya poblado por telemetría) en un tick por viaje activo. Preferencia: (a) para mantener el carácter event-driven.

**ETA baseline**: se calcula al inicio del viaje (al pasar a `en_proceso`) con `routes-api.ts` para la ruta planificada (`ecoRoutePolylineEncoded` ya se persiste en el trip).

## 5. Lógica de anticipación (el corazón)

"Anticipatorio" = avisar **antes** de que el conductor pase el punto donde la alternativa diverge. Implica:
- El `traffic-condition-detector` mira la ETA en vivo de la ruta **restante** (Routes API ya forecastea congestión adelante).
- Cuando hay degradación, el `route-alternatives-evaluator` solo considera alternativas que **divergen en un cruce que el conductor TODAVÍA no pasó** (lead time ≥ umbral, ej. avisar ~2-3 min / ~2 km antes del cruce de divergencia).
- El servicio evalúa con frecuencia suficiente (event-driven sobre posición, con throttle) para atrapar la ventana.
- **Cooldown** por viaje: no más de 1 sugerencia cada N min; dedupe de la misma alternativa.

## 6. Consent / seguridad
- **Opt-in** mute-by-default (mismo patrón que coaching-voice, playbook 002). La voz de eco-routing respeta el opt-in de coaching-voice (o un toggle propio dentro del mismo).
- Voz = hands-free → seguro mientras maneja. **Cero interacción táctil requerida** (advisory puro).
- Frecuencia limitada (cooldown) para no saturar/distraer.

## 7. Manejo de errores (best-effort, nunca bloquea el viaje)
- Routes API (rate/quota/timeout): saltear el ciclo de evaluación, loguear, reintentar en el próximo update. Throttle para no exceder cuota/costo.
- Posición ausente/stale: saltear.
- carbon-calculator falla: no emitir la sugerencia (no entregar una parcial).
- Span OTel + log estructurado por evaluación (atributos: viajeId, degradado, recomendó, deltas). Sin PII.

## 8. Testing
- **Packages (TDD — dominio carbono/ruteo)**: `traffic-condition-detector` (umbrales de degradación, lead time, edge cases) y `route-alternatives-evaluator` (ranking por emisiones, guardrail de ETA, caso ninguna-mejor, fuel-consumption→emisiones). Cobertura ≥80%.
- **Servicio (integración)**: evento de posición → evaluación → sugerencia, con Routes API + carbon-calculator mockeados; cooldown/dedupe; best-effort (Routes API caído → no crashea).
- **E2E (diferido a una fase posterior)**: viaje simulado con congestión inyectada → la sugerencia por voz aparece.

## 9. Alcance

**En este build (la feature definitiva, sin atajos):**
- `apps/eco-routing-service` + los 2 packages + consumo de posición + Routes API alternativas + evaluación emisiones-con-guardrail + entrega por voz anticipatoria + tabla `sugerencias_ruta` + opt-in/cooldown + observabilidad (OTel/logs) + deploy (Dockerfile/Cloud Build/monitoreo) + runbook.
- Medición de adopción (¿se desvió a la alternativa? → kgCO₂e ahorrados) — vía correlación telemetría vs `sugerencias_ruta.polyline_alternativa`.

**Fuera (v2 / fases siguientes ADR-012):**
- Sugerencias de "parada temporal" (esperar a que aclare) — ADR-012 las menciona; v2.
- Observatorio urbano (Capa 2), gemelos digitales (Capa 3-4).
- Voice-input para aceptar por voz (depende del wake-word, bloqueado por Picovoice).
- Re-ruteo automático / turn-by-turn in-app.

## 10. Lo que ya existe (la base que se reusa)
- `apps/api/src/services/routes-api.ts` — `computeRoutes` con `TRAFFIC_AWARE_OPTIMAL` + `computeAlternativeRoutes` + `FUEL_CONSUMPTION`. **El corazón del cálculo ya está.**
- `@booster-ai/carbon-calculator` — emisiones GLEC por combustible/distancia.
- `eco-route-preview.ts`, `get-assignment-eco-route.ts`, `persist-eco-route-polyline.ts`, `compute-route-eta.ts` — ruteo eco existente (pre-aceptación).
- `ecoRoutePolylineEncoded` en el trip — ruta planificada.
- Pipeline de telemetría (gateway → processor → `telemetry-events`) + Redis last-position.
- `coaching-voice.ts` + `CoachingVoicePlayer.tsx` — TTS client-side hands-free, opt-in.
- Canal de push/SSE al PWA del conductor.

## 11. Calibración diferida (parámetros, no bloquean el diseño)
A fijar con datos reales / en el plan: umbral de "degradación material" (% ETA), lead time de anticipación (min/km), cooldown entre sugerencias, guardrail de ETA exacto (±%), throttle de Routes API (frecuencia máx de re-query por viaje).

---

## Preguntas abiertas para tu review
1. ¿El opt-in de eco-routing es el mismo toggle que coaching-voice, o uno separado?
2. ¿La medición de adopción (¿se desvió?) entra en este build o es un fast-follow?
3. ¿El servicio consume posición vía topic (preferido) o tick sobre Redis last-position? (afecta el plan de integración del §4).
