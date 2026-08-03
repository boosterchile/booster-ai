# Verificación — Servicios del transportista

Corrido el 2026-08-03 sobre el código final de la rama. Node 24.17.0 (pin del
repo), Postgres 17 local, emulador Firebase Auth, API en `localhost:8080`.

## 1. TDD — rojo exhibido

### `GET /assignments` no existía

```
$ vitest run test/unit/assignments-route.test.ts -t "GET /assignments"

  × sin userContext → 401
  × sin activeMembership → 403 no_active_empresa
  × empresa no transportista → 403 not_a_carrier
  × devuelve los servicios de la empresa con el conductor explícito
  × con conductor asignado lo devuelve con nombre
  × sin servicios → lista vacía, no error
  × una fecha inválida no rompe la respuesta entera

AssertionError: expected 404 to be 401
AssertionError: expected 404 to be 200      ← las 7 en 404: la ruta no existe
 Tests  7 failed | 8 passed | 14 skipped (29)
```

### La pantalla no existía

```
$ vitest run src/routes/servicios.test.tsx
Error: Failed to resolve import "./servicios.js". Does the file exist?
 Test Files  1 failed (1)  ·  Tests  no tests
```

### El menú no la tenía

```
$ vitest run src/components/nav-items.test.ts
  × transportista → "Servicios" está en el menú, justo después de Ofertas
AssertionError: expected [ 'Inicio', …(8) ] to include 'Servicios'
```

### Aceptar una oferta no llevaba a ninguna parte

```
$ vitest run src/components/offers/OfferCard.test.tsx
  × al aceptar lleva al despachador a asignar conductor
AssertionError: expected "vi.fn()" to be called with arguments: [ { …(2) } ]
 Tests  1 failed | 31 passed (32)
```

## 2. Verde tras los arreglos

```
$ vitest run   (apps/web)
 Test Files  130 passed (130)  ·  Tests  1257 passed (1257)

$ vitest run test/unit/assignments-route.test.ts src/services/safe-iso-string.test.ts   (apps/api)
 Test Files  2 passed (2)  ·  Tests  34 passed (34)
```

## 3. Typecheck, lint y harness

```
$ pnpm --filter @booster-ai/web typecheck   → tsc --noEmit, exit 0
$ pnpm --filter @booster-ai/api typecheck   → tsc --noEmit, exit 0
$ biome check apps/web/src apps/api/src     → 476 files, 0 errores, 12 warnings (preexistentes)

$ tsx scripts/check-route-default-deny.ts   (ADR-057)
[check-route-default-deny] OK — 46 mounts (45 factories/routers únicos)
clasificados en server.ts; cero sin clasificar, cero stale.
```

El harness clasifica **por mount**, y `assignmentsRouter` ya estaba en
`ENFORCED`: un método nuevo en ese router no toca la tabla. Verificado leyendo
el harness, no supuesto.

## 4. E2E contra el API real

Dos empresas transportistas distintas, cada una con su asignación, más un
usuario con rol `visualizador`:

```
  ✓ GET /assignments → 200
  ✓ la empresa ve su servicio (1)
  ✓ driver viene null explícito (marca "sin conductor")
  ✓ es SU asignación
  ✓ trae código de seguimiento para reconocerla
  ✓ la empresa 2 NO ve servicios de la empresa 1
  ✓ alta de conductor → 201
  ✓ asignar-conductor → 200
  ✓ conductor_id QUEDÓ ESCRITO en la asignación
  ✓ la lista muestra al conductor ({"user_id":"3f22…","full_name":"Conductor Servicio"})
  ✓ visualizador PUEDE ver la lista → 200
  ✓ visualizador NO puede asignar → 403
  ✓ un servicio entregado sale de la lista (0)

13 ok · 0 falla
```

Los dos que importan de verdad:

- **Aislamiento entre empresas** probado con DOS empresas, no con una. Un test
  con una sola empresa habría pasado igual con un `WHERE` roto.
- **`conductor_id` quedó escrito en la base** — que es el criterio del frente,
  no que el endpoint devuelva 200. Es exactamente el campo que hoy está en cero
  en las 1 asignaciones activas de producción.

## 5. Build de producción

```
$ pnpm --filter @booster-ai/web build   → ✓ built
dist/assets/servicios-Bcek6xOT.js       ← el chunk de la ruta se emitió
```

El build es la verificación que importa acá: un `lazyRouteComponent` con path
mal escrito compila en dev (donde Vite resuelve on-demand) y revienta recién en
producción.

## 6. Sin verificar

- **La pantalla en un navegador con datos reales.** `apps/web` no tiene
  `connectAuthEmulator`, así que no hay sesión posible contra el emulador local
  — misma limitación declarada en [#642](../ui-conductor-operativa/verify.md).
  Cubierto por 7 tests de la ruta (incluido vitest-axe) más el e2e de API que
  ejercita el endpoint que la pantalla consume.
- Nada tocó producción.
