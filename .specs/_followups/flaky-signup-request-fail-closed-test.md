# Followup: flaky `signup-request-fail-closed.integration.test.ts` scenario 1

**Status**: Draft (stub, observación documentada — no urgente)
**Created**: 2026-05-26
**Triggered by**: PR #361 CI failure on first attempt + pass on rerun (no code changes between)

---

## Observación

El test `apps/api/test/integration/signup-request-fail-closed.integration.test.ts` scenario 1 (`Redis up → request 202; Redis stop → request 503 fail-closed + Retry-After:30`) falló intermitentemente en PR #361 (commit `435f281`, docs-only):

- **Primer attempt (run `26474081973`)**: FAIL en línea 110 con `AssertionError: expected +0 to be 1` — la query `SELECT count(*)::int FROM solicitudes_registro WHERE email = 'integration-failclosed@cliente.cl'` retornó 0 rows, esperaba 1.
- **Segundo attempt (`gh run rerun --failed`)**: PASS, 49s, sin code change entre runs.

Esto indica **flakiness**, no un bug real. Pasó en CI consistentemente durante PRs #355 (T9b shipping), #356, #357, #358, #359, #360 (5 corridas previas pasaron). Falló sólo en #361.

## Hipótesis del root cause

El test ejecuta esta secuencia:

```ts
const up = await app.request('/api/v1/signup-request', REQ);
expect(up.status).toBe(202);  // request 1, INSERT esperado

await container?.stop();
await wait(500);

const down = await app.request('/api/v1/signup-request', REQ);
expect(down.status).toBe(503);  // request 2, fail-closed

const rows = await dbHandle.pool.query<{ c: number }>(...);
expect(rows.rows[0].c).toBe(1);  // ← fail aquí: rows.rows[0].c === 0
```

El fail-mode "request 1 retornó 202 pero NO insertó row" sólo ocurre cuando el `submitSignupRequest` service ejecuta el shadow path (email ya existe en `users` table). Pero el email `integration-failclosed@cliente.cl` no se inserta en `usuarios` por ningún test conocido:

- T9b's beforeEach limpia solo `solicitudes_registro` (no `usuarios`).
- T9a usa email distinto (`integration-test-existing@cliente.cl`) y se ejecuta DESPUÉS de T9b en singleFork order (alphabetical: `signup-request-fail-closed` < `signup-request`).
- T9c (`signup-paths-negative`) es contract test, no DB writes.
- Sprint 1 / 2a tests no tocan ese email.

**Posibles causas residuales** (a investigar en sesión dedicada):

1. **Race condition `await app.request()` vs DB INSERT visibility**: el handler awaits el service que awaits el INSERT con `.returning({...})`. El Response se construye DESPUÉS del INSERT completo. PERO postgres MVCC podría reportar `count(*)` desde un snapshot anterior si el SELECT corre en una transacción separada que comenzó antes del COMMIT del INSERT.
2. **Pool connection reuse**: `dbHandle.pool` reusa conexiones; el SELECT al final puede usar una conexión que vio el snapshot pre-INSERT. Probable mitigation: `SELECT pg_advisory_xact_lock(0)` antes del SELECT para forzar sync.
3. **Container.stop() race con request 1 en flight**: improbable porque request 1 awaitea su Response antes de container.stop, pero podría haber fsync pendiente en pg pool si la conexión cerró antes del COMMIT (poco probable con drizzle's transaction wrapping).
4. **CI runner environmental flakiness**: load del runner GH Actions puede causar timing variation; `wait(500)` puede no ser suficiente cuando el runner está saturado.

## Reproducción

Difícil — el test pasó en 5 corridas previas y falló 1 vez de 1 (PR #361). Frecuencia aprox 1/6 = ~17% flake rate observed. Para reproducir local:

```bash
cd apps/api
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/test_integration \
  pnpm exec vitest run --config vitest.integration.config.ts \
  test/integration/signup-request-fail-closed.integration.test.ts \
  --repeat=20  # Run 20 times consecutively; expect 2-4 failures if flake rate ~17%
```

Cuando reproduzca, agregar logs structured para identificar:
- Que `request 1` realmente recibió 202 (estado intermedio).
- Que `service submitSignupRequest` ejecutó la rama `submitted` (no `shadowed`).
- Que el INSERT retornó `id` (línea `inserted[0]?.id`).
- Snapshot timing del SELECT vs INSERT COMMIT.

## Trigger (cuándo investigar)

Iniciar esta investigación cuando ocurra cualquiera de:

- Test falla 2 corridas consecutivas (no solo 1 — descartar transient runner load).
- Test falla en >25% de corridas (frecuencia inaceptable para signal SLI).
- Se modifica el código de `submitSignupRequest` o el module del rate-limit-signup middleware.

## Mitigaciones interim

Hasta investigar:

1. **`gh run rerun --failed`** en cualquier PR donde el test flakee. CI infra acepta rerun sin code change.
2. **NO marcar el test como `.skip`** — perdería SC-1.2.5 coverage.
3. **NO añadir retry intrínseco** al test (vitest `retry: 1`) — ocultaría el problema sin resolverlo.

## Diagnóstico 2026-06-22 (narrowing estático sin Docker — descarta candidatos)

No se pudo reproducir (los integration tests exigen Docker/testcontainers, ausente en el
entorno), pero la revisión estática del setup **descarta dos hipótesis**:

- **DESCARTADO — contaminación entre archivos**: `vitest.integration.config.ts` fuerza
  `fileParallelism: false` + `sequence.concurrent: false` → los archivos corren
  **serialmente, uno a la vez, un solo worker**. Aunque `createTestDb()` use una BD
  compartida (`TEST_DATABASE_URL`) y el `beforeEach` haga `DELETE ... LIKE 'integration-%'`,
  la ejecución serial impide que el cleanup de otro archivo borre filas mid-test.
- **DESCARTADO — handler responde antes del commit**: `signup-request.ts:43-46` hace
  `await submitSignupRequest(...)` ANTES del `return 202`; el `SELECT count` usa conexión
  fresca del pool (READ COMMITTED ve lo commiteado) → el row ES durable al volver 202.
- **Frontera real (requiere Docker)**: el timing del `container.stop()` mid-test en el
  Scenario 1 (ventana entre 202 → stop del container → 503) o el pool `max: 2` bajo el stop.
  Reproducir con `--repeat=20` + Docker y observar si el `count` falla a 0 (insert no visible)
  vs 2 (2º insert pese al 503). El fix depende de cuál sea — sin reproducir es una adivinanza.

## Referencias

- Test file: `apps/api/test/integration/signup-request-fail-closed.integration.test.ts`
- Service: `apps/api/src/services/signup-request.ts` `submitSignupRequest`
- Spec: `.specs/sec-001-cierre/spec.md` §3 H1.2 SC-1.2.5.
- Plan: `.specs/sec-001-cierre/plan-sprint-2b.md` T9b.
- Failed run: <https://github.com/boosterchile/booster-ai/actions/runs/26474081973/job/77954999902>
- Successful rerun: <https://github.com/boosterchile/booster-ai/actions/runs/26474081973/job/77955882454>
