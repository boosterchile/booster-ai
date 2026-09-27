# Spec: retiro-demo-codigo-muerto

- Fecha: 2026-09-22
- Estado: aceptada (el PO aprobó abrir el PR el 2026-09-22, incluido el retiro del banner). Es un slice del Slot 2.
- Vinculada: `docs/frentes-vivos.md` Slot 2. Supersede §5 de `.specs/retiro-es-demo-auth-hot-path/spec.md` en dos puntos, el contrato del ticket SSE y el frontend `useIsDemo` / `DemoBanner` / `ProtectedRoute`. El resto de esa §5 sigue fuera de alcance.

## 1. Objetivo

Borrar el código demo que #698 dejó desmontado o sin lector, sin tocar schema, workflows, Terraform ni Identity Platform. El grep del Slot 2 baja, pero **no llega a 0** con este PR.

## 2. Por qué ahora (verificado en `cf76ea8` y en prod, 2026-09-22)

- `demo-expires.ts` no está montado desde #698. Lo importan solo su propio test y `demo-expires-perf.integration.test.ts`. `check-is-demo-wire-completeness.ts` busca strings en `server.ts` y no lee el módulo.
- El ticket SSE acuña y restituye `isDemo` solo para que lo leyera `demoExpires`, que ya no corre. Fuera de los módulos no montados, nada del API lee `firebaseClaims.custom.is_demo`.
- En la web, `useIsDemo` alimenta dos cosas: `DemoBanner` y la excepción de `RotarClaveModal` en `ProtectedRoute`. Esa excepción existía para quien entraba por `/demo/login`, que ya está retirado.
- En prod, solo lectura:
  - `empresas.es_demo = true`: 0 filas.
  - `cuentas_demo`: 4 cuentas con `firebase_uid`.
  - En Identity Platform (`accounts:lookup`) las 4 están **habilitadas**, con `is_demo: true`, `expires_at` 2026-06-24 (vencido) y **ningún login** (`lastLoginAt` vacío).

## 3. Entradas y salidas

**Se borran:**
- `apps/api/src/middleware/demo-expires.ts` y su test.
- `apps/api/test/integration/demo-expires-perf.integration.test.ts`.
- `apps/web/src/components/DemoBanner.tsx` y su test.
- `apps/web/src/hooks/use-is-demo.ts`.

**Se editan:**
- `sse-ticket.ts`: el payload y `ConsumedTicket` quedan en `{ uid, assignmentId }` / `{ uid }`. Un ticket acuñado por la revisión anterior, que trae `isDemo`, se sigue consumiendo; el campo sobrante se ignora (convivencia en el canary).
- `routes/chat.ts`: el endpoint `stream-ticket` deja de leer el claim `is_demo`.
- `middleware/firebase-auth.ts`: el camino del ticket SSE deja de restituir `custom.is_demo` y el tipo de `sseTicketStore` pasa a `{ uid }`.
- `ProtectedRoute.tsx`: sin `useIsDemo` ni la excepción demo del modal; la excepción de impersonación queda igual.
- `routes/__root.tsx`: sin `<DemoBanner />`.
- Comentarios que nombran lo retirado: `server.ts`, `skip-public-verify.ts`, `demo-cache-warm.ts` (más su mensaje de log), `routes/index.tsx`, `ImpersonationBanner.tsx` y `use-impersonation.ts`.
- Tests: `sse-ticket.test.ts`, `firebase-auth.test.ts`, `chat-route.test.ts` (test nuevo de `stream-ticket`), `ProtectedRoute.test.tsx` (guarda verde con claim `is_demo` en el token), `__root.test.tsx`, `index.test.tsx`, y comentarios de `ImpersonationBanner.test.tsx` y `use-impersonation.test.ts`.

**No se tocan:** `is-demo-enforcement*`, `is-demo-allowlist*`, `scripts/check-is-demo-*` (los usa `security.yml`), `demo-cache-warm` (ruta montada), `harden-demo-accounts`, `cuentas-demo`, `seed-demo*`, schema/drizzle, `feature-flags` / `site-settings`, `cargar-gps-scorecard.ts` (el filtro `es_demo` de #704 va aparte, con decisión del PO), `.github/`, `infrastructure/`, Identity Platform.

## 4. Comportamiento visible

- Cuentas reales: sin cambio.
- Sesión con claim `is_demo` residual: deja de ver el banner «modo demo» y, si `auth_universal_v1_activated` está activo y no tiene clave numérica, ve `RotarClaveModal` como cualquier usuario. Hoy son 4 cuentas y ninguna inició sesión nunca.
- Contrato HTTP: sin cambio. `POST …/stream-ticket` sigue devolviendo `{ ticket, expires_in_sec }`, y el campo `isDemo` nunca salió al cliente.

## 5. Fuera de alcance (declarado)

- Grep a 0 del Slot 2: quedan los jobs de `security.yml`, schema y endpoints, UI de flags y Terraform/DNS.
- **Deshabilitar las 4 cuentas demo** en Identity Platform. Desde #698 el API ya no rechaza su `expires_at` vencido. Es una acción del PO (cuentas e IAM) y se reporta en el PR.
- Validar el payload del ticket con Zod y loguear el `catch` de Redis en `consumeStreamTicket`. Ambos son anteriores y el diff no los cambia.
- Quedan en el grep, a propósito: el test de convivencia del ticket (`sse-ticket.test.ts`, que usa el literal `isDemo` del payload viejo) y su comentario en `sse-ticket.ts`. Se retiran cuando ya no conviva ninguna revisión anterior. También quedan `demo-cache-warm` (la ruta montada) y sus menciones.
- Base del conteo: `git grep -l -E 'es_demo|isDemo|DEMO_|demo\.boosterchile' -- apps packages infrastructure`, igual que el criterio de `frentes-vivos.md`. Da 52 sobre `origin/main` (cf76ea8 y 80c2682), no los 40 del documento; actualizar ese inventario es del PO.

## 6. Criterios de salida

- [x] Rojo exhibido (dominio auth), commit `9e13e56`: API 3 failed | 55 passed y web 2 failed | 16 passed, cada uno por la causa correcta (salida en el PR):
  - (1) el ticket acuñado no persiste `isDemo`;
  - (2) un ticket de la revisión anterior, con `isDemo: true`, se consume y devuelve solo `{ uid }`;
  - (3) el camino SSE de `firebase-auth` no restituye `custom.is_demo`;
  - (4) sesión con claim `is_demo`, sin clave numérica y con el flag activo → `RotarClaveModal` visible;
  - (5) `__root` no monta el banner demo.
- [x] Verde (node 24.17.0): `apps/api` 182 archivos / 2242 tests y `apps/web` 148 / 1501. Typecheck y build de ambos, más `pnpm lint` (1195 archivos, lint-rls ✅). `check-is-demo-wire-completeness.ts` OK y `check-is-demo-allowlist-comments.ts` exit 0; `impersonation-wire-completeness.test.ts` corre dentro de la suite del API.
- [x] Grep del Slot 2: 52 → **45** archivos. El diff no toca `.github/`, `infrastructure/` ni `apps/api/drizzle/`.
