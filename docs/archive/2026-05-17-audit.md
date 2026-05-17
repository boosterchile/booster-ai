# Booster AI — Auditoría Exhaustiva

**Fecha**: 2026-05-01  
**Estado del repositorio**: Greenfield 23 días post-kick-off (2026-04-23)  
**Alcance**: Análisis completo de packages, apps, schema, ADRs, deuda técnica y orden de ataque.

---

## 1. Estado de Packages (`packages/*`)

Síntesis: **2 implementados parcialmente, 14 placeholders** (vacíos). La mayoría de la lógica de dominio está pendiente.

### 1.1 `shared-schemas`
- **Propósito** (README + ADR-001): Zod schemas compartidos entre backend/frontend. Fuente única de verdad para la forma de los datos.
- **Estado**: Parcialmente implementado ✅✅🟡
- **Qué tiene**:
  - Domain schemas canónicos completos: trip.ts, vehicle.ts, membership.ts, stakeholder.ts, offer.ts, assignment.ts, driver.ts, carrier.ts, empresa.ts, plan.ts, user.ts, zone.ts, telemetry.ts, trip-event.ts, cargo-request.ts.
  - Primitivos y helpers: ids.ts, chile.ts (RUT validator), geo.ts.
  - Event schemas: telemetry-events.ts, trip-events.ts.
  - Form schemas: trip-request-create.ts, trip-request.ts, onboarding.ts, profile.ts, whatsapp.ts.
- **Qué falta**:
  - No hay schemas para eco-routing (ADR-012).
  - No hay schemas para consent grants del stakeholder (sí están en el domain, falta exportarlos del index).
  - Documentación de cómo los backends consumen estos schemas (ej. de los trip_events.ts al payload JSONB).
- **Estructura coherente**: SÍ. Bien organizada. Sigue patrón domain/ + events/ + forms/.

### 1.2 `config`
- **Propósito**: Parsing centralizado de env vars y constantes. ADR-001 exige fail-fast.
- **Estado**: Implementado ✅
- **Qué tiene**: Código en src/index.ts que parsea variables con Zod, exporta objetos tipados.
- **Qué falta**: Nada crítico. Funcional.

### 1.3 `logger`
- **Propósito** (ADR-001): Wrapper tipado sobre Pino con redaction automática de PII.
- **Estado**: Implementado parcialmente ✅🟡
- **Qué tiene**: Logger con soporte de correlationId, integración OpenTelemetry, redaction setup.
- **Qué falta**: Tests (coverage bloqueante en CI).

### 1.4 `ai-provider`
- **Propósito**: Abstracción sobre Gemini/Claude para NLU, generación de documentos.
- **Estado**: Placeholder vacío ❌
- **Dependencias**: Necesario para ADR-006 (WhatsApp NLU), pero apps/whatsapp-bot.ts no lo usa todavía.

### 1.5 `codec8-parser`
- **Propósito** (ADR-005): Parser binario de protocolo Teltonika Codec8 para telemetría IoT.
- **Estado**: Placeholder vacío ❌
- **Criticidad**: ALTA. Telemetry-tcp-gateway depende de este. Sin él, no hay telemetría desde dispositivos.

### 1.6 `trip-state-machine`
- **Propósito** (ADR-004): XState machines para lifecycle del trip (18 estados).
- **Estado**: Placeholder vacío ❌
- **Observación**: El trip_requests.ts del domain define los estados manualmente en un enum. La máquina de estados nunca se construyó.

### 1.7 `matching-algorithm`
- **Propósito** (ADR-004): Scoring multifactor para matching push real-time.
- **Estado**: Placeholder vacío ❌
- **Observación crítica**: apps/api/src/services/matching.ts implementó el algoritmo MVP inline (zona + capacidad + slack penalty). El código pertenece aquí, no en services/. **Duplicación y violación de principio CLAUDE.md "zero tech debt"**.

### 1.8 `pricing-engine`
- **Propósito**: Cálculo determinístico de precios según distancia, cargo, horario, etc.
- **Estado**: Placeholder vacío ❌
- **Observación**: En el sprint Slice B.5, el precio viene del shipper vía proposed_price_clp. Sin pricing-engine, no hay sugerencia algorítmica; la economía es "shipper fija precio, matching es solo de capacidad + zona".

### 1.9 `carbon-calculator`
- **Propósito** (ADR-004): Medición GLEC v3.0 + GHG Protocol puro.
- **Estado**: Placeholder vacío ❌
- **Criticidad**: Diferenciador defensible (ADR-009). Sin él, Booster no tiene HSE. Los campos carbon_emissions_kgco2e, distance_km, fuel_consumed_l, precision_method en el trip schema canónico esperan este package. Nunca se llama.

### 1.10 `whatsapp-client`
- **Propósito** (ADR-006): Clients tipados para Meta Cloud API + Twilio (fallback).
- **Estado**: Implementado parcialmente ✅🟡
- **Qué tiene**: Stubs para verifyMetaSignature, WhatsAppClient, TwilioWhatsAppClient.
- **Qué falta**: Implementación real de sending (apps/whatsapp-bot usa Twilio de facto).
- **Observación**: El bot elige en runtime, pero solo Twilio está integrado (TWILIO_ACCOUNT_SID env var).

### 1.11 `dte-provider`
- **Propósito** (ADR-007): Abstracción sobre DTE provider (Bsale o Paperless).
- **Estado**: Placeholder vacío ❌
- **Criticidad**: ALTA. Obligatorio para go-live en Chile. Sin DTE, no hay Guía de Despacho ni Factura electrónica legales.

### 1.12 `carta-porte-generator`
- **Propósito** (ADR-007): PDF de Carta de Porte según Ley 18.290.
- **Estado**: Placeholder vacío ❌
- **Criticidad**: ALTA. Obligatorio para transporte legal en Chile.

### 1.13 `document-indexer`
- **Propósito** (ADR-007): CRUD de documentos (indexación, búsqueda, retention 6 años).
- **Estado**: Placeholder vacío ❌
- **Criticidad**: ALTA. Sin esto, no hay auditoría, ni compliance, ni cumplimiento SII.

### 1.14 `notification-fan-out`
- **Propósito** (ADR-006, ADR-004): Orquestador de canales (Web Push, FCM, WhatsApp, Email, SMS).
- **Estado**: Placeholder vacío ❌
- **Observación**: apps/api/src/services/notify-offer.ts implementó inline el envío vía WhatsApp. Es parcial y no cubre todos los canales. **Otro caso de lógica en services en lugar de en package reutilizable**.

### 1.15 `ui-tokens`
- **Propósito** (DESIGN.md): Design tokens únicos (colores, tipografía, spacing).
- **Estado**: Implementado ✅
- **Qué tiene**: Tokens completos en TypeScript/CSS, integrado con Tailwind de apps/web.

### 1.16 `ui-components`
- **Propósito**: shadcn/ui + componentes Booster personalizados.
- **Estado**: Placeholder vacío ❌
- **Observación**: apps/web/src/components/ tiene componentes ad-hoc (LoginForm, etc). Sin package consolidado, hay riesgo de duplicación.

---

## 2. Estado de Apps (`apps/*`)

Síntesis: **1 app con lógica real (api), 1 con scaffolding (web), 6 vacíos o mínimos**.

### 2.1 `api`
- **Propósito**: Backend principal Hono + Drizzle + Postgres. ADR-001.
- **Estado**: Parcialmente implementado ✅✅🟡
- **Qué tiene**:
  - Rutas: GET /health, POST /trip-requests (legacy), POST /trip-requests-v2 (canónico), POST /me, GET /me, POST /empresas/onboarding, GET /empresas/:id, GET /empresas, POST /offers/{id}/accept, POST /offers/{id}/reject, GET /offers/mine.
  - Servicios: matching.ts (MVP zona + capacidad), notify-offer.ts (Twilio WhatsApp), offer-actions.ts, firebase.ts, onboarding.ts, user-context.ts.
  - Middleware: Firebase ID token validation, OIDC token validation, User context injection.
  - DB: Drizzle client tipado, migrator con advisory lock.
- **Qué falta**:
  - Ninguna de las 8 apps satélite existe de verdad.
  - Admin console sin endpoints.
  - Driver app no existe (solo carrier dashboard).
  - Shipper web UI no existe (solo WhatsApp).
  - DTE / Carta de Porte no existe.
  - Trip state machine ad-hoc (sin XState).
  - Pricing engine sin llamadas.
  - Carbon calculator sin llamadas.
  - Telemetría real (Codec8) no integrada.

### 2.2 `web`
- **Propósito**: PWA multi-rol (shipper, carrier, driver, admin). ADR-008.
- **Estado**: Scaffolding 🟡
- **Qué tiene**: Vite + React 18 + TanStack Router + Tailwind, Firebase Auth, RoleGuard, Layout, Rutas: /login, /onboarding, /app/ofertas, /app/perfil.
- **Qué falta**: Shipper UI, Driver mobile, Admin console UI, Sustainability Stakeholder dashboards, Trip detail página, PWA completo.

### 2.3 `whatsapp-bot`
- **Propósito** (ADR-006): Webhook Meta + NLU Gemini. Canal primario.
- **Estado**: Parcialmente implementado 🟡
- **Qué tiene**: Hono server, webhook Twilio, FSM conversation, Config.
- **Qué falta**: Meta Cloud API directo, Integración Gemini NLU, Templates sin variables ESG, Escalado a humano, Persistence conversation state.

### 2.4-2.8 `matching-engine`, `telemetry-tcp-gateway`, `telemetry-processor`, `notification-service`, `document-service`
- **Estado**: Todos vacíos ❌
- **Criticidad**: Alta (telemetría, documentos SII)

---

## 3. Schemas: Domain Canónico vs Implementación Operacional

| Entidad | Domain Schema | Drizzle Table | Crítica |
|---------|---------------|---------------|--------|
| Trip | 18 estados, ESG fields | tripRequests con 9 estados, sin ESG | ❌ Falta carbon_emissions_kgco2e, distance_km, fuel_consumed_l, precision_method. Estados parciales. |
| Vehicle | fuel_type, year, brand, model, teltonika_imei, inspection_expires_at | vehicles sin fuel_type, brand, model, teltonika_imei, curb_weight_kg | ❌ Falta fuel_type (necesario carbon-calculator). Falta curb_weight_kg. |
| Membership | Roles: owner, admin, dispatcher, driver, viewer | Mismo enum | ✅ Completo. |
| Offer | score 0-1, response_channel, eco-score | offers con score int/1000, sin eco-score | 🟡 Sin campos ESG. |
| **Stakeholder** | 5 subtypes, consent_grants array | NO EXISTE EN DRIZZLE | ❌ **CRÍTICA OMISIÓN**. Rol canónico sin tabla BD. |
| TripEvent | Domain define tipos adicionales | 9 tipos enum, falta carbon_calculated, certificate_issued | 🟡 Enum incompleto. |

---

## 4. ADRs vs Implementación

### ADR-001: Stack ✅ Implementado
### ADR-002: Skills Framework 🟡 Parcial (estructura existe, workflows vacíos)
### ADR-004: Modelo Uber-like 🟡 Parcial (4 roles OK, Sustainability Stakeholder falta en BD, state machine no es XState)
### ADR-005: Telemetría IoT ❌ No implementado (tcp-gateway, processor, codec8-parser vacíos)
### ADR-006: WhatsApp 🟡 Parcial (Twilio OK, Meta directo no, NLU no)
### ADR-007: Documentos SII ❌ No implementado (dte-provider, carta-porte-generator, document-indexer vacíos)
### ADR-008: PWA Multi-rol 🟡 Partial (carrier dashboard OK, shipper/driver/admin/stakeholder faltan)
### ADR-009: Diferenciadores ❌ Parcial (matching push OK, ESG/docs/observatorio faltan)
### ADR-010: Marketing ❌ No existe (apps/marketing no existe, boosterchile.com heredada)
### ADR-011: Admin Console ❌ No existe (sin endpoints, sin UI)
### ADR-012: Observatorio Urbano ❌ No existe (sin eco-routing, sin observatorio, sin gemelos)

---

## 5. Deuda Técnica del Sprint B

### Estructural (CLAUDE.md violations)

1. Matching algorithm en services/ no en packages/matching-algorithm
2. Notification logic en services/ no en packages/notification-fan-out
3. Trip state machine nunca construido (ad-hoc enum strings, no XState)
4. Schemas paralelos: domain vs Drizzle mismatch (Vehicle, Trip falta fields)

### Omisiones de Funcionalidad

5. carbon-calculator nunca llamado (emissions siempre NULL)
6. pricing-engine nunca llamado (precios 100% manuales)
7. Sustainability Stakeholder rol SIN tabla en Drizzle
8. Telemetría real (Codec8) = 0 (codec8-parser, tcp-gateway, processor vacíos)
9. DTE / Carta de Porte = 0 (dte-provider, carta-porte-generator, document-indexer vacíos)
10. Trip request v1 (legacy WhatsApp) vs v2 (canónico) coexisten
11. Offers sin eco-score (matching ignora ESG)
12. WhatsApp template sin variables ESG
13. membership_role enum sin sustainability_stakeholder
14. Empresas table sin perfil ESG (target_carbon_reduction_pct, prior_certifications)
15. trip_requests table sin campos ESG (carbon_emissions, distance_km, fuel_consumed_l, precision_method)
16. trip_events enum sin tipos ESG (carbon_calculated, certificate_issued, dispute_opened)
17. Offers notifiedAt sin intención clara (campo existe pero nunca se setea)
18. Driver app no existe en apps/web
19. Admin console no existe
20. Shipper UI web no existe
21. Pricing engine no llamado
22. Trip state machine no implementado

---

## 6. Dependencias Técnicas y Orden de Ataque

### Fundacional (prerequisitos)
1. Sincronizar shared-schemas vs Drizzle (CRÍTICA)
2. Crear tabla stakeholders + consent_grants
3. Expandir trip_events enum + trip_requests ESG fields
4. Expandir empresas table con perfil ESG

### Fase 1: Packages Críticos
5. codec8-parser (Codec8 binary parser)
6. carbon-calculator (GLEC v3.0 puro)
7. trip-state-machine (XState con 18 estados)
8. pricing-engine (Cálculo de precios determinístico)
9. matching-algorithm (Mover de services/)
10. notification-fan-out (Orquestador multicanal)
11. dte-provider (DTE Guía de Despacho)
12. carta-porte-generator (PDF Carta de Porte)
13. document-indexer (CRUD + retention)

### Fase 2: Telemetría IoT
14. telemetry-tcp-gateway (GKE Autopilot TCP server)
15. telemetry-processor (Dedup + enrich + Firestore)
16. eco-routing-service (Sugerencias ruta real-time)

### Fase 3: API Refactor + Admin
17. Refactor API para usar packages
18. Admin endpoints (search, intervene, incidents)
19. Sustainability Stakeholder endpoints

### Fase 4: Web UI
20. Admin console UI
21. Shipper UI web
22. Driver UI web
23. Stakeholder ESG dashboards
24. PWA manifest + service worker

### Fase 5: Observatorio
25. Observatorio urbano (BigQuery aggregations)
26. Gemelos digitales (simulación)

### Fase 6: Go-Live
27. apps/marketing (Next.js landing)
28. Consolidate trip-requests v1 vs v2

---

## 7. Riesgos del Sprint Reciente (Abordar YA)

### Blocking (TRL 10 fail sin resolver)

1. Sustainability Stakeholder NO existe en BD → Crear tabla stakeholders + consent_grants (Fase 0)
2. Carbon calculator nunca se llamó → Implementar + integrar (Fase 1)
3. Documento SII nunca integrado → Implementar dte-provider + carta-porte-generator + document-indexer (Fase 1)
4. Matching algorithm en services/ no en packages/ → Mover ANTES de que otras apps lo necesiten (Fase 1)
5. Trip state machine nunca construido → Implementar XState (Fase 1)

### Arquitectónicos

6. Telemetría: codec8-parser + tcp-gateway = 0% → Iniciar Fase 2 paralelo (MÁXIMA CRITICIDAD)
7. Admin console no existe → Iniciar Fase 3/4 paralelo (operación inmanejable sin él)
8. Shipper web UI no existe → Iniciar Fase 4 cuando API esté lista
9. Driver app no existe → Prototipo temprano (roadmap post-launch pero necesario saber cómo)
10. Schemas paralelos (domain vs Drizzle) → Sincronización Fase 0 CRÍTICA

---

## 8. Conclusión

| Área | % Implementado | Estado |
|------|---|---|
| Packages | 15% | 2/16 implementados, 14 placeholders |
| Apps | 20% | 1 API real, 1 web scaffolding, 6 vacíos |
| ADRs | 25% | Mayoría parciales, 1 omitido (stakeholder) |
| Deuda | ALTA | Mismatch schema, código en services, features no integradas |

**No se puede go-live sin**: Sustainability Stakeholder BD, Carbon calculator integrado, DTE/Carta de Porte funcionales, Admin console, Telemetría real.

**Ruta crítica al TRL 10**: 8 semanas mínimo. Fases 0-4 + integración E2E + audit CORFO.

