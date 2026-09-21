# Verificación — Activar opt-in de medición de huella

Corrido sobre la rama `cursor/activar-opt-in-huella-cbf8` (Node 24.21.0, pnpm 10.34.4).

## 1. TDD — rojo exhibido (dominio carbono / boundary de activación)

El cómputo post-entrega ya respetaba `empresas.carbon_measurement_enabled`. El rojo de este frente es el **boundary de escritura** que no existía:

```
FAIL  src/routes/me-empresa.test.ts
Error: Cannot find module './me-empresa.js'

FAIL  src/routes/empresa.test.tsx
Error: Failed to resolve import "./empresa.js"
```

Los tests de ruta se escribieron contra el contrato (401/403/404/400, true/false, idempotente) y quedaron verdes con los handlers.

## 2. Verde

```
pnpm --filter @booster-ai/shared-schemas exec vitest run src/all-schemas.test.ts
  Test Files  1 passed (1)
       Tests  81 passed (81)

pnpm --filter @booster-ai/api exec vitest run src/routes/me-empresa.test.ts
  Test Files  1 passed (1)
       Tests  15 passed (15)

pnpm --filter @booster-ai/web exec vitest run \
  src/routes/empresa.test.tsx \
  src/components/nav-items.test.ts \
  src/router.test.tsx
  Test Files  3 passed (3)
       Tests  15 passed (15)
```

Casos que cubren aceptación:

- PATCH activa/desactiva `carbon_measurement_enabled` en la empresa de la membresía; idempotente sin write; body inválido 400.
- 403 `admin_required` (despachador/visualizador); 403 `no_active_empresa`; 403 `no_es_empresa`; 401; 404 si la fila desapareció.
- GET devuelve el flag real (no un default inventado).
- UI: switch refleja GET; toggle llama PATCH; fallo de PATCH no deja el switch en un estado inventado; despachador no gestiona.

## 3. Typecheck + lint

```
pnpm --filter @booster-ai/shared-schemas typecheck  → tsc --noEmit, exit 0
pnpm --filter @booster-ai/api typecheck              → tsc --noEmit, exit 0
pnpm --filter @booster-ai/web typecheck              → tsc --noEmit, exit 0

biome check (archivos tocados)                     → 0 errores
```

## 4. Harness ADR-057

```
[check-route-default-deny] OK — 48 mounts (47 factories/routers únicos)
clasificados en server.ts; cero sin clasificar, cero stale.
```

`createMeEmpresaRoutes` clasificado `ENFORCED`.

## 5. Smoke (sin SQL)

Sustituto de browser en este entorno: tests de UI (carga del flag → switch; toggle → PATCH; error no miente). No hay sesión Firebase contra prod.

Pasos humanos post-deploy:

1. Loguearse como dueño/admin.
2. Sidebar → **Empresa** (`/app/empresa`).
3. Activar **Medí la huella de carbono en mis viajes**.
4. `SELECT carbon_measurement_enabled FROM empresas WHERE id = <empresa activa>;` → `true`.
5. Un despachador de la misma empresa no ve el control (y el PATCH responde 403).

## 6. Sin verificar

- Click real en producción (no hay sesión Firebase en este entorno).
- Override por viaje (fuera de alcance).
- `docs/frentes-vivos.md` no se tocó.
