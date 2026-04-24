# @booster-ai/api

Backend principal de Booster AI: API REST con Hono + Drizzle + PostgreSQL. Cubre autenticación, órdenes de carga, trips, ratings, pagos.

## Dev local

```bash
cp .env.example .env
# editar .env con valores locales
pnpm --filter @booster-ai/api dev
```

Health check: `curl http://localhost:8080/health`

## Build

```bash
pnpm --filter @booster-ai/api build
```

## Tests

```bash
pnpm --filter @booster-ai/api test
```

## Estructura

```
src/
├── main.ts              # entry point, bootstrap
├── server.ts            # Hono instance
├── config.ts            # env parsing con Zod
├── routes/              # endpoints HTTP
│   └── health.ts        # /health + /ready
├── middleware/          # middlewares Hono
└── services/            # lógica de negocio (TODO)
```

Sigue el skill `skills/adding-cloud-run-service/SKILL.md`.
