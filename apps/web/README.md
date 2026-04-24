# @booster-ai/web

PWA multi-rol (shipper, carrier, driver, admin, sustainability_stakeholder). Ver [ADR-008](../../docs/adr/008-pwa-multirole.md).

## Dev local

```bash
cp .env.example .env.local
pnpm --filter @booster-ai/web dev
```

Abrir http://localhost:5173

## Build

```bash
pnpm --filter @booster-ai/web build
```

## Tests

```bash
pnpm --filter @booster-ai/web test      # unit (Vitest)
pnpm --filter @booster-ai/web test:e2e  # Playwright + axe-core a11y
```

## Estructura (plan Fase 6)

```
src/
├── main.tsx              # entry point
├── App.tsx               # router + providers
├── auth/                 # Firebase Auth + RoleGuard
├── shared/               # UI compartida entre roles
├── roles/
│   ├── shipper/
│   ├── carrier/
│   ├── driver/
│   ├── admin/
│   └── stakeholder/
└── pwa/                  # Service Worker + Web Push + Background Sync
```
