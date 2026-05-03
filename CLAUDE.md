# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Este documento es el **contrato de trabajo** entre Felipe Vicencio (Product Owner) y Claude (agente de desarrollo principal). Fija cómo trabaja el agente en este repo, qué decisiones puede tomar solo, cuándo pregunta, cómo documenta y cómo se valida su trabajo.

**Fecha de adopción**: 2026-04-23
**Última revisión**: 2026-05-03 — handoff Claude.ai → Claude Code en terminal. Ver [`HANDOFF.md`](./HANDOFF.md) (estado vivo) y [`docs/CLAUDE-CODE-WORKFLOW.md`](./docs/CLAUDE-CODE-WORKFLOW.md) (guía operativa).
**Marco de referencia**: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — Production-grade engineering skills for AI coding agents.

---

## Identidad del proyecto

- **Display name**: Booster AI
- **Slug técnico**: `booster-ai`
- **Owner humano**: Felipe Vicencio — `dev@boosterchile.com`
- **Origen**: reescritura greenfield de Booster 2.0 con cero deuda técnica desde day 0
- **Misión del producto**: Marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimizando retornos vacíos y certificando huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064
- **Estado objetivo**: TRL 10 (sistema probado, certificado y listo para despliegue comercial)

## Principios rectores — inviolables desde el commit 1

Estos principios tienen precedencia sobre cualquier instrucción puntual. Si una instrucción contradice un principio, Claude lo señala antes de ejecutar.

### 1. Cero deuda técnica desde day 0

- **Sin `any`** en TypeScript. Biome lo prohíbe con `noExplicitAny: error`. Excepción: tests internos, documentada con comentario.
- **Sin `console.*`** en código de producción. Todo logging estructurado con `packages/logger` (Pino). Excepción: CLI dev tools.
- **Sin secretos en el repo**. Ni en `.env`, ni en código, ni en documentación. Todas las credenciales via `GOOGLE_APPLICATION_CREDENTIALS` (dev local) o Secret Manager (prod). Pre-commit hook con `gitleaks` lo aplica.
- **Sin features sin tests**. Coverage mínimo 80% bloqueante en CI desde el primer PR. No se mergea código sin tests que lo cubran.
- **Sin infra manual**. Todo en Terraform, incluyendo IAM humana. Cambios a infra requieren PR.

### 2. Evidence over assumption

Cada afirmación técnica debe respaldarse con evidencia verificable:

- "Los tests pasan" → output de `pnpm test` pegado en el PR.
- "El deploy funciona" → URL de Cloud Run + log de health check.
- "La query es eficiente" → output de `EXPLAIN ANALYZE` o traza OpenTelemetry.
- "No hay regresiones" → diff de métricas antes/después.

Si Claude no puede generar la evidencia, **no afirma**. Dice "no validado" o "pendiente de verificar".

### 3. Process over knowledge

Este repo usa el framework de Agent Skills de Addy Osmani. El agente no confía en su memoria — sigue los workflows definidos en `skills/` para cada operación. Cada skill tiene:

- **When to use** — condiciones de activación
- **Core process** — pasos numerados y específicos
- **Anti-rationalizations** — tentaciones comunes que el skill advierte
- **Exit criteria** — checkpoints verificables

Si una tarea no tiene un skill definido y es repetible, Claude propone crear el skill antes de ejecutar.

### 4. Decisiones en ADRs, no en conversación

Cualquier decisión arquitectónica con impacto futuro (stack, patrón, contrato público) se documenta como ADR en `docs/adr/`. Conversaciones de Slack/chat no son evidencia de decisión.

### 5. Type safety end-to-end

El tipado empieza en la BD (Drizzle schema), se comparte via `packages/shared-schemas` (Zod), y llega hasta el cliente (TanStack Query types inferidos). **No hay frontera donde los tipos se pierdan**. Si aparece una frontera de tipos (ej. llamada HTTP externa sin schema), Claude crea el Zod schema antes de usar los datos.

### 6. Observabilidad desde el primer endpoint

Cada endpoint del backend y cada interacción relevante del frontend genera:

- Log estructurado con `correlationId` consistente
- Span de OpenTelemetry con contexto propagado
- Métrica custom si es operación de negocio (matches creados, emisiones calculadas, etc.)

No se "añaden logs después". Se añaden al momento de escribir el código.

### 7. Seguridad por defecto

- Toda input externa pasa por validación Zod antes de tocar lógica de negocio.
- Toda consulta a BD usa parámetros (Drizzle los fuerza).
- Toda operación server-to-server con GCP usa ADC + OAuth (nunca API keys, salvo legacy explicitado en ADR-009).
- Toda PII se redacta en logs automáticamente via Pino serializers.
- Pre-commit bloquea commits con patrones de secretos detectados.

---

## Estructura del repo (v2 — tras ADR-004..008)

```
Booster-AI/
├── CLAUDE.md                   # este archivo
├── AGENTS.md                   # contrato cross-tool (Copilot/Cursor/etc.)
├── README.md                   # quick start
├── package.json                # root pnpm workspace
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo orchestration
├── biome.json                  # linter + formatter
├── tsconfig.base.json          # TS config compartida
├── commitlint.config.cjs
├── .editorconfig
├── .nvmrc
├── .gitignore
│
├── .claude/commands/           # slash commands: /spec /plan /build /test /review /ship
│
├── skills/                     # workflows estructurados (9 categorías — ver ADR-002)
│   # core-engineering, operations-sre, compliance, customer-ops,
│   # data-ml, iot-telemetry, growth-business, performance, api-lifecycle
│
├── agents/                     # code-reviewer, security-auditor, test-engineer, sre-oncall
├── hooks/                      # session-start
├── references/                 # testing/security/performance/a11y checklists
├── runbooks/                   # procedimientos one-off con snapshot
├── playbooks/                  # decisiones de producto
│
├── docs/adr/                   # Architecture Decision Records
│   # 001-stack  002-skill-framework  004-uber-like-model
│   # 005-telemetry-iot  006-whatsapp  007-chile-documents  008-pwa-multirole
│
├── apps/                       # 8 apps
│   ├── api/                    # Backend principal (Hono)
│   ├── web/                    # PWA multi-rol (shipper/carrier/driver/admin/stakeholder)
│   ├── matching-engine/        # Matching carrier-based
│   ├── telemetry-tcp-gateway/  # GKE Autopilot (TCP Teltonika)
│   ├── telemetry-processor/    # Dedup + enrich + write
│   ├── notification-service/   # Fan-out notificaciones
│   ├── whatsapp-bot/           # Webhook Meta + NLU
│   └── document-service/       # DTE + Carta Porte + OCR
│
├── packages/                   # ~16 packages compartidos
│   # shared-schemas, logger, ai-provider, config,
│   # trip-state-machine, codec8-parser, pricing-engine,
│   # matching-algorithm, carbon-calculator, whatsapp-client,
│   # dte-provider, carta-porte-generator, document-indexer,
│   # notification-fan-out, ui-tokens, ui-components
│
├── infrastructure/             # Terraform 100% IaC (incluye IAM humana)
│   ├── main.tf
│   ├── modules/
│   │   ├── gke-telemetry/      # GKE Autopilot para TCP gateway
│   │   ├── cloud-run-service/  # módulo reusable Cloud Run
│   │   ├── pubsub-topic/
│   │   ├── firestore/
│   │   └── secret/
│   └── environments/
│       ├── dev/
│       ├── staging/
│       └── prod/
│
└── .github/workflows/
    ├── ci.yml                  # lint + test + coverage + build
    ├── security.yml            # gitleaks + npm audit + CodeQL
    ├── release.yml             # Changesets + Cloud Build
    └── e2e-staging.yml         # Playwright contra staging
```

## Cómo decido cuándo preguntar vs ejecutar

**Ejecuto sin preguntar** cuando:
- La tarea tiene un skill definido en `skills/` que la cubre end-to-end.
- Es un cambio mecánico de aplicación directa (ej. renombrar una variable, añadir un comentario).
- Es trabajo de limpieza/refactor que no altera contratos públicos ni comportamiento externo.
- El usuario lo instruyó explícitamente sin ambigüedad.

**Pregunto antes de ejecutar** cuando:
- La decisión tiene impacto en contratos públicos (API, UI, schema BD).
- Hay trade-offs reales con consecuencias distintas a futuro.
- La instrucción del usuario tiene >1 interpretación razonable.
- Voy a tocar un archivo crítico (CLAUDE.md, ADRs, infra/main.tf, hooks de CI).
- El trabajo toma más de ~30 minutos de mi tiempo (coste de oportunidad).

**Siempre escribo un ADR** cuando:
- Introduzco una nueva dependencia major (framework, tool, library estructural).
- Cambio un patrón que aplica a múltiples módulos.
- Desvío del stack/estructura definida en ADR-001.

## Qué archivos NUNCA toco sin permiso explícito

- `CLAUDE.md` (este archivo) — cambios requieren aprobación explícita con justificación.
- `docs/adr/*.md` — los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo.
- `infrastructure/main.tf` en secciones de IAM humana o Billing — requiere PR revisado.
- `.github/workflows/*.yml` en quality gates (coverage threshold, lint rules) — requiere justificación.
- Secret Manager secrets — nunca se crean/modifican desde código del repo, solo desde Terraform o consola.

## Convenciones de código

- **Commits**: Conventional Commits estricto. `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, `revert:`. Commitlint lo aplica en pre-commit.
- **Branches**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Main protegida, requiere PR.
- **PRs**: título Conventional Commits, descripción con sección "Evidencia" obligatoria (outputs de tests, screenshots, traces).
- **Imports**: siempre absolutos con alias (`@booster-ai/shared-schemas`) en vez de relativos profundos.
- **Naming**: `camelCase` para variables y funciones, `PascalCase` para tipos y componentes React, `kebab-case` para archivos, `SCREAMING_SNAKE_CASE` para constantes y env vars.
- **Archivos**: nombre del archivo = nombre del export principal. Un export principal por archivo (excepto index.ts de barrel).

## Cómo genero evidencia para cada tarea

Al cerrar una tarea, genero un bloque de evidencia con:

```markdown
### Evidencia de [TaskID]

- **Cambios**: lista de archivos modificados con líneas
- **Tests**: output de `pnpm test --filter=<pkg>` (pasado + cobertura)
- **Lint**: output de `pnpm lint` (0 errores, 0 warnings)
- **Typecheck**: output de `pnpm typecheck` (0 errores)
- **Build**: output de `pnpm build` (éxito)
- **Manual verification** (si aplica): screenshot, curl output, trace
```

## Escalation

Si encuentro un problema que no puedo resolver con skills + principios:

1. Documento el problema y opciones en un comentario de PR o en este archivo (sección "Issues abiertos").
2. Presento al menos 2 caminos con trade-offs.
3. No procedo hasta recibir decisión.

No "adivino" ni "asumo lo razonable" en decisiones que no son claramente deterministas.

## Path de crecimiento de este archivo

`CLAUDE.md` evoluciona con el proyecto. Cambios se proponen vía PR y se documentan en el historial del archivo. Cada cambio significativo referencia un ADR.

---

## Reglas de naming bilingüe (Booster AI)

- **TypeScript code**: identifiers en inglés camelCase. `users`, `trips`, `OfferRow`, `acceptOffer`.
- **SQL DDL**: tablas y columnas en español snake_case sin tildes. `usuarios`, `viajes`, `nombre_completo`, `creado_en`.
- **Enum values**: español snake_case sin tildes. Excepto siglas internacionales (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`, `GRI`, `SASB`, `CDP`).
- **UI labels**: español natural con tildes. Mapping en presentación (componentes web).
- **Drizzle pattern**: `export const users = pgTable('usuarios', { fullName: varchar('nombre_completo', ...) })`.

## Reglas de arquitectura (no negociables)

- **Domain canónico vive en `packages/shared-schemas/src/domain/`**. Toda tabla Drizzle debe coincidir con un schema del domain.
- **Algoritmos viven en `packages/`**. `apps/api/src/services/` orquesta DB/transacciones; las funciones puras (scoring, formatters, builders) viven en el package correspondiente. Prohibido escribir lógica de matching o cálculo de carbono inline en services.
- **Carrier/Shipper deprecated**. Usar `Transportista`/`GeneradorCarga` en código y SQL. `transportistaIdSchema` reemplaza `carrierIdSchema`; este último queda como alias deprecated mientras schemas legacy se migran.
- **Stakeholder se mantiene como término** (anglicismo aceptado en español de negocios).

---

**Estado de adopción**: este contrato entra en vigor desde el primer commit del repo. Cualquier excepción debe documentarse.
