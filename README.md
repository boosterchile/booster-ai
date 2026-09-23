# Booster AI

Marketplace B2B de carga en Chile. Conecta generadores de carga con transportistas, aprovecha retornos vacíos y certifica huella bajo GLEC v3.0, GHG Protocol e ISO 14064-2. La superficie que el código cierra hoy es la PWA en `app.boosterchile.com`.

**Estado**: en producción sobre GCP (Cloud Run + GKE de telemetría). Reescritura de Booster 2.0 iniciada el 2026-04-23. Qué se construye ahora: [`docs/frentes-vivos.md`](./docs/frentes-vivos.md). Estado breve: [`docs/handoff/CURRENT.md`](./docs/handoff/CURRENT.md).

## Roles

Una sola PWA, cinco roles. En código y en base de datos los nombres vigentes son `GeneradorCarga` y `Transportista` (`shipper` / `carrier` quedaron en desuso).

- **GeneradorCarga** — publica carga, sigue el viaje y ve la huella.
- **Transportista** — recibe ofertas, asigna conductor y supervisa la flota.
- **Conductor** — ejecuta el viaje desde la PWA: recogida, posición y entrega.
- **Admin** — operación de la plataforma.
- **Stakeholder** — lee huella con consentimiento y rastro de auditoría.

## Qué hace el sistema hoy

- **Huella.** `@booster-ai/carbon-calculator` calcula GLEC sin I/O. El equipo en uso es el Teltonika **FMC150** (Codec 8 / 8E, TCP, cluster GKE). Sus capacidades máximas —GNSS, hasta 4 Dallas, CAN LVCAN y eventos— están declaradas en `extraerCapacidadesMaximas` (`packages/shared-schemas`). Otro equipo entra con su detalle: el techo es lo que ese detalle declara y lo que el catálogo ya sabe leer. Sin equipo, la fuente es el GPS del móvil del conductor. El nivel de certificación depende de la fuente ([ADR-077](./docs/adr/077-nivel-certificacion-por-fuente-de-posicion.md)).
- **Eco-routing.** Es una característica esencial del producto. Hoy la ruta sugerida se calcula al aceptar la oferta, se guarda en la asignación y se muestra en el mapa (`GET /assignments/:id/eco-route`). La capa en tiempo real del [ADR-012](./docs/adr/012-urban-observatory-digital-twins.md) profundiza esa misma característica.
- **Viaje.** El ciclo vive en `@booster-ai/trip-state-machine`. El API lo aplica.
- **Matching.** El algoritmo puro está en `@booster-ai/matching-algorithm` y lo ejecuta `apps/api` (`src/services/matching.ts`). `apps/matching-engine` es un proceso reservado: arranca y no matchea.
- **Documentos.** Booster no emite DTE ([ADR-069](./docs/adr/069-booster-deja-de-emitir-dte-remocion-sovos.md)). `apps/document-service` archiva y decodifica el TED de documentos de terceros. No hay package `dte-provider`.
- **Avisos.** Web Push, WhatsApp (Twilio) y el resto salen desde `apps/api`, con formato en `@booster-ai/notification-fan-out`. `apps/notification-service` es un proceso reservado: arranca y no envía.

WhatsApp existe como canal de aviso y como `apps/whatsapp-bot`. No es la superficie que los tres frentes vivos están cerrando.

## Presencia

- `app.boosterchile.com` — PWA del producto.
- Este repo no contiene `apps/marketing`. El sitio comercial de [ADR-010](./docs/adr/010-marketing-site-and-commerce.md) no está en este árbol.

Los ADR van del 001 al 080 en [`docs/adr/`](./docs/adr/). Una etiqueta vieja (`Accepted`, `Proposed`) no certifica vigencia: manda el ADR posterior que la supersede ([ADR-076](./docs/adr/076-gobernanza-operador-unico.md)).

## Quick start

- Node.js 24 (`.nvmrc`).
- pnpm 10. La versión fijada es `pnpm@10.34.4` (`packageManager`; [ADR-075](./docs/adr/075-migracion-pnpm-10.md)).
- Docker, para Postgres y Redis locales.
- `gcloud`, solo si se usan integraciones GCP en local.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter @booster-ai/api db:migrate
pnpm dev
```

## Estructura

```
apps/
├── api/                      # Hono + Drizzle. Aquí corre el producto.
├── web/                      # PWA multi-rol
├── telemetry-tcp-gateway/    # TCP Codec 8 (GKE)
├── telemetry-processor/      # Dedup y enriquecimiento
├── document-service/         # Archivo de documentos de terceros. No emite DTE.
├── whatsapp-bot/             # Webhook de WhatsApp
├── sms-fallback-gateway/     # SMS de respaldo
├── matching-engine/          # Proceso reservado. El matching está en apps/api.
└── notification-service/     # Proceso reservado. Los avisos salen de apps/api.

packages/
├── shared-schemas/           # Zod, incluido el dominio
├── carbon-calculator/        # GLEC v3.0 puro
├── matching-algorithm/       # Scoring
├── pricing-engine/           # Precio determinístico
├── factoring-engine/         # Anticipo
├── trip-state-machine/       # Ciclo del viaje
├── codec8-parser/            # Teltonika Codec 8
├── certificate-generator/    # Certificado de huella
├── carta-porte-generator/    # Carta de porte
├── transport-documents/      # TED y documentos de transporte
├── document-indexer/
├── notification-fan-out/
├── whatsapp-client/
├── coaching-generator/
├── driver-scoring/
├── logger/                   # Pino
├── otel-bootstrap/
├── config/
├── ui-tokens/
└── ui-components/

infrastructure/               # Terraform (GCP)
docs/adr/                     # ADR 001..080
```

No existen `packages/dte-provider` ni `packages/ai-provider`.

## Agentes

El contrato está en [`CLAUDE.md`](./CLAUDE.md). El índice de stack y comandos está en [`AGENTS.md`](./AGENTS.md). El repo no activa plugins ni hooks de Claude Code ([ADR-078](./docs/adr/078-retiro-config-plugins-hooks-claude-code.md)). La disciplina es el contrato, el pre-commit y CI ([ADR-072](./docs/adr/072-disciplina-inline-plugins-como-conocimiento-opcional.md)).

## Comandos

```bash
pnpm dev          # todas las apps
pnpm lint         # Biome
pnpm format
pnpm typecheck
pnpm test
pnpm test:e2e     # Playwright
pnpm build
pnpm ci           # lint + typecheck + test + build
```

## Calidad

- Coverage mínimo 80 % en código nuevo. CI lo bloquea.
- Biome, con `noExplicitAny` en error.
- TypeScript strict.
- Secretos: gitleaks en pre-commit y en CI; CodeQL, Trivy y npm audit en CI.
- Accesibilidad: axe-core en Playwright.
- Deploy a producción: manual, `workflow_dispatch` de `release.yml`. Un merge a `main` no despliega.

## Licencia

Monorepo privado. No hay licencia de distribución.
