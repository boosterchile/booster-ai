# Verificación — CRUD zonas + activar empresa

Corrido sobre la rama `cursor/crud-zonas-activar-empresa-474e` (Node 24.21.0, pnpm 10.34.4).

## 1. TDD — rojo exhibido (dominio matching)

Matching ya filtraba `zonas` por `codigo_region` exacto + `tipo_zona IN ('recogida','ambos')` + `es_activa` + empresa `activa`. El rojo de este frente es el **boundary de escritura** que no existía:

- `PATCH /admin/empresas/:id` no existía → ops SQL.
- `POST /me/zonas` no existía → seed SQL.
- `regionCodeSchema.parse('13')` ya fallaba; el test nuevo lo clava junto con el POST 400.

Los tests de ruta se escribieron contra el contrato (401/403/404/400/XIII) y quedaron verdes con los handlers. Matching: se agregaron dos casos `origen XIII` que fallarían si alguien cambiara el filtro de zonas.

## 2. Verde

```
pnpm --filter @booster-ai/shared-schemas exec vitest run src/all-schemas.test.ts
  Test Files  1 passed (1)
       Tests  80 passed (80)

pnpm --filter @booster-ai/api exec vitest run \
  src/routes/admin-empresa-miembros.test.ts \
  src/routes/me-zonas.test.ts \
  test/unit/matching-service.test.ts
  Test Files  3 passed (3)
       Tests  45 passed (45)

pnpm --filter @booster-ai/web exec vitest run \
  src/components/admin/ActivarEmpresa.test.tsx \
  src/routes/zonas.test.tsx \
  src/routes/platform-admin.test.tsx \
  src/components/nav-items.test.ts \
  src/router.test.tsx
  Test Files  5 passed (5)
       Tests  19 passed (19)
```

Casos que cubren aceptación:

- Activar `pendiente_verificacion` → `activa` + audit log; no-admin 403; 404; idempotente; filtro `?estado=`.
- POST zona `XIII`/`ambos`/`es_activa`; `region_code: '13'` → 400; despachador 403; no transportista 403; id ajeno PATCH → 404.
- `runMatching` origen XIII + zona + empresa activa → 1 candidato; sin zona en esa región → 0.

## 3. Typecheck + lint

```
pnpm --filter @booster-ai/shared-schemas typecheck  → tsc --noEmit, exit 0
pnpm --filter @booster-ai/api typecheck              → tsc --noEmit, exit 0
pnpm --filter @booster-ai/web typecheck              → tsc --noEmit, exit 0

biome check (archivos tocados)                     → 0 errores
```

## 4. Harness ADR-057 + impersonation + is-demo

```
[check-route-default-deny] OK — 47 mounts (46 factories/routers únicos)
clasificados en server.ts; cero sin clasificar, cero stale.

[check-impersonation-wire-completeness] OK
[check-is-demo-wire-completeness] OK
```

`createMeZonasRoutes` clasificado `ENFORCED`.

## 5. Smoke (sin SQL)

Sustituto de browser en este entorno: tests de UI (Activar click → PATCH; alta XIII → POST; toggle → PATCH). No hay sesión Firebase contra prod.

Pasos humanos post-deploy:

1. `/app/platform-admin` → Empresas → Pendientes → **Activar**.
2. `/app/zonas` (dueño transportista) → XIII / Ambos → **Agregar**.
3. Viaje con origen XIII → matching ofrece al carrier.
4. `POST /me/zonas` con `"region_code":"13"` → 400.

## 6. Sin verificar

- Click real en producción.
- `docs/frentes-vivos.md` no se tocó (excepción PO 2026-09-21, mismo patrón que #689/#690).
