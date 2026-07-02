# p0c-uids-demo-secret-manager — Spec (Frente F2)

**Programa padre**: `.specs/pivote-documental-y-cierre-legal-2026-06/spec.md` — Frente **F2 (PII)**
**Cierra**: auditoría 2026-06-14 hallazgo **P0-C** (4 Firebase UIDs reales hardcoded como PII en código vivo)
**Status**: **Draft — pendiente aprobación PO** (no ejecutar Fase Act sin firma en §13)
**PO**: Felipe Vicencio — dev@boosterchile.com
**Fecha**: 2026-06-17
**Dominio crítico**: SÍ (toca `auth`/cuentas Firebase) → TDD obligatorio (`booster-skills:tdd-dominio-critico`).

> Este documento es el **spec TDD-ready** del frente F2. El test list (§10) es lo primero; el código se escribe red→green→refactor después de aprobado.

---

## 1. Objective

Sacar las 4 constantes `OLD_DEMO_UIDS` (Firebase UIDs de cuentas demo) del **código vivo** (`apps/api/src/services/harden-demo-accounts.ts:33-38`) y moverlas a **una env var validada por Zod**, conservando el comportamiento idéntico del hardening (`retireOldBatch`). El historial git **no** se reescribe (decisión PO). Adicionalmente: documentar la decisión de no reescribir historial, ejecutar el checklist de confirmación-demo y dejar registrada la rotación/invalidación en Firebase.

## 2. Why now

- **P0-C abierto**: la auditoría 2026-06-14 marcó los 4 UIDs como PII / identificadores de cuenta en claro en `main` (`harden-demo-accounts.ts:33-38`). Mientras vivan en el código siguen propagándose a cada clon, build (`dist/`) y futuro commit.
- **Bloqueo legal**: junto con F1 (consent) y F3 (Sovos), F2 agota los 🔒 legales (P0-A/B/**C**) que eran el grueso de lo bloqueado tras la auditoría.
- **Bajo riesgo, alto cierre**: es Fase A del programa (paralelo con F1), cambio mecánico de extracción de literales + validación; no toca contratos públicos de API ni UI.
- **El one-shot ya corrió**: el `--retire-old-batch` de ADR-053 ya se ejecutó en prod (2026-05-25, evidencia `.specs/sec-001-cierre/sprint-2a-evidence/t4-one-shot-retire.md`) y dejó las 4 UIDs `disabled: true`. La constante hoy es vestigial-pero-aún-importada; sacarla del código no rompe ninguna operación pendiente, solo cierra el vector PII.

## 3. Success criteria (measurable)

- [ ] `grep -n "OLD_DEMO_UIDS" apps/api/src` **no devuelve ningún literal de UID** (la lista viene de env validada). Concretamente: `grep -REn "<los 4 UIDs demo de ADR-053>" apps packages` → **0 resultados en código ejecutable vivo** (`apps/api/src/**`, `apps/api/scripts/**`, fixtures/seeds/config). Fuera de alcance: `dist/` (build artefact) y las menciones **documentales/históricas pre-existentes** (`.specs/sec-001-cierre/`, `docs/adr/053`, `infrastructure/security-hotfixes-2026-05-14.tf`) — son registro ya público (attack surface desde 2026-05-10, cuentas deshabilitadas), sin valor de seguridad en borrarlas y fuera de la decisión de no-purga (ver `decision-historial.md §1`). Este spec **no** cita los UIDs literales para no reintroducir PII en docs nuevos.
- [ ] `harden-demo-accounts.ts` (`retireOldBatch`) itera la lista de UIDs **provista por configuración validada (Zod)**, no por constante hardcoded; mismo resultado observable que antes (idempotente, resume-from-partial, failed/not_found).
- [ ] `config.ts` (o el parser dedicado del service) **rechaza el arranque** con `process.exit(1)` si `DEMO_OLD_UIDS` está presente pero malformada (UID que no matchea `/^[A-Za-z0-9]{20,}$/`).
- [ ] `DEMO_OLD_UIDS` **ausente o vacía → no-op seguro**: `retireOldBatch` no muta nada y retorna `{ retired: 0, skippedAlreadyDisabled: 0, failed: [] }` (no lanza, no apunta a UIDs ajenos).
- [ ] `pnpm --filter @booster-ai/api test` verde con la suite de `harden-demo-accounts.test.ts` migrada; coverage ≥80% en líneas tocadas.
- [ ] `pnpm typecheck` 0 errores (sin imports colgantes; el CLI wrapper `.mjs` sigue resolviendo).
- [ ] Documento de decisión "no reescribir historial" + checklist confirmación-demo + registro de rotación/invalidación Firebase versionados en este directorio (`decision-historial.md`).
- [ ] Nota junto a ADR-053 (NO se edita ADR-053; ver §4 sobre forma) que enlaza este spec y deja el rastro de superación de la constante hardcoded.

## 4. ¿Necesita ADR?

**No un ADR nuevo.** Justificación:

- ADR-053 ya es la decisión cerrada que originó los `OLD_DEMO_UIDS` (retire+recreate post-disclosure). F2 **no cambia esa decisión**: las UIDs ya fueron retiradas; solo movemos su *representación* (literal → env validada) sin alterar la política de seguridad ni introducir dependencia estructural nueva.
- Las reglas de "cuándo escribo un ADR" (CLAUDE.md) aplican a: nueva dependencia major, cambio de patrón multi-módulo, desvío del stack ADR-001. Mover 4 literales a una env Zod ya existente como patrón (precedente `BILLING_EXPORT_TABLE`, audit P0-D) no califica.
- **Forma elegida**: una **nota de seguimiento** en `docs/adr/053-post-disclosure-account-replacement.md` bajo "Notes for future-self" (sección ya existente, líneas 76-80; agregar bullet **NO** reescribe la decisión — es nota, no edición de la Decision/Consequences) **o**, si se prefiere no tocar el ADR, en `.specs/p0c-uids-demo-secret-manager/decision-historial.md` con backlink. **Decisión propuesta**: bullet en "Notes for future-self" del ADR-053 (es el lugar que el propio ADR designó para "si patrón demo se replica … aplicar mismo template") + el documento de decisión en este directorio. **Open question O-A** para el PO: ¿acepta tocar ADR-053 solo en "Notes for future-self", o exige que la nota viva exclusivamente en `.specs/`?

## 5. User-visible behaviour

| Actor | Antes | Después |
|---|---|---|
| Operador que corre el CLI (`harden-demo-accounts.mjs --retire-old-batch`) | La lista de 4 UIDs viene hardcoded en el binario `dist/` | Debe exportar `DEMO_OLD_UIDS` (env) antes de correr; sin ella, el batch es no-op y loguea warn explícito |
| Runtime del API (`apps/api`) | `OLD_DEMO_UIDS` literal compilado, no validado | `DEMO_OLD_UIDS` opcional validada en startup; malformada → server rehúsa arrancar (fail-fast `parseEnv`) |
| Lector del repo / clon nuevo | Ve 4 Firebase UIDs reales en `src/` | No hay UIDs en `src/` ni en `scripts/`; solo en `docs/adr/053` (contexto histórico) y git history (no reescrito) |
| Auditor de seguridad | P0-C abierto (PII en código vivo) | P0-C cerrado en HEAD + commits futuros; residual de historial documentado y aceptado |

**Sin cambios** en endpoints HTTP, UI, ni schema de BD. No hay migración Drizzle.

## 6. Out of scope

- **Reescritura del historial git** (decisión PO 2026-06-17, plan padre §5/§9): no se hace `filter-repo`/force-push. Rompe PRs abiertos (#425-428, #485-491) e invalida clones. El fix aplica a HEAD + futuros commits.
- **Secret Manager para estos UIDs**: el PO definió **env var, no necesariamente Secret Manager**, por ser cuentas demo ya deshabilitadas. (Si la confirmación-demo del §7 fallara y resultaran reales → ver siguiente bullet.)
- **Escalamiento como incidente si los UIDs resultaran reales**: queda fuera de este spec. Si la confirmación del equipo concluye que NO son demo, se abre incidente separado con ventana planificada (plan padre §5: "se trata como incidente separado").
- **Rotar/invalidar `seed-demo.ts` o las 4 UIDs *nuevas* (`demo-2026-*`)**: F2 solo trata las 4 UIDs *viejas* de ADR-053. La gestión de las nuevas sigue por `--recreate`/`--renew` existentes, sin cambios.
- **Tocar el literal `BoosterDemo2026!` en git history** (residual R-LIT-HIST de ADR-053): ya aceptado en su momento; no se reabre.
- **Migrar `DEMO_ACCOUNT_PASSWORD_*` o `DEMO_SEED_PASSWORD`**: ya están en Secret Manager (Sprint 1 T8); fuera de F2.

## 7. Documento de decisión + checklist (entregable obligatorio)

Se versiona `.specs/p0c-uids-demo-secret-manager/decision-historial.md` con:

**7.1 Decisión "no reescribir historial"**
- Cita la decisión PO del plan padre (§5 + §9: rechazado `filter-repo`, costo desproporcionado para UIDs demo ya deshabilitados).
- Documenta el residual aceptado: los 4 UIDs permanecen en git history (commits `9a063fe`…/PR #206) y en `docs/adr/053`. Alineado con el residual R-LIT-HIST que el propio ADR-053 ya aceptó para el password.
- Fija el alcance del fix: HEAD + commits futuros.

**7.2 Checklist confirmación-demo (instrucción PO — ejecutar ANTES de cerrar)**
- [ ] Confirmar con el equipo que los 4 UIDs corresponden a cuentas **demo** y no a usuarios reales. Evidencia textual ya en código (`// demo-shipper viejo`, `// demo-stakeholder viejo`, `// demo-carrier viejo`, `// conductor viejo`, `harden-demo-accounts.ts:34-37`) + ADR-053 (emails `demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com`, `drivers+123456785@boosterchile.invalid`). El spec los **trata como demo**; el checklist es la firma del equipo confirmándolo.
- [ ] Verificar en Firebase Admin (consola o `firebase auth:export`) que los 4 UIDs están `disabled: true` (se espera SÍ — el one-shot de ADR-053 ya corrió 2026-05-25; evidencia en `.specs/sec-001-cierre/sprint-2a-evidence/t4-one-shot-retire.md`).

**7.3 Rotación/invalidación en Firebase (registro)**
- [ ] Si por cualquier razón alguna de las 4 estuviera aún `disabled: false`: correr `node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch` con `DEMO_OLD_UIDS` exportada (dry-run primero), y registrar el resultado (`retired`/`skippedAlreadyDisabled`).
- [ ] Anotar fecha/operador/resultado de la verificación en `decision-historial.md`.

**7.4 Camino si resultaran reales (escalamiento)**
- [ ] Si la confirmación-demo del §7.2 falla → **detener F2**, no mergear el cierre de PII como "demo", y abrir incidente separado (fuera de scope, §6).

## 8. Constraints

- **Stack Booster no-negociable** (CLAUDE.md): zero `any`, Zod en boundaries (env vars → Zod al startup), `@booster-ai/logger` (no `console.*`), coverage ≥80% en código nuevo, Conventional Commits con scope (`fix(auth):` o `chore(security):`), sección `## Evidencia` en el PR.
- **TDD obligatorio** (`tdd-dominio-critico`): toca `auth` / cuentas Firebase → red→green→refactor, tests antes del cambio.
- **El service module NO puede importar `config.ts`**. Razón verificada: el CLI wrapper `apps/api/scripts/harden-demo-accounts.mjs:50-55` importa el service desde `../dist/services/harden-demo-accounts.js` y corre **standalone** seteando solo `FIREBASE_PROJECT_ID`, `DATABASE_URL` y los `DEMO_ACCOUNT_PASSWORD_*`. NO setea `SERVICE_NAME`, `CORS_ALLOWED_ORIGINS`, `API_AUDIENCE`, etc. Si el service hiciera `import { config }` desde `config.ts`, `parseEnv` (que llama `process.exit(1)` ante env incompleta — `packages/config/src/parseEnv.ts:24-44`) **mataría el CLI**. → El service debe leer/recibir `DEMO_OLD_UIDS` **sin** acoplarse al schema completo del API. Precedente directo: `getPasswordForPersona` (`harden-demo-accounts.ts:81-98`) y `getDemoPasswordForPersona` (`seed-demo.ts:161-163`) leen `process.env[...]` directo por esta misma razón documentada (`harden-demo-accounts.ts:75-80`).
- **Naming bilingüe** (CLAUDE.md): env var en `SCREAMING_SNAKE_CASE` → **`DEMO_OLD_UIDS`**. Identifier TS en inglés camelCase → la función parser `parseDemoOldUids` y/o la export `getDemoOldUids`. Los UIDs no son SQL, no aplica snake_case español.
- **Formato de UID Firebase**: `/^[A-Za-z0-9]{20,}$/` (los 4 UIDs reales son alfanuméricos de 28 chars — verificado). Firebase UIDs son ≤128 chars; usar `{20,128}` como cota superior opcional para no aceptar basura arbitrariamente larga. **Open question O-B**: ¿CSV o JSON array para el valor de la env? Propuesta por defecto: **CSV** (consistente con `API_AUDIENCE`, `CORS_ALLOWED_ORIGINS`, `BOOSTER_PLATFORM_ADMIN_EMAILS` que ya usan `s.split(',')` en `config.ts`); no hay comas dentro de un UID, así que CSV es seguro y más simple que JSON.
- **No tocar archivos prohibidos sin permiso** (CLAUDE.md): el ADR-053 NO se reescribe; solo se le agrega (si el PO aprueba O-A) un bullet en "Notes for future-self" — y eso requiere aprobación explícita por ser `docs/adr/*`. Por defecto la nota vive en este directorio hasta tener esa aprobación.
- **`dist/` es artefacto de build**: no se edita a mano; se regenera con `pnpm --filter @booster-ai/api build`. El grep de success criteria excluye `dist/`.

## 9. Approach

### 9.1 Cambio en el service (`apps/api/src/services/harden-demo-accounts.ts`)

1. **Eliminar** la constante literal `OLD_DEMO_UIDS` (líneas 33-38) y su `export`.
2. **Añadir** un parser Zod self-contained (mismo módulo o helper hermano), p.ej.:
   ```ts
   const firebaseUidSchema = z.string().regex(/^[A-Za-z0-9]{20,128}$/, 'Firebase UID inválido');
   const demoOldUidsSchema = z
     .string()
     .optional()
     .transform((s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean))
     .pipe(z.array(firebaseUidSchema));
   export function getDemoOldUids(source: NodeJS.ProcessEnv = process.env): string[] {
     return demoOldUidsSchema.parse(source.DEMO_OLD_UIDS);
   }
   ```
   (Naming y forma exactas se fijan en el plan; el contrato es: env ausente/"" → `[]`; malformada → throw Zod.)
3. **`retireOldBatch`** acepta los UIDs de **una de dos formas** (a decidir en el plan, **Open question O-C**):
   - **(C-1, recomendada)**: nuevo campo opcional en `HardenOpts` → `oldUids?: readonly string[]`. El service usa `opts.oldUids ?? getDemoOldUids()`. Tests inyectan `oldUids` directamente (no dependen de `process.env`); el CLI pasa `getDemoOldUids()`. Mantiene el service testeable y desacoplado, consistente con el resto de `HardenOpts`.
   - **(C-2)**: `retireOldBatch` llama `getDemoOldUids()` internamente; tests usan `vi.stubEnv('DEMO_OLD_UIDS', ...)`. Más acoplado a env global.
   - Recomendación: **C-1** (inyección por opts) — más limpio, no toca `process.env` global en tests, y el `noop`/empty-list path se prueba pasando `oldUids: []`.
4. **No-op seguro**: si la lista resuelta es `[]`, `retireOldBatch` loguea `warn` ("DEMO_OLD_UIDS ausente/vacía — nada que retirar; no-op") y retorna `{ retired: 0, skippedAlreadyDisabled: 0, failed: [] }` sin llamar al SDK ni a la DB.

### 9.2 Cambio en `config.ts` (runtime del API)

5. Añadir `DEMO_OLD_UIDS` al `apiEnvSchema` (`apps/api/src/config.ts`) como **opcional + validada**, replicando el patrón de transform→array de `API_AUDIENCE`/`BOOSTER_PLATFORM_ADMIN_EMAILS` con el regex de UID. Esto da el fail-fast al startup del API aunque el service consuma su propia función (defensa en profundidad + un solo lugar documentado para el formato). El valor de `config.DEMO_OLD_UIDS` es el que el runtime del API podría inyectar como `opts.oldUids` si alguna ruta/cron del API necesitara `retireOldBatch` (hoy solo lo usa el CLI; mantener `config` declarado evita drift futuro).

### 9.3 Cambio en el CLI wrapper (`apps/api/scripts/harden-demo-accounts.mjs`)

6. Leer `DEMO_OLD_UIDS` (vía `getDemoOldUids()` exportada desde `dist/`, o parseo inline equivalente) y pasarla a `retireOldBatch({ ..., oldUids })`. Actualizar el bloque "Env vars requeridos" del `--help` (líneas 88-93) para listar `DEMO_OLD_UIDS` (CSV de los 4 UIDs viejos). Si está ausente, el CLI debe **avisar explícitamente** ("DEMO_OLD_UIDS no seteada — `--retire-old-batch` será no-op") y salir limpio, no fingir éxito.

### 9.4 Tests (`apps/api/src/services/harden-demo-accounts.test.ts` + posible `*.config`/setup)

7. Migrar los tests existentes de `retireOldBatch` (líneas 315-396) que hoy dependen de `import { OLD_DEMO_UIDS }`: pasarán a usar una constante de test local (4 UIDs *de prueba*, NO los reales — p.ej. `['demoUidA00000000000000000', ...]`) inyectada vía `oldUids`. Añadir los tests nuevos del §10.
8. `test/setup.ts`: añadir `process.env.DEMO_OLD_UIDS ??= '...'` solo si se elige C-2 o si algún test del runtime del API lo necesita; con C-1 los tests del service no lo requieren.

### 9.5 Entregables de documentación

9. `decision-historial.md` (§7). Nota ADR-053 condicionada a O-A.

## 10. Test list (TDD — escribir primero)

**Grupo A — parser de la env (`getDemoOldUids` / `demoOldUidsSchema`)**
1. CSV de 4 UIDs válidos (`/^[A-Za-z0-9]{20,128}$/`) → array de 4 strings en orden.
2. Env **ausente** (`undefined`) → `[]` (no lanza).
3. Env **vacía** (`""`) → `[]` (no lanza).
4. CSV con espacios (`" uidA , uidB "`) → `["uidA","uidB"]` (trimmed).
5. CSV con entrada malformada (UID con `-`, o `<20` chars, o `@`) → **throw** Zod (no la acepta).
6. CSV con un elemento vacío entre comas (`"uidA,,uidB"`) → filtra el vacío → `["uidA","uidB"]`.

**Grupo B — `config.ts` rechaza arranque con env inválida** (defensa en profundidad runtime API)
7. `DEMO_OLD_UIDS` malformada en el entorno → `parseEnv(apiEnvSchema)` falla → `process.exit(1)` (test patrón `parseEnv.test.ts`/`gcp-config-invariants`: `expect(() => parseEnv(schema, badSource)).toThrow()` con `process.exit` stubeado).
8. `DEMO_OLD_UIDS` ausente → `config` arranca OK, `config.DEMO_OLD_UIDS === []`.
9. `DEMO_OLD_UIDS` CSV válida → `config.DEMO_OLD_UIDS` = array de N UIDs.

**Grupo C — `retireOldBatch` aplica el hardening igual que antes** (paridad con tests existentes 315-396, ahora con UIDs inyectados de prueba)
10. 4 UIDs de prueba activos (`disabled:false`) provistos vía `oldUids` → `retired: 4`, `skippedAlreadyDisabled: 0`, `failed: []`, `updateUser` llamado 4 veces. (migra test línea 316)
11. Partial-recovery: 2 ya `disabled` + 2 activos → `retired: 2`, `skippedAlreadyDisabled: 2`, `updateUser` 2 veces. (migra línea 334)
12. dry-run: 4 activos → `retired: 4` simulado, **cero** `updateUser`/`update` DB. (migra línea 357)
13. UID inexistente → `failed` con `reason: 'not_found'`, el batch continúa con los demás. (migra línea 375)

**Grupo D — lista vacía / ausente → no-op seguro**
14. `oldUids: []` (o `DEMO_OLD_UIDS` ausente en modo C-2) → `retireOldBatch` retorna `{ retired:0, skippedAlreadyDisabled:0, failed:[] }`, **no** llama `getUser`/`updateUser`/`update`, loguea `warn` de no-op.
15. `oldUids` con UIDs válidos pero el SDK los reporta todos `not_found` → `failed.length === N`, sin throw (no rompe el batch). (cubre robustez del no-op vs. ausencia real)

**Grupo E — verificación de extracción (regresión de seguridad)**
16. Test/aserción de repo (puede ser un check de grep en CI o un test unit que importa el módulo y verifica que `OLD_DEMO_UIDS` ya **no** se exporta): `expect((harden as Record<string,unknown>).OLD_DEMO_UIDS).toBeUndefined()`. Garantiza que la constante no volvió.

> Total casos de test: **16**.

## 11. Open questions (para el PO)

- **O-A**: ¿Se acepta agregar un bullet en "Notes for future-self" de `docs/adr/053-*.md` (no edita la Decision), o la nota debe vivir **solo** en `.specs/p0c-uids-demo-secret-manager/decision-historial.md`? (toca archivo `docs/adr/*` → requiere permiso explícito CLAUDE.md). Default propuesto: nota en `.specs/` + backlink; tocar ADR-053 solo con tu OK.
- **O-B**: Formato de `DEMO_OLD_UIDS` → **CSV** (default propuesto, consistente con `API_AUDIENCE`) vs JSON array. ¿Confirmas CSV?
- **O-C**: Inyección de UIDs en `retireOldBatch` → **C-1 (campo `oldUids` en `HardenOpts`)** (recomendado) vs C-2 (lee `process.env` interno). ¿Confirmas C-1?
- **O-D (confirmación-demo)**: ¿Confirma el equipo que los 4 UIDs son demo (no usuarios reales)? Evidencia fuerte de que SÍ (comentarios + emails demo + ya `disabled`). Si la respuesta fuera "no/incierto" → se detiene F2 y se escala como incidente (§7.4).
- **O-E**: ¿Dónde se setea `DEMO_OLD_UIDS` para el runtime del API en prod? Propuesta: **no se setea en Cloud Run** (el API no llama `retireOldBatch` hoy; queda `[]` → no-op) y solo se exporta puntualmente en la sesión del PO al correr el CLI. ¿De acuerdo, o prefieres dejarla en el env del Cloud Run para futura automatización?

## 12. Risks

| ID | Riesgo | L | I | Mitigación |
|---|---|---|---|---|
| R-1 | El service termina importando `config.ts` y rompe el CLI standalone (`process.exit(1)` por env incompleta) | M | H | Constraint §8 explícito + precedente `getPasswordForPersona`; opción C-1 inyecta por `opts`, sin import de config |
| R-2 | Tests siguen acoplados a `OLD_DEMO_UIDS` importado → no compilan tras eliminar la const | H | M | Migrar tests a UIDs de prueba inyectados (Grupo C); test E asegura que la const no reaparece |
| R-3 | El `.mjs` corre contra `dist/` desactualizado y no encuentra `getDemoOldUids` | M | M | Recordar `pnpm --filter @booster-ai/api build` antes de correr el CLI; documentarlo en `--help` |
| R-4 | Confirmación-demo falla → eran reales | L | H | Checklist §7.2 + camino de escalamiento §7.4; no se cierra P0-C como "demo" sin firma |
| R-5 | Falso sentido de cierre: el grep pasa pero el UID sigue en `dist/`/history | M | M | Success criteria acota el grep a `apps/api/src` + `scripts`; documenta residual de history (aceptado) |
| R-6 | `[]` no-op enmascara una mala config en prod (operador olvidó exportar la env) | M | M | El CLI avisa explícitamente "no-op por env ausente" y no finge éxito (no swallow) |

## 13. Alternatives considered

- **Secret Manager en vez de env var**: rechazado por el PO para este caso (UIDs demo ya deshabilitados, no son secreto activo). Env var validada es proporcional. (Si fueran reales → incidente separado, no este spec.)
- **Reescribir historial (`git filter-repo`)**: rechazado por el PO (plan padre §9) — rompe PRs abiertos #425-428/#485-491 e invalida clones; costo desproporcionado para UIDs demo deshabilitados.
- **Importar `config` en el service**: rechazado — acopla el service al schema completo del API y mata el CLI standalone (R-1). Se usa lectura/inyección self-contained (precedente `getPasswordForPersona`).
- **Borrar `OLD_DEMO_UIDS`/`retireOldBatch` por completo** (el one-shot ya corrió): rechazado — el batch sigue siendo la herramienta idempotente de re-verificación/retiro; conservarla con UIDs por env es más seguro que perder la capacidad operativa.
- **JSON array en la env**: viable pero más verboso; CSV basta porque no hay comas en un UID (O-B).

## 14. Approval

- [ ] **PO aprueba este spec** (chat o comentario sobre este archivo).
- [ ] PO resuelve O-A..O-E (o delega los defaults propuestos).
- [ ] PO confirma el resultado del checklist confirmación-demo (§7.2) — gate para cerrar P0-C como "demo".

**Pendiente de firma — fecha:** ____________
