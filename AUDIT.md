# Booster AI — Auditoría del Repositorio

**Última revisión**: 2026-05-03
**Auditoría inicial**: 2026-05-01 (23 días post-kickoff, ver sección 9)
**Alcance**: Estado real de packages, apps, schema, ADRs, deuda técnica y orden de ataque.

> Esta auditoría se mantiene como **single source of truth del estado del repo**. Cualquier agente que entre al proyecto debe leer este archivo + `CLAUDE.md` + `HANDOFF.md` antes de tocar código.

---

## 1. Resumen ejecutivo (2026-05-03)

| Capa | Estado | %  | Cambio vs. auditoría 2026-05-01 |
|------|--------|----|--------------------------------|
| Apps | 5/8 funcionales, 3 skeleton | ~62% | +42 pp (api/web/whatsapp-bot completas, telemetría E2E operativa) |
| Packages | 8 funcionales, 2 MVP, 7 placeholders | ~50% | +35 pp (carbon-calculator, certificate-generator, codec8-parser, whatsapp-client implementados) |
| ADRs | 14 vigentes (001-014) | — | +6 ADRs (009-014 añadidos) |
| Infra | Producción operativa, staging pendiente | ~85% | +60 pp (Cloud Run, GKE, Pub/Sub, Cloud SQL, KMS, Storage, Redis vivos) |
| CI/CD | 4 workflows + Cloud Build pipelines | ~90% | +30 pp (release.yml con WIF, security.yml, Cloud Build prod) |

**Estado macro**: el sprint posterior a la auditoría inicial ejecutó **chat realtime, certificados ESG, live tracking maps, telemetría IoT phase-2, CRUD de cargas/vehículos**. La narrativa de "15% implementado" está obsoleta.

**Bloqueantes regulatorios go-live Chile que persisten**:
1. DTE (`packages/dte-provider`) — placeholder vacío.
2. Carta de Porte (`packages/carta-porte-generator`) — placeholder vacío.
3. `apps/document-service` — skeleton (sin retention SII de 6 años aplicado a flujos reales).
4. `packages/trip-state-machine` — XState canónica nunca codificada (FSM hoy implícita en handlers).

---

## 2. Estado de Packages (`packages/*`)

### 2.1 Funcionales ✅

| Package | LOC aprox. | Tests | Notas |
|---------|-----------|-------|-------|
| `shared-schemas` | 1,413 | 0 propios (cubierto por consumidores) | ~47 schemas Zod organizados por domain/events/forms. Single source of truth tipado backend↔frontend. |
| `carbon-calculator` | 762 | 5 | GLEC v3.0 con 3 modos: `exacto-canbus` (Teltonika), `modelado` (Maps + perfil energético), `por-defecto`. Factores SEC Chile 2024. Linealidad ±10% suficiente pre-launch. |
| `certificate-generator` | 1,573 | 1 | PDF firmado PAdES + KMS RSA-4096. Pieza diferenciadora completa. |
| `codec8-parser` | 600 | 3 | Parser binario Teltonika (IMEI handshake + AVL). Puro. |
| `whatsapp-client` | 855 | 3 | Meta Cloud API + Twilio (dual BSP). |
| `config` | 121 | 0 | Zod env parsing fail-fast. |
| `logger` | 162 | 0 | Pino + redaction PII (Ley 19.628). |
| `ui-tokens` | 515 | 0 | Design tokens Tailwind. |

### 2.2 MVP / parcial 🟡

| Package | Estado | Gap |
|---------|--------|-----|
| `matching-algorithm` | 94 LOC, score por slack capacidad | Falta scoring geo, ratings históricos, cargo compatibility, pricing dinámico. |
| `notification-fan-out` | 81 LOC | Solo orquestación inicial; fan-out real sigue en `apps/api/services`. |

### 2.3 Placeholders ❌ (7 LOC, TODO)

`pricing-engine`, `trip-state-machine`, `ai-provider`, `document-indexer`, `dte-provider`, `carta-porte-generator`, `ui-components`.

**Crítico**: `dte-provider` + `carta-porte-generator` + `document-indexer` son **bloqueantes regulatorios**. `trip-state-machine` es deuda arquitectónica (CLAUDE.md exige máquina canónica).

---

## 3. Estado de Apps (`apps/*`)

### 3.1 Funcionales ✅

| App | Tech | Tamaño | Tests | Highlights |
|-----|------|--------|-------|------------|
| `api` | Hono + Drizzle + Firebase Auth + Pub/Sub + KMS | 39 archivos `.ts` | 11 | Rutas: `/me`, `/trip-requests(-v2)`, `/offers`, `/empresas`, `/assignments`, `/certificates`, `/chat` (REST + SSE), `/vehiculos`, `/admin/*`, `/webpush`. Migrations Drizzle, graceful shutdown. |
| `web` | React 18 + TanStack Router/Query + Tailwind + Workbox + Zustand | 40 archivos `.tsx/.ts` | Vitest + Playwright config | PWA multi-rol con rutas: `/login`, `/onboarding`, `/app`, `/ofertas`, `/cargas`, `/carga-track`, `/asignacion-detalle`, `/vehiculos`, `/vehiculo-live`, `/certificados`, `/perfil`, `/admin-dispositivos`. |
| `whatsapp-bot` | Hono + Twilio + Redis + xstate | 9 archivos | 1 (machine.test) | Conversation state machine con Redis backend, webhook Twilio, graceful shutdown. |
| `telemetry-tcp-gateway` | TCP server Teltonika + Pub/Sub publisher | 5 archivos | 1 | GKE Autopilot, IMEI auth, AVL packets, ACK 4B. |
| `telemetry-processor` | Pub/Sub subscriber + Drizzle | 3 archivos | Vitest configurado | Dedup + persist `telemetria_puntos`, health HTTP. |

### 3.2 Skeleton ⚠️

`apps/document-service`, `apps/matching-engine`, `apps/notification-service` — solo logger boot + `TODO: implementar según el ADR correspondiente`.

**Lógica esperada en estos services vive hoy embebida en `apps/api`**, lo cual viola CLAUDE.md §arquitectura ("algoritmos viven en `packages/`").

---

## 4. ADRs vs Implementación

| ADR | Tema | Estado | Notas |
|-----|------|--------|-------|
| 001 | Stack TypeScript + GCP | ✅ Implementado | |
| 002 | Skill framework | ✅ Estructura + 6 skills + 6 slash commands + 3 agents | |
| 004 | Uber-like + 5 roles | 🟡 Parcial | 5to rol (Sustainability Stakeholder) sin tabla BD; FSM XState pendiente. |
| 005 | Telemetría IoT Teltonika | ✅ Implementado | TCP gateway + processor + parser end-to-end. |
| 006 | WhatsApp primary | 🟡 Parcial | Twilio operativo; Meta Cloud directo + NLU Gemini pendientes. |
| 007 | Documentos SII | ❌ No implementado | DTE + Carta Porte + indexer + retention bucket aplicado a flujos. |
| 008 | PWA multi-rol | ✅ Implementado | 5 surfaces de UI activas. |
| 009 | Diferenciadores | 🟡 Parcial | ESG/maps/matching push OK; observatorio pendiente. |
| 010 | Marketing site | ❌ No iniciado | `apps/marketing` no existe. |
| 011 | Admin console | 🟡 Endpoints parciales | UI admin viva (admin-dispositivos), falta resto. |
| 012 | Observatorio + digital twins | ❌ No iniciado | |
| 013 | DB access pattern (3 capas) | ✅ Implementado | Bastion IAP + cloud-sql-proxy + Cloud Run Jobs. |
| 014 | Google Maps API key | ✅ Implementado | Restricción HTTP referrer. |

---

## 5. Deuda técnica viva (no resuelta)

### Estructural (violations CLAUDE.md)

1. **Matching en `apps/api/services/`** (debería estar en `packages/matching-algorithm`).
2. **Notification logic** parcialmente en `apps/api/services/notify-offer.ts`.
3. **Trip state machine** sin XState (enum + lógica dispersa en handlers).
4. **`pricing-engine` ausente** — precios manuales del shipper.

### Tests con cobertura indirecta

5. Packages clave (`shared-schemas`, `matching-algorithm`, `ui-tokens`, `logger`, `config`) no tienen tests propios. El gate del 80% se cumple por consumidores. Riesgo: refactors silenciosos.

### Operacional

6. **Sin staging environment real** — `cloudbuild.staging.yaml` deshabilitado, `e2e-staging.yml` placeholder. Todo deploy es prod-direct con canary manual.
7. **Sin Playwright MCP** activado (este PR lo añade).
8. **`apps/document-service`, `apps/matching-engine`, `apps/notification-service`** vacíos; sus responsabilidades viven en `apps/api`.

### Regulatorios (bloqueantes go-live Chile)

9. DTE Guía de Despacho (`packages/dte-provider`).
10. Carta de Porte Ley 18.290 (`packages/carta-porte-generator`).
11. Document indexing + retention 6 años aplicado (`packages/document-indexer` + flujos en API).

---

## 6. Schemas: Domain Canónico vs Drizzle

| Entidad | Drizzle | ESG fields | Estado |
|---------|---------|------------|--------|
| `viajes` | ✅ | ✅ (carbon_emissions_kgco2e, distance_km, fuel_consumed_l, precision_method poblados) | OK |
| `vehiculos` | ✅ | ✅ (fuel_type, brand, model, teltonika_imei, curb_weight_kg) | OK |
| `usuarios` / `empresas` | ✅ | 🟡 (perfil ESG empresa parcial) | Mejorable |
| **`stakeholders`** | ❌ | — | **CRÍTICA OMISIÓN — sin tabla todavía** |
| `ofertas` | ✅ | 🟡 (sin eco-score) | Mejorable |
| `eventos_viaje` | ✅ | 🟡 (faltan tipos `dispute_opened`, `eco_route_suggested`) | Mejorable |
| `telemetria_puntos` | ✅ | ✅ | OK |
| `certificados_carbono` | ✅ | ✅ (firma KMS, PDF PAdES, hash) | OK |
| `chat_*` | ✅ | n/a | OK |

---

## 7. Orden de ataque recomendado (post-2026-05-03)

### Sprint inmediato (1-2 semanas)
1. **Mover matching-algorithm** a `packages/` y refactor `apps/api` para consumirlo.
2. **Codificar `trip-state-machine` en XState** con los 18 estados de ADR-004.
3. **Tabla `stakeholders` + `consent_grants`** en Drizzle (cierra omisión crítica ADR-004).
4. **Tests propios** en `shared-schemas`, `matching-algorithm`, `pricing-engine`.

### Sprint go-live regulatorio (3-4 semanas)
5. **`dte-provider`** (Bsale o Paperless integration).
6. **`carta-porte-generator`** (PDF Ley 18.290).
7. **`document-indexer`** + retention 6 años aplicado.
8. **`apps/document-service`** orquestando los tres anteriores.

### Sprint operacional (1-2 semanas)
9. **Staging environment** Terraform + GCP project.
10. **`pricing-engine` MVP** (tarifa base + adjustments por peso/distancia/urgencia/retorno vacío).
11. **Mover notification-fan-out** fuera de `apps/api/services`.

### Sprint extender producto (post go-live)
12. **`ai-provider` + NLU Gemini** en whatsapp-bot.
13. **`apps/marketing`** Next.js (ADR-010).
14. **Observatorio urbano** + digital twins (ADR-012).

---

## 8. Cómo se mantiene esta auditoría

- Re-auditar al final de cada sprint mayor (chat realtime, certs, live tracking ya cerrados).
- Cada cambio de stage en una capa actualiza las tablas de la sección 1.
- Si un bloqueante de la sección 5 se cierra, mover a "histórico" (sección 9) con el commit que lo cerró.

---

## 9. Histórico — Auditoría inicial (2026-05-01)

> Conservada como evidencia del baseline a 23 días post-kickoff. Las afirmaciones de "15% implementado" reflejan ese momento, no el actual.

### 9.1 Síntesis original

> "2 implementados parcialmente, 14 placeholders. La mayoría de la lógica de dominio está pendiente. 1 app con lógica real (api), 1 con scaffolding (web), 6 vacíos o mínimos. Coverage 0%. Mismatch domain ↔ Drizzle. 8 semanas mínimo al TRL 10."

### 9.2 Bloqueantes que SE CERRARON tras 2026-05-01 (commits relevantes)

- ✅ `carbon-calculator` integrado — commit `3725d7d` (KMS RSA-4096) y siguientes.
- ✅ `codec8-parser` y `telemetry-tcp-gateway` E2E — phase 2 deployed via `deploy-phase-2.sh`.
- ✅ `apps/web` con UI completa para 4 roles — commits `ux(cargas)`, `ui(maps)`, `feat(maps)`.
- ✅ Trip events ESG (`carbon_calculated`, `certificate_issued`) — commits `feat(certs)`.
- ✅ Live tracking tipo Uber — commits `feat(maps)`.
- ✅ Chat realtime con SSE + Web Push + WhatsApp fallback — sprint P3.

### 9.3 Bloqueantes que PERSISTEN

Listados en sección 5 actual.
