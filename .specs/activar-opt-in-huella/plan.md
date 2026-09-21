# Plan — Activar opt-in de medición de huella a nivel empresa

**Spec**: `.specs/activar-opt-in-huella/spec.md`
**Rama**: `cursor/activar-opt-in-huella-cbf8`
**Base**: `main`

## Orden

1. Contrato Zod `empresaCarbonMeasurementPatchSchema` en `packages/shared-schemas` + test.
2. Tests de ruta en rojo (TDD, dominio carbono / boundary de activación):
   - `PATCH /me/empresa` true/false persiste; idempotente; body inválido 400.
   - 403 `admin_required` (despachador); 403 `no_active_empresa`; 403 `no_es_empresa`; 401.
   - `GET /me/empresa` devuelve el flag de la empresa activa.
3. Implementar `createMeEmpresaRoutes` (GET + PATCH).
4. Cablear en `server.ts` (userContext en `/me/empresa` y `/me/empresa/*`, **antes** de `app.route('/me')`) y clasificar `createMeEmpresaRoutes` ENFORCED en `check-route-default-deny.ts`.
5. UI `/app/empresa` + ítem de menú (dueño/admin, cualquier tipo de empresa) + ruta en `router.tsx`.
6. Tests web (carga del flag, toggle PATCH, 403 visual, error no miente).
7. typecheck + biome + vitest. PR draft.

## Decisiones tácticas (Claude)

- Recurso `/me/empresa` (GET/PATCH `/`) separado de `/me/empresa/miembros`. El `empresa_id` sale de la membresía activa, igual que zonas y equipo.
- No se toca `GET /me` (evitar ensanchar el contrato público del bootstrap). La pantalla pega a GET/PATCH dedicados.
- Override por viaje: no. No hay superficie de edición de viaje que ya parchee flags; el spec lo deja fuera.
- Peso en activación: copy + degradación existente. No se rechaza el PATCH.
- Switch nativo (`<input type="checkbox" role="switch">`) con `<label for>` explícito. Sin primitiva nueva (freeze D1/D2).
- Layout del shell de operador (sidebar). Copy en vos.

## Archivos

- `.specs/activar-opt-in-huella/{spec,plan,verify}.md`
- `packages/shared-schemas/src/domain/empresa.ts` + `all-schemas.test.ts`
- `apps/api/src/routes/me-empresa.ts` (+ test)
- `apps/api/src/server.ts`
- `apps/api/scripts/check-route-default-deny.ts`
- `apps/web/src/routes/empresa.tsx` (+ test)
- `apps/web/src/components/nav-items.ts` (+ test)
- `apps/web/src/router.tsx` (+ `router.test.tsx`)
- `.specs/medicion-huella-segmento/plan.md` (puntero al cierre del pendiente de T13)

## Rollback

Revert del PR. Sin migración.
