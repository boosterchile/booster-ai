# ADR-001 — Selección del Stack Tecnológico

**Status**: Accepted (con amendments 2026-04-23 v2)
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: El stack de Booster 2.0 (Express + Prisma + npm workspaces + Python FastAPI híbrido)
**Related**: [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md) · [ADR-005 Telemetría IoT](./005-telemetry-iot.md) · [ADR-006 WhatsApp](./006-whatsapp-primary-channel.md) · [ADR-007 Gestión documental Chile](./007-chile-document-management.md) · [ADR-008 PWA multi-rol](./008-pwa-multirole.md)

## Amendments

**2026-04-23 v2** (mismo día, ampliación de contexto): después del ADR inicial, el Product Owner aclaró cinco puntos que amplían significativamente el stack:

1. **Booster AI es plataforma tipo Uber** (no marketplace estático) → matching real-time, trip lifecycle state machine, notificaciones push. Ver ADR-004.
2. **1000+ dispositivos Teltonika** con crecimiento esperado → arquitectura de telemetría IoT escalable. Ver ADR-005.
3. **WhatsApp como canal primario**, no secundario → apps/whatsapp-bot con NLU Gemini. Ver ADR-006.
4. **Gestión documental obligatoria Chile** (SII DTE, Ley 18.290, retención 6 años) → apps/document-service con provider DTE. Ver ADR-007.
5. **Conductor usa web app, no nativa** → una sola `apps/web` multi-rol (shipper, carrier, driver, admin). Apps nativas en backlog. Ver ADR-008.

Las secciones marcadas con **[v2]** reflejan el stack actualizado.

---

## Contexto

Booster AI nace como reescritura greenfield de Booster 2.0. La decisión de reescribir, en vez de refactorizar incrementalmente, se tomó porque:

1. **Deuda técnica acumulada en el 2.0**: 346 ocurrencias de `any`, 395 `console.*`, ~15% de test coverage, Python FMS engine híbrido con Node backend, sin linter configurado, sin logging estructurado, secretos filtrados al repo (incidente SEC-2026-04-01).
2. **Requisito de TRL 10**: el cierre formal con CORFO exige auditoría de seguridad profesional, 80%+ coverage, observabilidad APM completa, accesibilidad WCAG 2.1 AA y plan DR probado. Llegar ahí desde el 2.0 tomaría comparable o más tiempo que reescribir con esas prácticas desde day 0.
3. **Oportunidad de consolidar aprendizajes**: tres ADRs cierre (007, 008, 009, 010) del 2.0 documentan patrones correctos identificados. Empezar de cero permite aplicarlos sin retrabajo.
4. **Cambio de herramienta de desarrollo**: el 2.0 se desarrolló primariamente con Google Antigravity. Booster AI se desarrolla 100% con Claude (Cowork / Claude Code) como agente principal — este ADR fija también el contrato técnico bajo esa metodología.

## Decisión

Adoptar el siguiente stack, inalterable sin nuevo ADR que lo supersede:

### Runtime y monorepo

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| Runtime | **Node.js 22 LTS** | Bun, Deno | Madurez del ecosistema; Cloud Run lo soporta de primera. Bun/Deno introducen riesgo no justificado para TRL 10. |
| Package manager | **pnpm 9** | npm, yarn | Mejor handling de monorepo, menos disk usage, más rápido, symlinks estrictos evitan phantom deps. |
| Monorepo orchestrator | **Turborepo** | Nx, Lerna, Rush | Caching incremental, integración nativa con GitHub Actions, simplicidad de config vs. Nx. |

### Lenguaje y tooling

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| Lenguaje | **TypeScript 5.8** exclusivo | TS + Python | El 2.0 mezcló TS + Python FastAPI. Consolidar en un solo lenguaje reduce surface area, facilita shared code (schemas Zod), elimina complejidad de deployment. |
| Linter + formatter | **Biome 1.9** | ESLint + Prettier | 10-20x más rápido, una sola tool, TypeScript-first, reglas de seguridad incluidas. ESLint sigue siendo más extensible pero Biome cubre el 95% de nuestras necesidades con mucha menor complejidad. |
| Type-check | `tsc --noEmit` con `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | — | Máxima estrictud desde day 0. |

### Backend

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| HTTP framework | **Hono 4** | Express, Fastify, tRPC | TypeScript-first desde diseño, 3-5x más rápido que Express, edge-compatible si migramos. Usado por Cloudflare, Vercel, Netflix. Contratos estándar web (fetch API). |
| ORM | **Drizzle ORM** | Prisma, Kysely, TypeORM | SQL explícito, tipos reales sin codegen, mejor DX para queries complejas, mejor performance (no runtime engine). Trade-off: Prisma más maduro; para greenfield con disciplina, Drizzle gana en DX. |
| DB | **PostgreSQL 16** + `pgvector` | MySQL, CockroachDB | Mismo motor del 2.0, soporta embeddings para semantic search, Cloud SQL lo ofrece managed. |
| Cache / rate limiting | **Redis 7** (Memorystore) | Valkey, KeyDB | Mismo que 2.0, ecosystem maduro, Cloud Memorystore managed. |
| Logger | **Pino** vía `@booster-ai/logger` | Winston, Bunyan | Más liviano y rápido; formato JSON auto-compatible con Cloud Logging; serializers custom para redactar PII. |
| Tracing | **OpenTelemetry** con auto-instrumentation de Hono + exporters a Cloud Trace | — | Estándar CNCF, agnóstico del vendor, correlación con logs via `trace_id`. |
| Validation | **Zod** en `@booster-ai/shared-schemas` | Yup, Joi, Valibot | Inference de tipos TS nativa, ecosistema más maduro, shareable frontend/backend. Valibot es más liviano pero menos maduro. |
| Testing | **Vitest** (unit + integration) + **MSW** (mocks HTTP) | Jest, Mocha | Vitest mucho más rápido, compatible con Vite config, UI dashboard integrada. |

### Frontend **[v2 — PWA multi-rol]**

Ver detalle en **ADR-008**. Resumen:

- **Una sola** `apps/web` con cuatro interfaces por rol (shipper, carrier, driver, admin)
- **PWA robusta**: Service Worker, Web Push, offline cache, Background Sync
- **No apps nativas iniciales** (backlog para fase posterior)

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| Build tool | **Vite 6** + **vite-plugin-pwa** (Workbox) | Next.js, Remix, Astro | SPA con routing client-side + PWA nativo. Next.js/Remix añaden SSR que no necesitamos inicialmente. |
| UI library | **React 18** | Solid, Svelte, Vue | Madurez, ecosistema, reclutamiento. |
| Router | **TanStack Router** | React Router 7, Remix | File-based routing type-safe. Guards por rol. |
| Data fetching | **TanStack Query 5** | SWR, RTK Query | Cache excelente, offline support. |
| Styling | **Tailwind CSS 4** + **shadcn/ui** | CSS Modules, Styled Components | Sistema de diseño con density variants por rol (driver touch-first, admin denso, etc.). |
| Forms | **react-hook-form** + **Zod resolver** | Formik | Performance + integración nativa con shared-schemas. |
| Maps | **@vis.gl/react-google-maps** | Leaflet, Mapbox | Google Maps nativo, integración con Places, Directions, mismo ecosistema GCP. |
| State (global) | **Zustand** | Redux, Jotai | Minimal, type-safe, solo donde React Context no alcanza. |
| Offline storage | **idb** (IndexedDB wrapper) | localStorage, SQLite-wasm | IndexedDB maneja volúmenes grandes, queue de telemetría offline del driver. |
| E2E tests | **Playwright** | Cypress | Multi-browser, mejor DX. |
| A11y tests | **axe-core** integrado en Playwright | — | Cubre WCAG 2.1 AA (TRL 10). |

### AI / Agentes

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| Modelo principal | **Gemini 2.5 Flash** | Claude Sonnet, GPT-4 | Cost-effective (10x más barato que Claude Sonnet para casos normales), suficiente para el caso Booster, billing consolidado en GCP. |
| Abstracción | `@booster-ai/ai-provider` | Direct SDK calls | Permite cambiar proveedor sin tocar lógica de negocio. Útil para A/B testing Gemini vs Claude en tareas específicas (ej. carbon reports). |
| Embeddings | **Vertex AI textembedding** | OpenAI embeddings | Todo dentro de GCP, billing consolidado, compatible con `pgvector`. |

### Auth & Identity

| Pieza | Elección | Alternativa considerada | Razón |
|-------|----------|-------------------------|-------|
| End-user auth | **Firebase Auth** | Supabase Auth, Auth0, Clerk | Integración nativa con Firestore/GCP, probado en 2.0, precio razonable en plan Blaze. |
| Server-to-server | **OAuth 2.0 + ADC** | API keys, JWT | Lección de ADR-009 del 2.0: OAuth para todo lo que lo soporte. |
| CI / GCP | **Workload Identity Federation** | Service Account JSON key | Lección de SEC-2026-04-01: nunca descargar SA keys. |

### Infra **[v2 — ampliada]**

| Pieza | Elección | Razón |
|-------|----------|-------|
| Hosting backend stateless | **Cloud Run** (múltiples servicios) | Serverless scale-to-zero, serves HTTP/gRPC. Apps: `api`, `telemetry-processor`, `matching-engine`, `notification-service`, `whatsapp-bot`, `document-service`. |
| Hosting TCP gateway | **GKE Autopilot** | Cloud Run no sirve TCP persistente. GKE Autopilot = serverless GKE. Ver ADR-005. |
| DB managed | **Cloud SQL PostgreSQL 16** | Transaccional, madurez, precio razonable. |
| Hot real-time sync | **Firestore** | Listeners nativos en apps/web, security rules por rol, offline cache. Ver ADR-005. |
| Cache / rate limiting / matching | **Memorystore Redis** | Managed, elimina ops overhead. |
| Event bus | **Pub/Sub** | Managed, at-least-once, ordering keys, escala millones eventos/s. Topics: `telemetry-events`, `trip-events`, `whatsapp-inbound-events`, `notification-events`, `vehicle-availability-events`. |
| Cold analytics | **BigQuery** | Telemetría histórica, analytics ESG, ML training. Particionado por día. |
| Object storage | **Cloud Storage** con CMEK + Retention Lock | Documentos (DTE, Carta Porte, fotos, firmas) con retención legal 6 años. Ver ADR-007. |
| Document OCR | **Document AI** + fallback Gemini Vision | Parsing estructurado de facturas externas. Ver ADR-007. |
| Secrets | **Secret Manager** | Único repositorio auditado. |
| Push notifications | **Firebase Cloud Messaging (FCM)** + **Web Push** (VAPID) | Multi-canal con fallback. |
| Jobs diferidos | **Cloud Tasks** | Retry con backoff exponencial. |
| Cron | **Cloud Scheduler** | Liquidación diaria, reportes ESG, cleanup retención. |
| IaC | **Terraform 1.9+** | Estándar de facto, IAM humana en IaC (ADR-010 del 2.0). |
| CI/CD | **GitHub Actions** + **Cloud Build** | GitHub Actions para lint/test/build. Cloud Build para imágenes Docker + deploy. WIF sin keys JSON. |
| Monitoring | **Cloud Monitoring** + **Cloud Trace** + **Cloud Logging** | OTel exportado nativo. Métricas custom de negocio. Alertas SLO-based. |

### Nueva lista completa de apps (v2)

| App | Runtime | Propósito |
|-----|---------|-----------|
| `apps/api` | Cloud Run | API REST/GraphQL principal (auth, trips, users, cargo requests) |
| `apps/web` | Cloud Run (static + SSR opcional) | PWA con 4 interfaces por rol |
| `apps/matching-engine` | Cloud Run | Matching carrier-based (consume Pub/Sub) |
| `apps/telemetry-tcp-gateway` | **GKE Autopilot** | TCP server para Teltonika Codec8 |
| `apps/telemetry-processor` | Cloud Run (Pub/Sub push) | Dedup + enrich + write hot/cold |
| `apps/notification-service` | Cloud Run | Fan-out Web Push / FCM / WhatsApp / SMS / Email |
| `apps/whatsapp-bot` | Cloud Run | Webhook Meta, NLU Gemini, inbound orchestration |
| `apps/document-service` | Cloud Run | DTE emission, Carta Porte PDF, OCR, storage |

### Nueva lista completa de packages (v2)

| Package | Propósito |
|---------|-----------|
| `packages/shared-schemas` | Zod schemas compartidos |
| `packages/logger` | Pino wrapper con PII redaction |
| `packages/ai-provider` | Abstracción Gemini / Claude / etc |
| `packages/config` | Env parsing, constantes |
| `packages/trip-state-machine` | XState machines para trip lifecycle (ADR-004) |
| `packages/codec8-parser` | Parser Teltonika Codec8 (ADR-005) |
| `packages/pricing-engine` | Cálculo determinístico de precio (ADR-004) |
| `packages/matching-algorithm` | Scoring multifactor de carriers (ADR-004) |
| `packages/carbon-calculator` | GLEC v3.0 puro (ADR-004) |
| `packages/whatsapp-client` | Cliente tipado Meta Cloud API + NLU prompts (ADR-006) |
| `packages/dte-provider` | Abstracción Bsale/Paperless/etc (ADR-007) |
| `packages/carta-porte-generator` | PDF generator con @react-pdf/renderer (ADR-007) |
| `packages/document-indexer` | Helpers para CRUD documentos (ADR-007) |
| `packages/notification-fan-out` | Orquestador canales (ADR-004) |
| `packages/ui-tokens` | Design tokens (colores, espaciados, tipografía) |
| `packages/ui-components` | Componentes shadcn/ui + específicos Booster |

### Desarrollo con agentes de IA

| Pieza | Elección | Razón |
|-------|----------|-------|
| Agente principal | **Claude** (Cowork / Claude Code) | Decisión del Product Owner. Cambio respecto al 2.0 (Antigravity). |
| Framework de skills | Inspirado en [**addyosmani/agent-skills**](https://github.com/addyosmani/agent-skills) | "Production-grade engineering skills for AI coding agents". Calza con principios de Evidence over Assumption. |
| Contrato agente-humano | [`CLAUDE.md`](../../CLAUDE.md) | Documento raíz del repo. |

## Consecuencias

### Positivas

- **Stack moderno sin bleeding-edge**: cada pieza es madura (usada en producción por empresas grandes) pero moderna (no arrastra decisiones 2020).
- **Disciplina de cero deuda técnica**: Biome + TS estricto + pre-commit hooks + coverage gate hacen imposible commitear código con los anti-patrones del 2.0.
- **Type safety end-to-end**: Drizzle → Zod schemas compartidos → TanStack Query inferido. Un cambio al schema de BD refactorea el frontend automáticamente.
- **Observabilidad nativa**: Pino + OTel desde el primer endpoint, no se "añade después".
- **Auditabilidad para TRL 10**: cada decisión en ADR; cada cambio en Git; cada despliegue con tag/SHA trazable; OAuth audit logs atribuyen acciones.
- **Preparado para Claude como agente principal**: CLAUDE.md + skills/ + .claude/commands/ formalizan la colaboración humano-agente.

### Negativas

- **Curva de aprendizaje**: Hono, Drizzle, Biome, TanStack Router, Tailwind + shadcn son nuevos respecto al 2.0 (Express, Prisma, ESLint, React Router, estilos ad-hoc). El PO ya los aceptó explícitamente.
- **Menor madurez de algunas piezas respecto a alternativas mainstream**: Drizzle < 2 años maduros comparado con Prisma de 5+ años. Hono < 4 años vs Express de 15+. Mitigado por actividad comunitaria alta y uso en producción por grandes.
- **Biome no cubre 100% de ESLint**: algunas reglas específicas de librerías (ej. `react-hooks/exhaustive-deps`) están en Biome pero menos maduras. Si encontramos gaps, podemos añadir ESLint como suplemento.
- **Dependencia de Claude**: si Claude como servicio cambia pricing o disponibilidad, el repo sigue funcionando (el código es agnóstico) pero la velocidad de desarrollo se afecta. Mitigado porque `AGENTS.md` hace el repo compatible con otros agentes.

## Path de evolución futura

Este ADR es punto de partida, no camino fijo. Algunos cambios esperables que NO requerirán reescribir el proyecto:

- **Apps nativas (React Native + Expo)** para driver/carrier cuando PWA no cubra. Reusa packages del monorepo. Ver ADR-008.
- **Bun como runtime** cuando su ecosistema Node-compat madure.
- **Edge deployment** (Cloudflare Workers, Deno Deploy) — Hono lo soporta nativo.
- **Replicar a múltiples regiones GCP** cuando haya tráfico internacional.
- **Migrar Gemini a Vertex AI Agent Builder** si la orquestación se complejiza.
- **MQTT broker (EMQX)** para telemetría cuando escalemos >5K dispositivos Teltonika (ver ADR-005).
- **Multi-tenant isolation** cuando tengamos shippers enterprise con requisitos de aislamiento de datos.

Cada cambio de los anteriores será su propio ADR.

## Validación

Este ADR se considera correctamente implementado cuando:

- [ ] `pnpm install` funciona sin warnings en un ambiente limpio
- [ ] `pnpm ci` pasa (lint + typecheck + test + build) en GitHub Actions
- [ ] Biome reporta 0 errores en el código base generado por el skeleton
- [ ] `tsc --noEmit` pasa con 0 errores bajo `strict: true`
- [ ] Thin slice end-to-end (auth + CRUD básico) funciona en dev local y Cloud Run staging
- [ ] Coverage gate 80% está activo y bloqueante en CI
- [ ] Pino emite logs estructurados en Cloud Logging con `trace_id` propagado desde OTel

## Referencias

- [CLAUDE.md](../../CLAUDE.md) — contrato agente
- [AGENTS.md](../../AGENTS.md) — subconjunto cross-tool
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — framework de skills
- [Hono](https://hono.dev) · [Drizzle](https://orm.drizzle.team) · [Biome](https://biomejs.dev) · [Turborepo](https://turbo.build)
- Lecciones del Booster 2.0: `../../../Booster-2.0/.agent/knowledge/ADR-009-maps-auth.md`, `../../../Booster-2.0/.agent/knowledge/ADR-010-identity-model.md`, `../../../Booster-2.0/.agent/knowledge/SECURITY_INCIDENT_2026-04.md`
