# Spec — Reglas del stack sin excepciones (T10-12)

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase B, criterio **T10-12 Reglas del stack** (`.specs/trl10/spec.md`, ADR-082)
- Contrato: `CLAUDE.md` § Reglas duras del stack (zero `any`, zero `@ts-ignore`, zero `as unknown as T` sin Zod previo, zero `console.*`)

## Alcance

`apps/*/src` y `packages/*/src`, sin tests (`*.test.ts(x)`, `*.spec.ts`, `test/`, `e2e*/`).

## Línea base (main @ 0008fa6)

| Regla | Ocurrencias |
|---|---|
| `any` explícito | 31 (28 `Context<any, any, any>` en helpers `require*`, `migrator.ts`, `voice-commands.ts`, `crash-trace-adapters.ts`, `ca-self-signed.ts`) |
| `@ts-ignore` | 0 |
| `console.*` | 2, ambos en `apps/web/src/lib/error-reporting.ts` (el sink de errores, exceptuado por el criterio) |
| `as unknown as` | 10 (`admin-jobs.ts` ×2, `OnboardingForm.tsx` ×6, `voice-commands.ts`, `sms-fallback-gateway/parser.ts`) |

## Salidas

- `Context<any, any, any>` → `Context` (hono): los handlers con `zValidator` siguen tipando; `tsc` limpio.
- `migrator.ts`: `db` tipado como `NodePgDatabase<typeof schema>`; las filas de `__drizzle_migrations` pasan por un schema Zod.
- `ca-self-signed.ts`: `getTBSCertificate` (no declarado en `@types/node-forge`) tipado explícito y verificado en runtime.
- `voice-commands.ts`: `Window &` con el constructor de SpeechRecognition tipado; sin `any` ni `as`.
- `crash-trace-adapters.ts`: **bug real**. `insertIds` no es una opción de `InsertRowsOptions`: el SDK la ignoraba y generaba un `insertId` aleatorio, así que un reintento duplicaba el evento en BigQuery. Pasa a `raw: true` con filas `{ insertId: crash_id, json }`. El test que fijaba el contrato equivocado se reescribe (rojo exhibido).
- `admin-jobs.ts`: adaptador `adaptarPool(pg.Pool)` con la firma `PoolLike` en vez de dos casts.
- `OnboardingForm.tsx`: el formulario se tipa con `z.input` del schema (strings sin brand); al enviar, `safeParse` da el tipo de salida. Si falla, se muestran los errores de campo y no se envía.
- `sms-fallback-gateway/parser.ts`: capturas de la regex leídas una por una, sin cast.

## Excepciones declaradas (quedan)

- `packages/ui-components/src/vitest-axe.d.ts`: augmentación de `Assertion<T = any>` de vitest, solo para tests. TypeScript exige que el parámetro sea idéntico al de vitest para el merge de declaraciones.
- `apps/web/src/sw.ts`: 2 `@ts-expect-error` justificados (tipos de workbox con `exactOptionalPropertyTypes`). No son `@ts-ignore` y fallan si dejan de hacer falta.
- `apps/web/src/lib/error-reporting.ts`: 2 `console.warn`, el sink de errores del cliente.

## Criterios de éxito

1. Recuento final en el alcance: 0 `any` fuera de la augmentación declarada, 0 `@ts-ignore`, 0 `as unknown as`, `console.*` solo en el sink.
2. typecheck, lint y tests de los workspaces tocados en verde.
