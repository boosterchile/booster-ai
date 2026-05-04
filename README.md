# Booster AI

> **Plataforma tipo Uber para transporte de carga sostenible en Chile**. Conecta generadores de carga con transportistas, optimiza retornos vacíos, y certifica huella de carbono bajo estándares internacionales (GLEC v3.0, GHG Protocol, ISO 14064-2). Opera sobre WhatsApp como canal primario y cumple gestión documental obligatoria SII.

**Project status** (2026-05-04, día 11 post kick-off): API + PWA shipper/transportista en producción staging; telemetría Codec8 end-to-end operativa (Teltonika TCP gateway en GKE Autopilot + processor); certificados de huella firmados con KMS; chat realtime shipper↔transportista (REST + Pub/Sub SSE + Web Push + WhatsApp fallback); 6/17 packages implementados; compliance SII (DTE/Carta de Porte) y driver app pendientes. Ver [`AUDIT.md`](./AUDIT.md) para snapshot detallado.
**Successor of**: Booster 2.0 (proyecto archivado). Ver [`docs/adr/001-stack-selection.md`](./docs/adr/001-stack-selection.md) para contexto de la reescritura.

## Arquitectura de alto nivel

**Cinco roles, cinco interfaces, una sola PWA**:

- **Shipper** — publica carga, rastrea, paga, califica
- **Carrier** — recibe ofertas, acepta, asigna driver, supervisa flota, factura
- **Driver** — ejecuta viaje, captura documentos, reporta incidencias
- **Admin** — staff Booster (configuración, disputas, auditoría)
- **Sustainability Stakeholder** — mandante corporativo, stakeholder ESG, auditor, regulador o inversor que consume datos de huella de carbono (read-only, con consent explícito y audit trail)

**Canales de interacción**:
- Web PWA multi-rol (apps/web)
- WhatsApp Business Cloud API (apps/whatsapp-bot) — canal primario para el segmento micro/pequeño/mediano
- Email, FCM push, Web Push, SMS fallback

**Telemetría**:
- Dispositivos Teltonika FMS150 con protocolo Codec8 (TCP) — fuente primaria 24/7
- PWA del driver como fuente complementaria durante trip activo

**Gestión documental obligatoria Chile**:
- DTE Guía de Despacho (SII) vía provider acreditado
- Factura electrónica
- Carta de Porte Ley 18.290
- Acta de entrega con firma digital
- Retención legal 6 años en Cloud Storage con Object Retention Lock

**Diferenciadores defensibles vs competencia** (ver [ADR-009](./docs/adr/009-competitive-analysis-and-differentiators.md)):
- Medición certificada de carbono (GLEC v3.0) con datos reales Teltonika CAN bus
- WhatsApp como canal primario (cultura sector chileno)
- Gestión documental SII integrada
- Eco-routing en tiempo real + observatorio urbano + gemelos digitales ([ADR-012](./docs/adr/012-urban-observatory-digital-twins.md))
- Sustainability Stakeholder como rol con consent-based scope

**Canales de presencia**:
- `www.boosterchile.com` — landing comercial + pricing + signup + e-commerce ([ADR-010](./docs/adr/010-marketing-site-and-commerce.md))
- `app.boosterchile.com` — PWA del producto (5 roles)
- WhatsApp Business — canal conversacional primario

Ver ADRs completos en [`docs/adr/`](./docs/adr/).

---

## Quick start

### Prerequisites

- Node.js 22 LTS (`.nvmrc` pin). Usa `nvm use` si tienes nvm.
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop (para Postgres + Redis locales)
- `gcloud` CLI (opcional para ambientes GCP)

### Setup local

```bash
# 1. Instalar dependencias
pnpm install

# 2. Arrancar servicios locales (Postgres + Redis)
docker compose -f docker-compose.dev.yml up -d

# 3. Variables de entorno
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Editar según instrucciones en cada archivo .env.example

# 4. Credenciales GCP (solo si usas integraciones GCP local)
# Seguir .env.example para GOOGLE_APPLICATION_CREDENTIALS

# 5. Migraciones de BD
pnpm --filter @booster-ai/api db:migrate

# 6. Arrancar dev server (todas las apps en paralelo)
pnpm dev
```

## Estructura (v2 — ampliada tras ADR-004..008)

```
apps/
├── api/                     # Backend principal (Hono + Drizzle + Postgres)
├── web/                     # PWA multi-rol (shipper/carrier/driver/admin)
├── matching-engine/         # Matching carrier-based (Pub/Sub consumer)
├── telemetry-tcp-gateway/   # TCP server Teltonika Codec8 (GKE Autopilot)
├── telemetry-processor/     # Dedup + enrich (Pub/Sub consumer)
├── notification-service/    # Fan-out Web Push/FCM/WhatsApp/Email/SMS
├── whatsapp-bot/            # Webhook Meta + NLU Gemini
└── document-service/        # DTE + Carta Porte + OCR + retention

packages/
├── shared-schemas/          # Zod compartido
├── logger/                  # Pino wrapper
├── ai-provider/             # Abstracción Gemini/Claude
├── config/                  # Env + constants
├── trip-state-machine/      # XState machines
├── codec8-parser/           # Parser Teltonika
├── pricing-engine/          # Cálculo determinístico de precios
├── matching-algorithm/      # Scoring multifactor
├── carbon-calculator/       # GLEC v3.0 puro
├── whatsapp-client/         # Meta Cloud API tipado + NLU prompts
├── dte-provider/            # Abstracción Bsale/Paperless
├── carta-porte-generator/   # PDF generator
├── document-indexer/        # CRUD docs
├── notification-fan-out/    # Orquestador canales
├── ui-tokens/               # Design tokens
└── ui-components/           # shadcn/ui + componentes Booster

infrastructure/              # Terraform (GCP)
skills/                      # Workflows para agentes de IA
agents/                      # Personas reutilizables
.claude/                     # Slash commands para Claude
docs/adr/                    # Architecture Decision Records (001..008)
```

## Desarrollo con agentes de IA

Este repo está diseñado para ser trabajado con Claude como agente principal:

- [`CLAUDE.md`](./CLAUDE.md) — contrato de trabajo detallado
- [`AGENTS.md`](./AGENTS.md) — subconjunto cross-tool (Copilot, Cursor, etc.)
- [`skills/`](./skills/) — workflows estructurados siguiendo el framework de [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)

## Comandos canónicos

```bash
pnpm dev          # dev server
pnpm lint         # Biome check
pnpm format       # Biome format
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest unit + integration
pnpm test:e2e     # Playwright
pnpm build        # build de producción
pnpm ci           # pipeline completo (lint + typecheck + test + build)
```

## Calidad

- **Coverage mínimo**: 80% (bloqueante en CI)
- **Linter**: Biome con reglas estrictas
- **Type safety**: strict mode + `noExplicitAny: error`
- **Security**: gitleaks pre-commit + CodeQL + npm audit CI
- **A11y**: axe-core integrado en Playwright

## Licencia

TBD
