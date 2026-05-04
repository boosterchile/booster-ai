# Booster AI — Auditoría Exhaustiva

**Fecha**: 2026-05-04
**Estado del repositorio**: Greenfield 11 días post-kick-off (2026-04-23)
**Auditoría previa**: 2026-05-01 (3 días). Esta versión refleja el progreso del sprint Slice C (telemetría Codec8 end-to-end, certificados de huella, chat shipper↔transportista, UI shipper completa, ADR-013/014).
**Alcance**: Snapshot completo de packages, apps, schema, ADRs, deuda técnica y orden de ataque.

> **Resumen ejecutivo del delta vs auditoría 2026-05-01**:
> - 3 packages clave salieron de placeholder y se integraron (`carbon-calculator`, `codec8-parser`, `whatsapp-client`). 1 package nuevo (`certificate-generator` con KMS RSA-PKCS1-4096-SHA256).
> - Telemetría Codec8 viva end-to-end: `telemetry-tcp-gateway` (GKE Autopilot) + `telemetry-processor` operativos con smoke E2E pasado.
> - Tabla `stakeholders` + `consents` creadas en Drizzle (cierra omisión crítica de la auditoría anterior).
> - Trip schema con campos ESG (`carbon_emissions_kgco2e`, `precision_method`, `distance_km`) y campos de certificación (`certificado_pdf_url`, `certificado_sha256`, `certificado_kms_version`).
> - Chat shipper↔transportista (P3) end-to-end: REST + Pub/Sub realtime SSE + Web Push (VAPID) + WhatsApp fallback + UI integrada en 2 surfaces.
> - UI shipper end-to-end: `cargas` (lista activa/historial + crear + detalle + cancel + tracking estilo Uber).
> - Vehículos: CRUD completo + telemetría reciente + live tracking en mapa.
> - 2 ADRs nuevos: ADR-013 (acceso DB en 3 capas) y ADR-014 (Google Maps API key).
> - Bastion IAP + Cloud SQL Auth Proxy operativos para acceso DB controlado.

---

## 1. Estado de Packages (`packages/*`)

Síntesis: **6 implementados (incluye 1 nuevo), 11 placeholders**. Salto fuerte vs auditoría 2026-05-01 (eran 2 implementados).

### 1.1 `shared-schemas` ✅ Implementado
- **Propósito**: Zod schemas compartidos backend↔frontend. Fuente única de verdad.
- **Estado**: Completo y consistente con Drizzle.
- **Domain canónico** (`src/domain/`): `trip`, `vehicle`, `membership`, `stakeholder`, `offer`, `assignment`, `driver`, `transportista` (renombrado desde carrier), `empresa`, `plan`, `user`, `zone`, `telemetry`, `trip-event`, `cargo-request`, `trip-metrics`.
- **Eventos**: `telemetry-events.ts`, `trip-events.ts`.
- **Forms**: `trip-request-create`, `trip-request`, `onboarding`, `profile`, `whatsapp`.
- **Primitivos**: `ids`, `chile` (RUT), `geo`.
- **Pendiente menor**: schemas de eco-routing (ADR-012, módulo aún no construido); export de consent grants desde root index.

### 1.2 `config` ✅ Implementado
- Parsing centralizado fail-fast con Zod. Schemas separados por área (`common`, `database`, `firebase`, `gcp`, `redis`).

### 1.3 `logger` ✅ Implementado parcial 🟡
- Wrapper Pino con `correlationId`, integración OpenTelemetry, redaction PII.
- **Pendiente**: cobertura de tests (bloqueante en CI cuando se mida globalmente).

### 1.4 `ai-provider` ❌ Placeholder vacío
- Crítico para ADR-006 (NLU Gemini en WhatsApp). Sigue sin uso real (bot opera con FSM determinístico).

### 1.5 `codec8-parser` ✅ Implementado (NUEVO desde auditoría anterior)
- Parser binario Teltonika Codec 8 / 8E completo: `avl-packet`, `buffer-reader`, `crc16`, `handshake`, `tipos`.
- Consumido por `apps/telemetry-tcp-gateway` con smoke test E2E pasado.

### 1.6 `trip-state-machine` ❌ Placeholder vacío
- XState aún no construido. Lifecycle del trip permanece como enum string en Drizzle. **Sigue siendo deuda estructural**.

### 1.7 `matching-algorithm` ❌ Placeholder
- Sigue como `index.ts` único. La lógica vive en `apps/api/src/services/matching.ts` (zona + capacidad + slack penalty).
- **Deuda estructural pendiente**: mover a package antes de que matching-engine satélite la necesite.

### 1.8 `pricing-engine` ❌ Placeholder
- Sin uso. Precio sigue siendo `proposed_price_clp` manual del shipper.

### 1.9 `carbon-calculator` ✅ Implementado (NUEVO desde auditoría anterior)
- GLEC v3.0 puro con factores SEC Chile 2024 + factores default por tipo vehículo.
- 3 modos de precisión: `por-defecto`, `modelado`, `exacto-canbus`.
- `factor-carga` ajustado por payload.
- Wireado en `accept-offer` (escribe `carbon_emissions_kgco2e`, `distance_km`, `precision_method` en trip).
- Diferenciador defensible (ADR-009) ya activo.

### 1.10 `whatsapp-client` ✅ Implementado
- Twilio: `twilio-client`, `twilio-signature` con verificación HMAC-SHA1 + tests.
- Cliente Meta tipado en stub (no integrado en runtime; bot usa Twilio).
- **Pendiente**: implementación Meta Cloud API directa (ADR-006).

### 1.11 `dte-provider` ❌ Placeholder
- DTE Guía de Despacho SII sin abstracción. **Bloqueante para go-live legal Chile**.

### 1.12 `carta-porte-generator` ❌ Placeholder
- Carta de Porte Ley 18.290 sin generador. **Bloqueante para go-live legal Chile**.

### 1.13 `document-indexer` ❌ Placeholder
- Sin CRUD documental ni retention 6 años. **Bloqueante compliance SII**.

### 1.14 `notification-fan-out` ❌ Placeholder
- La orquestación multicanal sigue split: `notify-offer` (Twilio), `web-push` (VAPID), `chat-whatsapp-fallback`. Funcional pero descentralizado.

### 1.15 `ui-tokens` ✅ Implementado
- Tokens completos (colors, typography, spacing, radius, shadow, breakpoint, z-index, duration).

### 1.16 `ui-components` ❌ Placeholder
- Componentes ad-hoc en `apps/web/src/components/`. Sin package consolidado.

### 1.17 `certificate-generator` ✅ Implementado (PACKAGE NUEVO)
- Emite certificados de huella de carbono firmados por viaje.
- Firma KMS RSA-PKCS1-4096-SHA256 + PAdES.
- CA self-signed para dev; PDF generator base; storage (GCS).
- Wireado a `confirmar-entrega-viaje` + backfill job para viajes pendientes.

---

## 2. Estado de Apps (`apps/*`)

Síntesis: **3 apps reales (api, web, whatsapp-bot), 2 con scaffolding integrado (telemetry-tcp-gateway, telemetry-processor), 3 vacíos**.

### 2.1 `api` ✅✅ Implementado, en expansión activa
- **Rutas** (13): `health`, `me`, `empresas`, `trip-requests` (legacy), `trip-requests-v2`, `offers`, `assignments`, `vehiculos`, `chat`, `certificates`, `webpush`, `admin-dispositivos`, `admin-jobs`.
- **Servicios** (13): `matching`, `notify-offer`, `offer-actions`, `firebase`, `onboarding`, `user-context`, `calcular-metricas-viaje`, `confirmar-entrega-viaje`, `emitir-certificado-viaje`, `estimar-distancia`, `chat-pubsub`, `chat-whatsapp-fallback`, `web-push`.
- **Jobs** (Cloud Run): `backfill-certificados`, `merge-duplicate-users` (Capa 3 de ADR-013).
- **Middleware**: Firebase ID token + OIDC server-to-server + user context injection.
- **DB**: Drizzle con migrator y advisory lock; acceso vía Cloud SQL Auth Proxy (ADR-013).
- **Pendiente**: stakeholder endpoints (read-only consent-scoped), endpoints DTE/Carta de Porte, admin search/intervene, driver app endpoints.

### 2.2 `web` 🟡 Scaffolding extendido (10+ rutas)
- **Stack**: Vite + React 18 + TanStack Router + TanStack Query + Tailwind + Firebase Auth + service worker propio.
- **Rutas**: `/login`, `/onboarding`, `/app/ofertas`, `/app/perfil`, `/cargas` (lista activa + historial), `/cargas/:id` (detalle), `/cargas/:id/track` (live tracking Uber-style), `/vehiculos` (lista), `/vehiculos/:id` (detalle + telemetría), `/vehiculos/:id/live` (live map), `/asignacion/:id`, `/certificados`, `/admin/dispositivos`.
- **Integraciones**: Google Maps API (ADR-014), Web Push (VAPID), SSE realtime para chat.
- **Pendiente**: Driver app (rol presente pero UI mínima), Admin console amplio, Stakeholder ESG dashboards, PWA manifest formal.

### 2.3 `whatsapp-bot` 🟡 Implementado parcial
- Hono server + webhook Twilio + FSM conversation persistente + routes/services organizados.
- **Pendiente**: integración Meta Cloud API directa, NLU Gemini, escalado a humano, templates con variables ESG.

### 2.4 `telemetry-tcp-gateway` ✅ Operativo (NUEVO desde auditoría anterior)
- TCP server Codec8 sobre GKE Autopilot con `connection-handler`, `imei-auth`, `pubsub-publisher`.
- Smoke E2E pasado (commit `2e5e4de`).

### 2.5 `telemetry-processor` ✅ Operativo (NUEVO desde auditoría anterior)
- Pub/Sub consumer con `persist` a Postgres (`telemetry_points`).
- Suscripción `telemetry-events-processor-sub` definida en Terraform (cerró gap crítico, commit `2666384`).

### 2.6-2.8 `matching-engine`, `notification-service`, `document-service` ❌ Vacíos
- 1 archivo cada uno (placeholder). Funcionalidad cubierta inline en `apps/api`.

---

## 3. Schemas: Domain Canónico vs Drizzle

| Entidad | Domain | Drizzle | Estado |
|---|---|---|---|
| Trip | 18 estados, ESG fields, certs | `viajes` con estados + `carbon_emissions_kgco2e` + `distance_km` + `precision_method` + `certificado_*` | ✅ Sincronizado (ESG y certs incorporados) |
| Vehicle | fuel_type, teltonika_imei, etc. | `vehiculos` con `tipo_combustible`, `teltonika_imei` (unique + indexed) | ✅ Sincronizado |
| Membership | 5 roles | `membresias` mismo enum | ✅ |
| Offer | score, response_channel, eco-score | `ofertas` con `score`, `canal_respuesta`, `enviado_en` | 🟡 sin eco-score aún |
| **Stakeholder** | 5 subtypes + consent grants | `stakeholders` + `consentimientos` (NUEVO) | ✅ Cerrado |
| TripEvent | tipos ESG (carbon_calculated, certificate_issued) | `tipo_evento_viaje` enum extendido | ✅ Sincronizado |
| TripMetrics | métricas por viaje | `trip_metrics` (tabla separada) | ✅ |
| TelemetryPoint | telemetría procesada | `telemetry_points` | ✅ NUEVO |
| ChatMessage | mensajes shipper↔transportista | `chat_messages` + `tipo_mensaje_chat` enum | ✅ NUEVO |
| PushSubscription | endpoints Web Push | `push_subscriptions` + `estado_push_subscription` enum | ✅ NUEVO |
| PendingDevice | onboarding Teltonika | `pending_devices` + `estado_dispositivo_pendiente` enum | ✅ NUEVO |

**Naming bilingüe respetado**: tablas/columnas en español snake_case sin tildes (`empresas`, `viajes`, `vehiculos`, `nombre_completo`, `creado_en`); enums en español (`estandar_reporte`, `metodo_precision`); siglas internacionales preservadas (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`).

---

## 4. ADRs vs Implementación

| ADR | Estado |
|---|---|
| ADR-001: Stack | ✅ Implementado |
| ADR-002: Skills Framework | 🟡 Estructura presente, workflows parcialmente poblados |
| ADR-004: Modelo Uber-like | ✅ 5 roles definidos, Stakeholder en BD; state machine aún no XState |
| ADR-005: Telemetría IoT | ✅ Pipeline Codec8 end-to-end operativo |
| ADR-006: WhatsApp | 🟡 Twilio operativo + chat fallback; Meta directo y NLU Gemini pendientes |
| ADR-007: Documentos SII | ❌ DTE/Carta de Porte/Document-indexer aún placeholders |
| ADR-008: PWA Multi-rol | 🟡 Shipper + Transportista funcional; Driver/Admin/Stakeholder pendientes; PWA manifest formal pendiente |
| ADR-009: Diferenciadores | 🟡 Carbon GLEC + certificados firmados KMS activos; observatorio/eco-routing pendientes |
| ADR-010: Marketing | ❌ apps/marketing no existe |
| ADR-011: Admin Console | 🟡 Endpoints `admin-dispositivos` + `admin-jobs` y UI `admin/dispositivos` mínima; resto pendiente |
| ADR-012: Observatorio Urbano | ❌ Sin eco-routing ni gemelos digitales |
| **ADR-013: Acceso DB 3 capas** | ✅ Implementado (NUEVO): Capa 1 directo desde apps; Capa 2 IAP bastion + Cloud SQL Auth Proxy; Capa 3 Cloud Run jobs operacionales |
| **ADR-014: Google Maps API key** | ✅ Implementado (NUEVO): integrado en web PWA |

---

## 5. Deuda Técnica activa

### Estructural (CLAUDE.md violations)

1. **Matching algorithm sigue en `services/`** y no en `packages/matching-algorithm` (deuda heredada).
2. **Notification orchestration descentralizada**: `notify-offer` + `web-push` + `chat-whatsapp-fallback` separados; `notification-fan-out` aún placeholder.
3. **Trip state machine sigue como enum**, sin XState.
4. **Trip request v1 vs v2 coexisten** (legacy WhatsApp + canónico). Consolidación pendiente.
5. **`ui-components` sin consolidar** — componentes en `apps/web/src/components/` con riesgo de duplicación.

### Funcionales pendientes

6. **DTE / Carta de Porte / Document-indexer** sin implementación. **Bloqueante go-live legal Chile**.
7. **AI provider sin uso real** — NLU Gemini no integrado al bot WhatsApp.
8. **Pricing engine sin uso** — precio 100% del shipper.
9. **Stakeholder endpoints** consent-scoped no expuestos vía API.
10. **Driver app** sin UI dedicada (uso vía web genérica).
11. **Eco-routing y observatorio urbano** (ADR-012) sin scaffolding.
12. **Offers sin eco-score** — matching ignora factor ESG en ranking.
13. **Meta Cloud API directo** sin integración (Twilio sigue siendo único canal real).

### Cerradas desde auditoría 2026-05-01

- ✅ Tabla `stakeholders` + `consents` creadas.
- ✅ Trip ESG fields (`carbon_emissions_kgco2e`, `distance_km`, `precision_method`).
- ✅ `carbon-calculator` implementado y wireado a `accept-offer`.
- ✅ `codec8-parser` + telemetría TCP gateway + processor end-to-end.
- ✅ Vehicles `teltonika_imei` y `fuel_type`.
- ✅ TripEvent enum con tipos ESG.
- ✅ Certificación de huella firmada (`certificate-generator` + KMS).
- ✅ Chat realtime shipper↔transportista (P3 completo).
- ✅ UI shipper E2E (`/cargas` + tracking).
- ✅ Vehicle CRUD + live tracking.

---

## 6. Orden de ataque actualizado

### Fase 1 (en curso): Compliance legal + UX shipper
- 🟡 `dte-provider` + `carta-porte-generator` + `document-indexer` (Top-1 prioridad).
- 🟡 Trip state machine XState (refactor).
- 🟡 Mover matching a package + introducir eco-score.
- 🟡 Driver app dedicada (mobile-first).
- 🟡 Notification fan-out consolidado.

### Fase 2: Admin + Stakeholder
- Admin console (search, intervene, disputes).
- Stakeholder endpoints + ESG dashboards.
- Consolidar trip-requests v1↔v2.

### Fase 3: AI + Observatorio
- AI provider con Gemini wireado al bot WhatsApp.
- Meta Cloud API directo.
- Eco-routing real-time.
- Observatorio urbano (BigQuery aggregations).
- Gemelos digitales.

### Fase 4: Go-Live
- `apps/marketing` (Next.js landing).
- PWA manifest formal + offline-first.
- E2E Playwright contra staging.
- Audit CORFO + TRL 10.

---

## 7. Riesgos vigentes (próximas 2 semanas)

### Bloqueantes go-live

1. **DTE + Carta de Porte sin implementar** — sin esto no hay legalidad Chile.
2. **Driver app inexistente** — afecta operación viajes en campo.
3. **Trip state machine ad-hoc** — riesgo de inconsistencia con 18+ estados.

### Arquitectónicos

4. **Matching y notification en `services/`** — bloquea `apps/matching-engine` satélite.
5. **Trip-requests v1↔v2 coexistiendo** — superficie de bugs.
6. **AI provider no usado** — diferencia vs competencia (NLU bot) no realizada.

### Operacionales

7. **Cobertura de tests sin enforcement global** — gate 80% pendiente de activar bloqueante en CI.
8. **PWA sin manifest formal** — install prompt y offline aún no validados.

---

## 8. Conclusión

| Área | % Implementado (2026-05-01 → 2026-05-04) | Estado |
|------|---|---|
| Packages | 15% → ~35% | 6/17 implementados, 11 placeholders |
| Apps | 20% → ~55% | 3 apps reales + 2 satélite operativas + 3 placeholders |
| ADRs | 25% → ~55% | 5 implementados, 4 parciales, 4 pendientes |
| Deuda | ALTA → MEDIA-ALTA | Schemas sincronizados; sigue deuda en packages compartidos y compliance SII |

**Bloqueantes go-live remanentes**: DTE/Carta de Porte/document-indexer, driver app, trip state machine XState, eco-score en offers.

**Ruta crítica al TRL 10**: estimación previa 8 semanas; sprint actual recortó ~2 semanas vía delivery paralelo (telemetría + certs + chat + UI shipper). Estimación revisada: **6 semanas** si se ataca compliance legal en próximo sprint.
