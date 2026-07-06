# Auditar mocks de router en flujos críticos — la lección de B1 es sistémica

**Dimensión**: web / testing · **Estado**: pendiente, prioridad alta post-hito.
**Fuente**: fix round final-review W1 (2026-07-06), instrucción del PO tras el hallazgo B1.

## Problema

B1 (review final W1, 2026-07-06) fue un no-op silencioso en `login.tsx`: `navigate({ to: postLoginTarget })`/`<Navigate to={postLoginTarget} />` con un `postLoginTarget` que trae un `?query` embebido (ej. `/onboarding-admin?token=...`) no navegaban de forma confiable — y sobre todo, el early-return `<Navigate to="/app" />` (incondicional, ignorando el redirect) era un bug directo, no una sutileza de parsing. Los tests existentes de `login.test.tsx` mockean `@tanstack/react-router` completo (`useNavigate`, `useSearch`, `Navigate`), lo que ocultó el bug por completo: un mock de `navigate` solo registra CON QUÉ ARGUMENTOS se lo llamó, nunca si esos argumentos producen una navegación real — no puede distinguir un no-op de una navegación exitosa, ni puede exponer que un `<Navigate to="/app" />` hardcodeado ignora el resto de la lógica.

Cualquier otro flujo de la app que navegue con query strings (o que tenga early-returns condicionales sobre `<Navigate>`) puede tener el mismo tipo de bug invisible, protegido por la misma clase de test con mocks de router.

## Qué se hizo en este fix round (para no repetir el patrón)

`apps/web/src/routes/login-post-login-redirect.test.tsx` — test de integración con el router REAL de TanStack (`Router`/`RouterProvider`/`createMemoryHistory`, sin mockear `@tanstack/react-router`), solo mockeando `use-auth.js`/`use-feature-flags.js` (dependencias NO relacionadas al router). Este es el patrón a replicar: montar `LoginRoute` bajo un árbol de rutas mínimo (`/login`, destino, stub) con memory history, y aserta la ubicación FINAL del router tras la interacción — no los argumentos con que se llamó a un mock.

## Plan de pago

1. Auditar `apps/web/src` buscando tests que mockeen `useNavigate`/`@tanstack/react-router` en flujos críticos:
   ```bash
   grep -rln "vi.mock('@tanstack/react-router'" apps/web/src --include="*.test.tsx"
   ```
   Cruzar esa lista contra los flujos considerados críticos: login (`login.test.tsx`, ya cubierto por el nuevo test de integración), onboarding (`onboarding.test.tsx`, `onboarding-admin.test.tsx`), checkout/creación de viajes (`cargas.test.tsx` si aplica), conductor (`conductor.test.tsx`, `login-conductor.test.tsx`), pagos/cobranza (`cobra-hoy-historial.test.tsx` si aplica). Listar cada archivo con file:line del `vi.mock` como checklist de este stub.
2. Fijar política: **≥1 test de integración con router REAL (memory history) por flujo crítico** que ejercite la navegación end-to-end del flujo (no solo aserciones sobre argumentos de un mock). Los tests con mock de router pueden convivir (son más rápidos y siguen siendo útiles para casos que no dependen de navegación real, ej. validación de formulario), pero cada flujo crítico necesita al menos un test que NO mockee el router.
3. Para cada flujo de la lista del punto 1 que navegue con `to`/`href` conteniendo un `?query` embebido, o que tenga un `<Navigate>` condicional/incondicional sobre estado de auth similar al de `login.tsx:82-95`: escribir el test de integración correspondiente, replicando el patrón de `login-post-login-redirect.test.tsx`.
4. Referencia obligatoria en cada test nuevo: citar el fix de B1 (`apps/web/src/routes/login.tsx`, commits del fix round final-review 2026-07-06) como precedente del patrón y de por qué los mocks de router no bastan para esta clase de bug.

## Trigger

Prioridad alta, post-hito (no bloquea el merge de esta rama — B1 ya está arreglado y cubierto). Ejecutar como barrido dedicado apenas cierre el hito CORFO actual, antes de que se agreguen más flujos con navegación por query string (ej. cualquier feature de Fase 2 que use links con parámetros).
