# loginLinkUrl acepta http (inconsistente con onboardingLinkBaseUrl) + opts.pool sin tipar en admin-jobs.ts

**Dimensión**: api / type-safety · **Estado**: pendiente, bajo riesgo, no bloqueante.
**Fuente**: fix round final-review W1 (2026-07-06), hallazgos menores de `apps/api/src/routes/admin-signup-requests.ts` y `apps/api/src/routes/admin-jobs.ts`.

## Problema 1 — `loginLinkUrl` acepta `http://`, `onboardingLinkBaseUrl` exige `https://`

`apps/api/src/routes/admin-signup-requests.ts:48-58`:
```typescript
const onboardingLinkBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'onboardingLinkBaseUrl debe ser https',
  });

const approveBodySchema = z.object({
  loginLinkUrl: z.string().url().optional(),
  onboardingLinkBaseUrl: onboardingLinkBaseUrlSchema.optional(),
});
```

`onboardingLinkBaseUrl` tiene el `.refine()` https documentado (W1.4: "Debe ser https... porque el token viaja como query param"). `loginLinkUrl` (el link que el email/notificación de aprobación apunta para que el usuario inicie sesión) usa solo `z.string().url()` — acepta `http://` sin problema. Ambos son URLs que un admin puede sobreescribir en el body de `/admin/signup-requests/:id/approve` y ambos terminan expuestas al usuario final (uno en el link de login, otro en el link de onboarding); no hay razón de negocio para que uno exija https y el otro no — es una inconsistencia de rigor, no una decisión deliberada (no hay comentario que la justifique, a diferencia de `onboardingLinkBaseUrl`).

Riesgo real: bajo (el default `DEFAULT_LOGIN_LINK_URL = 'https://app.boosterchile.com/login'` ya es https; el override es solo alcanzable por un platform-admin autenticado, no por el público) — pero el propio `assertStrongSecret`/patrón de la codebase (fail-closed explícito, ver runbook de activación) sugiere que URLs que se envían a usuarios deberían validarse con el mismo rigor en todos los campos.

## Plan de pago (problema 1)

1. Extraer un schema compartido `httpsUrlSchema` (mismo refine que `onboardingLinkBaseUrlSchema`, mensaje parametrizable) y usarlo para AMBOS campos (`loginLinkUrl` y `onboardingLinkBaseUrl`) en `approveBodySchema`.
2. Test: `admin-signup-requests.test.ts` (o donde vivan los tests de `approveBodySchema`) — agregar caso `loginLinkUrl: 'http://evil.example'` → 400 de validación.
3. Confirmar que ningún caller interno (scripts, tests existentes) pasa un `loginLinkUrl` http — `grep -rn "loginLinkUrl" apps/api/src apps/api/test` antes de aplicar el refine para no romper nada en silencio.

## Problema 2 — `opts.pool` sin tipar fuerza `as unknown as PoolLike` (dos veces)

`apps/api/src/routes/admin-jobs.ts` declara `pool?: pg.Pool | null` en las opts del factory (línea ~65), pero los DOS handlers que lo usan castean con `as unknown as`:

- `apps/api/src/routes/admin-jobs.ts:215` — `const pool = opts.pool as unknown as PoolLike;` (reaper de cuentas IdP, precedente — ya existía antes de este PR).
- `apps/api/src/routes/admin-jobs.ts:258` — `const pool = opts.pool as unknown as OrphanPoolLike;` (reaper de onboarding huérfano, agregado por esta rama — W1.5/T1.7).

`PoolLike` (`apps/api/src/jobs/reap-inert-idp-accounts.ts`) y `OrphanPoolLike`/`PoolLike` (`apps/api/src/jobs/reap-orphan-onboarding-firebase.ts`, alias local `OrphanPoolLike`) son interfaces mínimas (`query(sql, params): Promise<{rows, rowCount}>`) pensadas para desacoplar los jobs de `pg` real y facilitar tests con un stub. El cast `as unknown as X` sugiere que TS no infiere la asignabilidad estructural directa entre `pg.Pool` (con sus overloads de `query`) y estas interfaces mínimas — probablemente por los overloads de `pg.Pool.query` (variantes con `QueryConfig`, `Submittable`, callback-style) que confunden la comprobación estructural directa de un objeto completo, aunque el shape que SÍ se usa (`query(text: string, values?: any[]): Promise<QueryResult<T>>`) es compatible en los hechos.

## Plan de pago (problema 2)

1. Escribir un adaptador explícito en vez de castear el objeto completo:
   ```typescript
   function toPoolLike(pool: pg.Pool): PoolLike {
     return { query: (sql, params) => pool.query(sql, params) };
   }
   ```
   Esto type-checkea contra la firma REAL de `pg.Pool.query(text, values?)` (sin pasar por `unknown`) porque solo se usa la forma de la función, no el objeto `pg.Pool` completo — la comprobación de compatibilidad de retorno (`QueryResult<T>` → `{rows, rowCount}`) es estructural y no requiere excess-property check.
2. Aplicar el mismo patrón a ambos sitios (`reap-inert-idp-accounts` y `reap-orphan-onboarding-firebase`) — unificar quizás en un solo helper compartido si `PoolLike`/`OrphanPoolLike` terminan siendo estructuralmente idénticas (revisar si vale la pena consolidarlas en un solo tipo en un módulo común, en vez de dos interfaces duplicadas por archivo).
3. Test: correr `pnpm --filter @booster-ai/api typecheck` tras el cambio — confirmar 0 `as unknown as` remanentes en `admin-jobs.ts` (`grep -n "as unknown as" apps/api/src/routes/admin-jobs.ts` debe salir vacío).

## Por qué no se resolvió en este fix round

Ambos son limpieza de type-safety sin impacto funcional observable (el cast en el pool YA funcionaba correctamente en runtime desde antes de este PR — es puramente una brecha de rigor de tipos, no un bug; `loginLinkUrl` tampoco tiene explotación conocida). Ninguno bloquea B1/R1/R2 de este fix round. Agruparlos en un solo stub porque ambos son "hallazgos menores de tipado/validación descubiertos en la misma pasada de review", no porque compartan causa.

## Trigger

Baja prioridad. Resolver en el próximo PR que toque `admin-signup-requests.ts` o `admin-jobs.ts` por otro motivo, o en un barrido de limpieza de `as unknown as` a nivel repo.
