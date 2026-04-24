# Skill: Adding a Cloud Run Service

**Categoría**: core-engineering
**Relacionado**: ADR-001 stack, ADR-005 telemetría, `skills/writing-tests`, `skills/incident-response`

## Overview

Booster AI tiene ~8 servicios Cloud Run (api, matching-engine, telemetry-processor, notification-service, whatsapp-bot, document-service, web). Añadir uno nuevo requiere seguir un proceso que garantiza observabilidad, seguridad y ops-readiness desde day 0.

## When to Use

- Nuevo bounded context que justifica su propio servicio (ver criterios en Techniques)
- Extracción de un bounded context existente desde `apps/api`
- Nuevo consumer de Pub/Sub que necesita runtime dedicado

**NO crear servicio nuevo** cuando:
- Es un endpoint más en un servicio existente
- Es lógica que cabe como package compartido
- Es un script one-off (usar Cloud Run Jobs o Cloud Function)

## Core Process

### 1. Justificar con ADR corto o sección en ADR existente

En 1-2 párrafos: por qué este bounded context justifica servicio dedicado. Criterios válidos:
- Throughput muy distinto al resto (ej. TCP gateway con 1000 conexiones persistentes)
- Lifecycle de deploy independiente (ej. updates críticos del whatsapp-bot sin redeploy de api)
- Perfil de escalado muy distinto (ej. matching-engine picos cortos vs api sostenido)
- Perfil de seguridad distinto (ej. document-service con acceso a KMS + retention locks)

Registrar en ADR-001 Amendment o ADR nuevo.

### 2. Crear estructura del servicio

```
apps/<service-name>/
├── package.json              # deps mínimas, extends root
├── tsconfig.json             # extends tsconfig.base.json
├── Dockerfile                # multi-stage build
├── src/
│   ├── main.ts               # entry point, bootstrap
│   ├── server.ts             # Hono instance (o equivalente)
│   ├── config.ts             # env parsing con Zod
│   ├── routes/               # endpoints
│   ├── services/             # lógica de negocio
│   ├── middleware/
│   │   ├── logging.ts        # Pino request logger
│   │   ├── tracing.ts        # OpenTelemetry
│   │   └── auth.ts           # Firebase Admin verify
│   └── health.ts             # /health + /ready endpoints
├── test/
│   ├── unit/
│   └── integration/
└── README.md                 # qué hace, cómo ejecutar local
```

### 3. Dependencias estándar (sin negociar)

Desde day 0, el servicio debe importar:
- `@booster-ai/logger` — logging estructurado Pino
- `@booster-ai/shared-schemas` — Zod schemas
- `@booster-ai/config` — env parsing
- OpenTelemetry SDK + auto-instrumentation del framework (Hono)

### 4. Endpoints obligatorios

- `GET /health` — liveness probe, retorna 200 si el proceso está vivo
- `GET /ready` — readiness probe, retorna 200 si puede aceptar tráfico (BD conectada, Redis conectado, etc.)
- `GET /metrics` — (si se usa Prometheus format) — endpoint para scraping

### 5. Variables de entorno con Zod

```typescript
// src/config.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  // ... específicas del servicio
});

export const config = envSchema.parse(process.env);
```

Parse al arranque. Si falla, el servicio muere con error claro (no arranca con config inválida).

### 6. Dockerfile estándar

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/<service>/package.json ./apps/<service>/
COPY packages/ ./packages/
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @booster-ai/<service> build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/apps/<service>/dist ./dist
COPY --from=builder /app/apps/<service>/package.json ./
COPY --from=builder /app/node_modules ./node_modules
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/main.js"]
```

### 7. Terraform module

Añadir en `infrastructure/environments/<env>/main.tf`:

```hcl
module "<service_name>" {
  source = "../../modules/cloud-run-service"

  project_id       = var.project_id
  region           = var.region
  service_name     = "<service-name>"
  service_account  = google_service_account.cloud_run_sa.email
  container_image  = "${var.artifact_registry}/<service-name>:${var.image_tag}"
  min_instances    = 0  # o 1 si requiere warm
  max_instances    = 10
  concurrency      = 80
  cpu              = "1"
  memory           = "512Mi"

  secrets = {
    DATABASE_URL = google_secret_manager_secret.db_url.id
    # ...
  }

  env_vars = {
    LOG_LEVEL = "info"
  }
}
```

### 8. Tests mínimos

- `test/unit/*.test.ts` — cobertura de lógica pura (≥80%)
- `test/integration/health.test.ts` — que `/health` y `/ready` respondan correctamente
- `test/integration/<endpoint>.test.ts` — al menos 1 test por endpoint público
- **Todos** los tests determinísticos — sin `setTimeout`, sin dependencia de red externa (mocks con MSW)

### 9. CI actualizado

Añadir al job `ci.yml` el filter del nuevo service en el matrix:

```yaml
services: [api, web, matching-engine, telemetry-processor, <new-service>]
```

### 10. Observability config

- Log structured con `service=<service-name>` default field
- OTel tracer con service name correcto para que aparezca en Cloud Trace bajo etiqueta clara
- Custom metrics si hay operaciones de negocio (ej. `trips_matched_total`, `documents_emitted_total`)

### 11. Runbook stub

Crear `docs/runbooks/<service-name>-operations.md` con secciones placeholder:
- Health check manual
- Cómo ver logs en Cloud Logging
- Cómo deployar manualmente (rollback)
- SLOs de este servicio
- On-call escalation path

Este runbook se completa a medida que el servicio madure.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "No añado /ready porque la app es simple" | Cloud Run necesita distinguir liveness de readiness para updates zero-downtime. |
| "Skippeo OTel, lo agrego después" | Nunca se agrega después. Observability desde day 0. |
| "Env vars con `process.env.FOO` directo, sin Zod" | Env inválida crasheando a medio request es peor que al arranque. |
| "Sin runbook, es obvio cómo operarlo" | En un incidente a las 3am, nada es obvio. |

## Red Flags

- Un servicio nuevo sin entradas en Cloud Monitoring (dashboards, alertas)
- Un servicio nuevo sin referencia en `docs/runbooks/`
- Env parsing que no usa Zod
- Dockerfile sin `USER` no-root
- Min instances > 0 sin justificación (costo desperdiciado)

## Exit Criteria

- [ ] ADR (o amendment) justifica la existencia del servicio
- [ ] Estructura de carpetas según convención
- [ ] Dependencias obligatorias (`logger`, `shared-schemas`, `config`, OTel) presentes
- [ ] Endpoints `/health` y `/ready` implementados y testeados
- [ ] Env parsing con Zod, crash al arranque si inválido
- [ ] Dockerfile multi-stage con usuario no-root
- [ ] Terraform module agregado y `terraform plan` limpio
- [ ] Tests unitarios + integración con coverage ≥80%
- [ ] CI matrix incluye el nuevo servicio
- [ ] Pino logs con `service` field + OTel tracer configurado
- [ ] Runbook stub en `docs/runbooks/`
- [ ] README del servicio explica qué hace y cómo correrlo local
- [ ] Deploy a staging exitoso, health check verde

## Referencias

- [ADR-001 stack](../../docs/adr/001-stack-selection.md)
- [ADR-005 telemetría](../../docs/adr/005-telemetry-iot.md)
- Cloud Run best practices: https://cloud.google.com/run/docs/tips/general
