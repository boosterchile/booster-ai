# spec — Extender `lint-rls` a `services/` y `jobs/` (+ raw SQL)

**Slug**: `lint-rls-services-jobs`
**Frente**: defensa-en-profundidad multi-tenant (deuda P2, §9.2 bitácora 16-17 jul)
**Origen**: censo multi-tenant 2026-07-14 (`informe.md`, veredicto B) + `rls-viabilidad.md` (recomendación **iii**: linter extendido primero; RLS como proyecto posterior).
**Alcance aprobado por el PO (2026-07-17)**: **A — completo** (incluye cobertura de raw SQL).
**Naturaleza**: solo tooling de CI + comentarios de allowlist. **Cero cambios de runtime, cero cambios de lógica de negocio.**

---

## 1. Contexto y motivación

`scripts/lint-rls.mjs` es el gate estático que impide que un PR agregue una query sin filtro `empresaId` (defense-in-depth contra IDOR cross-tenant, cierra ADR-028 §"Acciones derivadas §3"). Corre en CI vía `pnpm lint` → `biome check . && pnpm lint:rls`.

Hoy **solo escanea `apps/api/src/routes/`** (`lint-rls.mjs:28`). El censo verificó que `routes/` está limpio (0 findings) y que la capa `services/`/`jobs/` — que también accede a la DB — **no está cubierta por ninguna herramienta**: el aislamiento ahí depende de que cada ruta llamadora valide el tenant antes de pasar el id. Ese es el punto ciego que este cambio cierra.

`rls-viabilidad.md` descartó RLS de Postgres como primer paso (exigiría re-arquitecturar la capa de conexión: roles por servicio, GUC transaccional, FORCE en 25 tablas, ~19 políticas complejas sobre el flujo bilateral del marketplace). Extender el linter entrega **la misma clase de garantía** (ninguna query nueva sin filtro pasa CI) sobre el 100% del código de acceso a datos, sin tocar runtime.

## 2. Estado verificado (baseline, 2026-07-17, primera fuente)

- `pnpm lint:rls` sobre `routes/` → **✅ 0 findings** (verde).
- `services/`: **148 sitios** Drizzle `.from/.update/.delete`. `jobs/`: **2** Drizzle.
- raw SQL (`db.execute(sql\`…\`)` / `pool.query`): presente en ambas capas; conteo conservador local bajo, censo exhaustivo reportó ~19 en `services/` + ~16 en `jobs/`. **El número exacto se fija en T2 con el matcher ya extendido.**
- `scripts/lint-rls.mjs` **no tiene test co-located** (deuda que este PR cierra).
- `apps/api/src/db/schema.ts`: **39 `pgTable`** (insumo del fix-1).
- Ya existen **3** `// rls-allowlist:` en `services/jobs/`.

## 3. Diseño

### 3.1 Scope multi-directorio
La constante única `ROUTES_DIR` (`:28`) pasa a `SCAN_DIRS = [routes, services, jobs]` (rutas resueltas desde `apps/api/src/`). `walk()` se invoca por cada dir. Sin cambio de la mecánica de `scanFile`.

### 3.2 Matcher fix-1 — precisión por schema (elimina falsos positivos)
El regex `QUERY_RE` matchea `.from(ident` / `.update(ident` / `.delete(ident`, que colisiona con `Buffer.from(...)`, `Array.from(...)`, `Date.from`, etc. (clase de FP identificada en el censo §6).

Fix: extraer el **set de nombres de tablas Drizzle** de `schema.ts` (parseando `export const <ident> = pgTable(...)`, 39 tablas) y tratar un match como query **solo si `ident` ∈ ese set**. Un identificador que no es tabla del schema se ignora. Beneficia también a `routes/` (más señal, menos ruido).

Esto **reemplaza** la heurística implícita actual (que dependía de `TENANT_FREE_TABLES` como única lista): ahora hay un allowlist positivo (tabla real del schema) + el denylist de tenant-free.

### 3.3 Matcher fix-2 — cobertura de raw SQL (alcance A)
Agregar un segundo patrón para `db.execute(sql\`…\`)` y `pool.query(\`…\`)`. Para estos, el "nombre de tabla" no sale de un identificador JS sino del texto SQL; la estrategia:
- Detectar el bloque raw (tagged template `sql\`…\`` dentro de `execute(`/`query(`).
- Buscar en el cuerpo del SQL las tablas tenant-scoped (por su **nombre SQL** snake_case, ej. `vehiculos`, `viajes`, `membresias`) y, si aparece una, exigir en la misma ventana un token de filtro tenant (`empresa_id`, etc.) **o** una allowlist.
- Los jobs de sistema con pg crudo multi-tabla (ej. `merge-duplicate-users`, `reap-*`, `purgar-posiciones-movil`) se resuelven con `// rls-allowlist:` (son BYPASSRLS-por-diseño, ya inventariados en `rls-viabilidad.md` §2D/§3).

Requiere un segundo mapa nombre-SQL→tabla derivado de `schema.ts` (el primer argumento de `pgTable('<sql_name>', …)`).

### 3.4 `TENANT_FREE_TABLES` +4
Agregar con razón documentada: `solicitudesRegistro` (pre-tenant, signup), `matchingBacktestRuns` (admin/global), `empresas` (raíz del tenant, no se auto-filtra), `membershipTiers` (catálogo). (Confirmado por censo §1 y §6.)

### 3.5 Anotaciones `// rls-allowlist:`
Aplicar el inventario ya levantado por el censo — **no es descubrimiento, es transcripción con criterio**:
- **Drizzle en `services/`** (~28): pipeline "scoped-por-id-validado" (métricas/score/certificado/coaching/liquidación derivan tenant del `tripId`/`assignmentId`/`vehicleId` ya validado) — censo §2 nota C y §3.
- **Raw SQL en `services/`+`jobs/`** (~19+16): jobs de sistema, crons, tracking público por token, matching cross-empresa — `rls-viabilidad.md` §2 y §3.

Cada anotación lleva razón breve + referencia (ADR/línea del censo) cuando aplique. Toda query legítimamente cross-tenant que hoy no tenga token de filtro se marca; ninguna se "arregla" agregando filtros falsos.

### 3.6 Tests (`scripts/lint-rls.test.mjs`, nuevo)
Cubrir la lógica nueva con **rojo exhibido**:
- Regresión: una query Drizzle sin filtro en un fixture `services/` → el linter falla (exit 1) con la firma exacta.
- Fix-1: `Buffer.from(x)` no genera finding (no es tabla del schema).
- Fix-2: `db.execute(sql\`SELECT … FROM vehiculos …\`)` sin filtro → finding; con `empresa_id` → limpio; con allowlist → limpio.
- Tenant-free: query a `empresas`/`planes` → limpio.
- Allowlist comment respetado en ventana −10/+30.
Coverage ≥ umbral de `scripts/repo-checks` (80/75/80/80; el linter vive en `scripts/` raíz, se le da su `vitest` o se integra al de repo-checks — decisión menor de T5).

## 4. Criterios de éxito (contrato)

1. `pnpm lint:rls` escanea `routes/` + `services/` + `jobs/` (Drizzle **y** raw SQL) y termina en **0 findings** (verde) con todas las anotaciones aplicadas.
2. Test de regresión demuestra el **rojo**: query nueva sin filtro en `services/` (Drizzle o raw) rompe CI.
3. Los falsos positivos de `.from(` (Buffer/Array/Date) **no** generan findings (fix-1 verificado por test).
4. `pnpm lint` completo (Biome + lint:rls) pasa en verde en el PR.
5. Coverage del linter ≥ umbral de la casa; `pnpm typecheck` limpio.
6. **Cero** diffs en runtime: solo `scripts/lint-rls.mjs`, `scripts/lint-rls.test.mjs`, comentarios `// rls-allowlist:` en `services/`+`jobs/`, y (si aplica) un ajuste de config de test. Ningún cambio de lógica de negocio, ninguna query modificada salvo para agregar comentario.

## 5. Plan de tareas

- **T1** — Extender scope (`SCAN_DIRS`) + fix-1 (set de tablas del schema). Correr → capturar findings crudos de `services/`/`jobs/` Drizzle.
- **T2** — Fix-2 (raw SQL) + segundo mapa nombre-SQL. Correr → capturar findings raw. **Fija el conteo real** de sitios a anotar.
- **T3** — `TENANT_FREE_TABLES` +4.
- **T4** — Anotar todos los findings legítimos con `// rls-allowlist: <razón>` (Drizzle + raw), transcribiendo el inventario del censo con criterio; escalar al PO cualquier sitio que el censo **no** haya clasificado como legítimo (posible hallazgo real).
- **T5** — Tests (`lint-rls.test.mjs`) con rojo exhibido; dejar el linter en verde.
- **T6** — Evidencia: output de `pnpm lint:rls` verde, output del test (rojo→verde), `git diff --stat`. Actualizar `.specs/lint-rls-services-jobs/{verify,ship}.md`.

## 6. Riesgos y mitigaciones

- **Un finding no previsto por el censo** (query real sin filtro): es el escenario valioso. No se auto-anota; se **escala al PO** como posible IDOR (el linter estaría haciendo su trabajo). El censo predice 0, pero han pasado PRs desde el 14-jul.
- **Regex de raw SQL frágil** (tagged templates multilínea, SQL con joins): mitigado por tests con fixtures reales del repo; si un caso no es tratable por regex, se declara con allowlist explícita antes que ensuciar el matcher.
- **Ruido de anotación** (alcance A destapa ~35 sitios raw): aceptado por el PO; cada uno lleva razón. El grueso son jobs de sistema con patrón repetido.
- **Falso verde por token en ventana** (límite textual conocido, censo §"Límites honestos"): el linter es defensa-en-profundidad, no prueba semántica; se documenta, no se resuelve acá (AST = fuera de alcance).

## 7. Fuera de alcance

- RLS a nivel Postgres (proyecto posterior; este spec ES parte de sus prerrequisitos — `rls-viabilidad.md`).
- Análisis AST / verificación semántica de los filtros (el linter sigue siendo textual).
- **fix-2 detecta raw SQL solo con nombre de tabla LITERAL en el cuerpo**; raw SQL con nombre dinámico (ej. `jobs/merge-duplicate-users.ts:191`, un `client.query` con `UPDATE ${fk.table} ...` sobre tablas tenant-scoped) queda fuera del alcance del matcher textual, igual que el resto de límites no-AST. Es un punto ciego conocido, **no un `findings=0` que implique cobertura total**.
- Otros `apps/*` sin acceso a DB de tenant (notification-service, whatsapp-bot, matching-engine, eco-routing-service, sms-fallback-gateway, auth-blocking-functions) y `packages/*` — el censo los verificó sin acceso a DB de tenant.
- Cambiar cualquier query de negocio (solo se agregan comentarios).

## 8. Coordinación (no es parte del código, pero condiciona la ejecución)

Hay otra sesión de Claude Code activa en el mismo repo (frente de captura de ubicación / tracking, **PR #598 `fix/distancia-real-hibrida`**, telemetría). La implementación toca ~65 archivos → debe correr en **rama aislada** (`feat/lint-rls-services-jobs`) para no colisionar; en particular, las anotaciones en `apps/api/src/services/` de telemetría/tracking se dejan al final y se rebasa si #598 sigue abierto. El merge lo aprueba y ejecuta el PO (frontera: quality gate de CI).
