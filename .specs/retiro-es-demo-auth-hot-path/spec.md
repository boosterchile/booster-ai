# Spec: retiro-es-demo-auth-hot-path

- Date: 2026-09-21
- Status: Accepted (slice Slot 2, plan de hardening 21–27)
- Linked: `docs/frentes-vivos.md` Slot 2; `chore/retiro-subsistema-demo` (login/seed ya retirados)

## 1. Objective

Sacar el enforcement de `es_demo` / `is_demo` del camino productivo de autenticación. Cada request autenticado deja de ejecutar `demoExpiresMiddleware` e `isDemoEnforcementMiddleware`.

## 2. Why now

Verificado en `apps/api/src/server.ts`: ambos middlewares se instancian una vez y se montan en cada `app.use` con `firebaseAuthMiddleware` (incluido `/me`, `/empresas/*`, assignments, admin y el `for` de transport-docs). En cada request leen `firebaseClaims.custom.is_demo` y, si no es demo, hacen passthrough. El branch corre igual para cuentas reales.

`POST /demo/login` y el seed admin ya están retirados. `DEMO_MODE_ACTIVATED` no gatea ese chain: el enforcement corre con el flag en false. La columna `empresas.es_demo` ya no autoriza la impersonación (ADR-053, `es_usuario_prueba`).

## 3. Success criteria

- [x] `server.ts` no importa, no instancia y no monta `createDemoExpiresMiddleware` ni `createIsDemoEnforcementMiddleware`. — verificado 2026-09-22: `git grep` en cf76ea8 de los factories, de `demoExpiresMiddleware`/`isDemoEnforcementMiddleware` y de los imports `demo-expires`/`is-demo-enforcement` en `apps/api/src/server.ts` → solo el comentario de la línea 220; retirado en #698 (d7d799a).
- [x] Un request autenticado de cuenta real sigue el mismo chain (firebase auth, userContext, impersonation-write-guard) sin un branch que lea `is_demo`. — verificado 2026-09-22: en cf76ea8 los `app.use` de `server.ts` encadenan `firebaseAuthMiddleware` → `userContextMiddleware` → `impersonationWriteGuardMiddleware` sin middleware demo; fuera de tests y de los módulos no montados, `is_demo` solo aparece en `firebase-auth.ts:87` y `chat.ts:441` (copian el snapshot del ticket SSE, sin branch) y en `harden-demo-accounts.ts` (escribe el claim).
- [x] El script `check-is-demo-wire-completeness.ts` sale 1 si `server.ts` vuelve a mencionar esos middlewares en código (comentarios no cuentan). El test de vitest sobre el `server.ts` real falla en el mismo caso. — verificado 2026-09-22: script de cf76ea8 corrido sobre una copia: `server.ts` de main → exit 0; ese mismo `server.ts` + import/factory/mount de demoExpires → exit 1 (3 markers). `test/scripts/auth-hot-path-no-demo-enforcement.test.ts` (5 tests, lee el `server.ts` real con la misma función) verde en CI de #698 y #707.
- [x] Cuentas reales: sin cambio de contrato HTTP (siguen sin recibir `forbidden_demo` ni `demo_account_expired`). — verificado 2026-09-22: en cf76ea8 esos códigos solo los emiten `is-demo-enforcement.ts:75` y `demo-expires.ts:222/233`, módulos que ningún archivo no-test importa (salvo un tipo en `is-demo-allowlist.ts`); el api en prod `00610-qaw` (imagen 428ff51) contiene d7d799a.
- [x] No se toca Identity Platform, DNS, Terraform, ni `.github/workflows/*`. — verificado 2026-09-22: `gh pr view 698 --json files` → 16 archivos, todos en `.specs/retiro-es-demo-auth-hot-path/`, `apps/api/` y `docs/qa/`; ninguno en `infrastructure/` ni en `.github/workflows/`.

## 4. User-visible behaviour

Cuentas reales: idéntico. No hay cambio de copy.

Cuentas con un claim `is_demo` residual: el API ya no responde 403 `forbidden_demo` ni 401 `demo_account_expired` por ese claim. No queda un path dedicado de login demo que mintée esas sesiones. La UI que lee el claim (`useIsDemo`, banner, excepción del modal de clave) no se toca.

## 5. Out of scope

- Borrar toda mención de `es_demo` / `isDemo` / `DEMO_` (criterio de término del Slot 2 completo).
- Identity Platform, DNS, `demo.boosterchile.com`, Terraform.
- Columna `empresas.es_demo`, seed, `harden-demo-accounts`, `cuentas-demo`.
- Contrato del ticket SSE (`isDemo` en el payload): se conserva; nada del chain productivo branchea sobre él.
- Frontend `useIsDemo` / `DemoBanner` / `ProtectedRoute`.
- Deploy, canary, storage, tracking público, Slot 1, GPS.

## 6. Constraints

1. Cambio quirúrgico: desmontar el chain, no reescribir auth.
2. Los módulos `demo-expires.ts` e `is-demo-enforcement.ts` pueden quedar en el repo (código no montado). El guard impide volver a montarlos desde `server.ts`.
3. `collectMiddlewaresPerPath` sigue exportado: lo usa el gate de impersonación.
4. Workflows de CI no se editan. El job existente invoca el mismo script; cambia el veredicto del script.

## 7. Approach

Invertir `check-is-demo-wire-completeness.ts`: falla si el código de `server.ts` referencia los factories o los identificadores de middleware demo. Quitar imports, instancia y argumentos en cada `app.use`. Actualizar comentarios que afirmarían que el chain todavía enforza `is_demo`.

## 8. Alternatives considered

- **A. No-op al inicio del middleware si `DEMO_MODE_ACTIVATED` es false.** Rechazada: el middleware seguiría sentado en cada request.
- **B. Borrar los módulos y el ticket SSE en el mismo PR.** Rechazada: es el grep-a-cero del Slot 2, fuera de este slice.
- **C. Dejar el chain y confiar en el passthrough.** Rechazada: es el estado actual; el branch sigue en el hot path.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Un token residual con `is_demo: true` puede escribir y no expira por este middleware | M | M | El login que mintée esos tokens ya no existe. Rollback = revert del PR. No se toca Identity Platform en este slice. |
| Un PR futuro re-monta el middleware | M | M | El script y el test de `server.ts` fallan. |
| El título del job en `security.yml` sigue diciendo que exige el wire | L | L | El archivo de workflow no se toca (protegido). El script que el job ejecuta ahora falla si el wire vuelve. |

## 10. Test list

- T1 (rojo): `findHotPathDemoEnforcement(server.ts)` no está vacío antes del desmonte.
- T2: después del desmonte, el mismo assert es `[]`.
- T3: un fixture que vuelve a poner `demoExpiresMiddleware` / `isDemoEnforcementMiddleware` / los factories no devuelve `[]`.
- T4: una mención solo en comentario no dispara el guard.
- T5: `collectMiddlewaresPerPath` sigue acumulando middlewares (el gate de impersonación no se rompe).

## 11. Rollout

- Flag: no se introduce. `DEMO_MODE_ACTIVATED` no cambia de default.
- Migración: no.
- Rollback: revert del PR. Vuelve el chain anterior.

## 12. Open questions

Ninguna. El slice no espera un path demo dedicado: la superficie de login ya fue retirada.
