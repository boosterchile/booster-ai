# Plan — CRUD zonas + activar empresa

**Spec**: `.specs/crud-zonas-activar-empresa/spec.md`
**Rama**: `cursor/crud-zonas-activar-empresa-474e`
**Base**: `main` @ PR #690 mergeado

## Orden

1. Contratos Zod en `packages/shared-schemas` (`zoneCreateBodySchema`, `zoneUpdateBodySchema`, `empresaEstadoPatchSchema`). Test de `regionCodeSchema` rechaza `13`.
2. Tests de ruta en rojo (TDD del dominio matching + authz):
   - `PATCH /admin/empresas/:id` activa / niega no-admin / 404 / idempotente.
   - `POST /me/zonas` persiste `XIII`/`ambos`/`es_activa`; rechaza `13`; 403 otro rol / no transportista; PATCH de id ajeno → 404.
   - `runMatching` con origen `XIII` + zona + empresa activa → candidato; sin zona en esa región → 0.
3. Implementar handlers.
4. Cablear `server.ts` + clasificar `createMeZonasRoutes` en `check-route-default-deny.ts`.
5. UI platform-admin + `/app/zonas` + ítem de menú (solo dueño/admin transportista).
6. Tests web (listado, Activar, alta de zona, rechazo visual de región inválida no aplica porque el select solo ofrece romanos).
7. typecheck + biome + vitest. PR.

## Decisiones tácticas (Claude)

- PATCH de estado vive en `createAdminEmpresaMiembrosRoutes` (el GET `/admin/empresas` ya está ahí). No hay mount nuevo → el harness ADR-057 no suma factory.
- CRUD de zonas es factory nueva `createMeZonasRoutes` montada en `/me/zonas`, mismo patrón que `/me/empresa/miembros` (userContext en exact path + `/*`, **antes** de `app.route('/me')`).
- Soft-delete = `es_activa=false`. Sin columna `eliminado_en` (no está en el schema; no se migra).
- Unicidad `(empresa, región, tipo)` en aplicación, no migración (evitar unique que falle si prod ya tiene duplicados de seed).
- Menú: etiqueta **Zonas de matching** (`/app/zonas`) para no chocar con **Zonas** del stakeholder.

## Archivos

- `.specs/crud-zonas-activar-empresa/{spec,plan,verify}.md`
- `packages/shared-schemas/src/domain/{zone,empresa}.ts` + `all-schemas.test.ts`
- `apps/api/src/routes/admin-empresa-miembros.ts` (+ test)
- `apps/api/src/routes/me-zonas.ts` (+ test)
- `apps/api/src/server.ts`
- `apps/api/scripts/check-route-default-deny.ts`
- `apps/api/test/unit/matching-service.test.ts`
- `apps/web/src/components/admin/ActivarEmpresa.tsx` (+ test)
- `apps/web/src/routes/platform-admin.tsx` (+ test del link/sección)
- `apps/web/src/routes/zonas.tsx` (+ test)
- `apps/web/src/components/nav-items.ts` (+ test)
- `apps/web/src/router.tsx` (+ test path)
- `apps/web/src/lib/regions-chile.ts`

## Rollback

Revert del PR. No hay migración. Las filas de `zonas` y los `estado` escritos quedan; se revierten a mano por la misma UI/API si hace falta.
