# Booster AI — Pasada 3: Test Quality + Cobertura

> **Fecha**: 2026-05-15
> **Auditor**: Claude
> **Scope**: Cobertura real, distribución de tests por workspace, Prove-It anti-pattern, tests skipped, tests menores a 30 LOC, mocking excesivo, ausencia de integration tests, surfaces críticas sin test.
> **Estado del repo**: `main` (b9f7b08, 2026-05-14).
> **Naturaleza**: análisis estático del código de tests + estructura. **Cobertura runtime no medida** (ver §0).

---

## 0. Cobertura runtime — NO MEDIDA (gap)

Intenté correr `pnpm test:coverage` en este worktree. Falló:

```
sh: turbo: command not found
ELIFECYCLE  Command failed.
WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

El worktree no tiene `node_modules/` instalado (worktrees suelen compartir node_modules del repo principal pero acá no aplicó). **`pnpm install` no es accion read-only** — escribe ~600 MB de deps + lockfile changes — y no fue autorizado en el alcance de esta pasada.

**Métrica real de coverage = NO MEDIDA en este pase**. Para obtenerla hay tres rutas:

1. Correr `pnpm install && pnpm test:coverage` en el worktree (autorizado por usuario).
2. Leer `coverage-summary.json` de un workspace donde ya se haya corrido (no detecté ninguno).
3. Mirar la última corrida de CI: GitHub Actions `ci.yml` produce coverage; el artefacto debería estar en el último run merge.

Todo lo siguiente es **análisis estático del código de tests**, no medición de % cobertura.

---

## 1. Distribución de tests por workspace

Conteo `*.test.{ts,tsx}` vs archivos productivos `.{ts,tsx}` (excluyendo `*.test.*`, `node_modules`):

| Workspace | Archivos src | Archivos test | Ratio test/src |
|---|---:|---:|---:|
| `apps/api` | 88 | 78 | **0.89** ✓ |
| `apps/web` | 114 | 96 | **0.84** ✓ |
| `apps/whatsapp-bot` | 8 | 6 | 0.75 |
| `apps/telemetry-processor` | 6 | 4 | 0.67 |
| `apps/telemetry-tcp-gateway` | 5 | 4 | 0.80 ✓ |
| `apps/sms-fallback-gateway` | 4 | 2 | 0.50 |
| `packages/shared-schemas` | 36 | 5 | **0.14** ⚠ |
| `packages/matching-algorithm` | 6 | 5 | 0.83 ✓ |
| `packages/carbon-calculator` | 13 | 9 | 0.69 |
| `packages/codec8-parser` | 8 | 5 | 0.63 |
| `packages/certificate-generator` | 9 | 2 | **0.22** ⚠ |
| `packages/coaching-generator` | 10 | 2 | **0.20** ⚠ |
| `packages/pricing-engine` | 4 | 2 | 0.50 |
| `packages/factoring-engine` | 4 | 2 | 0.50 |
| `packages/dte-provider` | 6 | 2 | **0.33** ⚠ |
| `packages/whatsapp-client` | 5 | 3 | 0.60 |
| `packages/driver-scoring` | 3 | 1 | 0.33 ⚠ |
| `packages/logger` | 3 | **0** | **0.00** ❌ |
| `packages/config` | 7 | **0** | **0.00** ❌ |
| `packages/ui-tokens` | 9 | **0** | **0.00** ❌ |
| `packages/notification-fan-out` | 1 | 1 | 1.00 ✓ |

**Hallazgos**:

- **3 packages con cero tests**: `logger`, `config`, `ui-tokens`. Todos infraestructurales:
  - `logger` es la **abstracción Pino** que toda la app usa para no escribir `console.*`. CLAUDE.md §7 dice "Toda PII se redacta en logs automáticamente via Pino serializers" — sin test esa garantía es palabra.
  - `config` es el parser Zod de env vars (fail-fast). Sin test, una regresión introduce env vars opcionales que en producción son undefined.
  - `ui-tokens` son design tokens — bajo riesgo runtime pero igual sin verificación.
- **`shared-schemas` 36 src vs 5 test (ratio 0.14)** — el **domain canónico** de toda la app. Es donde residen los Zod schemas de user/trip/vehicle/etc. Sin tests, refactors silenciosos rompen contratos client-server. Es el package más crítico del repo y tiene la cobertura más baja entre los implementados.
- **`certificate-generator` ratio 0.22 / `coaching-generator` 0.20 / `dte-provider` 0.33**: los tres tocan auditoría legal (Carta de Porte, DTE SII) o LLM output (coaching). Cobertura insuficiente para el peso regulatorio.

**Coverage de tests no = coverage de cobertura**. Un archivo con un único `expect(true).toBe(true)` cuenta como "tested". Esto es un proxy.

---

## 2. Tests <30 LOC — sospechosos de smoke-only

Solo 3 archivos:

- [apps/whatsapp-bot/src/routes/health.test.ts](apps/whatsapp-bot/src/routes/health.test.ts) — 24 LOC. Health endpoint test es trivial. **OK**.
- [apps/web/src/routes/__root.test.tsx](apps/web/src/routes/__root.test.tsx) — 28 LOC. Test del layout raíz. **Verificar** si solo monta o testea outlets/transitions.
- [packages/codec8-parser/test/crc16.test.ts](packages/codec8-parser/test/crc16.test.ts) — 28 LOC. CRC16 es operación pura simple; 28 LOC pueden ser suficientes para vectores conocidos. **Probablemente OK** pero conviene verificar.

**Veredicto**: distribución sana; no hay infestación de smoke tests vacíos.

---

## 3. Prove-It anti-pattern: tests con solo `toBeDefined` / `toBeTruthy`

CLAUDE.md (skill `31-test-driven-development`) prohíbe tests que solo verifiquen "el código compila". Anti-pattern detectado en 10 archivos (al menos un assert tipo `toBeDefined`/`toBeTruthy` presente — no implica que **todos** los asserts sean así):

- [apps/web/src/router.test.tsx](apps/web/src/router.test.tsx)
- [apps/web/src/components/ChileanPlate.test.tsx](apps/web/src/components/ChileanPlate.test.tsx)
- [apps/web/src/components/map/FleetMap.test.tsx](apps/web/src/components/map/FleetMap.test.tsx)
- [apps/web/src/hooks/use-reportar-incidente.test.tsx](apps/web/src/hooks/use-reportar-incidente.test.tsx)
- [apps/web/src/lib/firebase.test.ts](apps/web/src/lib/firebase.test.ts)
- [apps/web/src/routes/flota.test.tsx](apps/web/src/routes/flota.test.tsx)
- [apps/api/test/unit/dte-end-to-end.test.ts](apps/api/test/unit/dte-end-to-end.test.ts) ⚠ "end-to-end" en nombre + Prove-It pattern es bandera roja
- [apps/api/test/unit/get-public-tracking.test.ts](apps/api/test/unit/get-public-tracking.test.ts)
- [apps/api/test/unit/matching-service-v2.test.ts](apps/api/test/unit/matching-service-v2.test.ts) ⚠ matching v2 es algo en producción tras flag
- [apps/api/test/unit/calcular-metricas-viaje.test.ts](apps/api/test/unit/calcular-metricas-viaje.test.ts) ⚠ entra en GLEC v3 cert

**Acción**: revisar manualmente los 10. Si los `toBeDefined`/`toBeTruthy` son acompañados por asserts substantivos posteriores → OK. Si son el único check → re-escribir con asserts de valor real ("Prove-It pattern": verificar la transformación, no la existencia).

---

## 4. Tests skipped — 2 (ambos en mismo archivo)

- [apps/api/test/unit/seed-demo.test.ts:333](apps/api/test/unit/seed-demo.test.ts) — `it.skip('ensureMembership: ignora error 23505 (UNIQUE composite)', ...)`
- [apps/api/test/unit/seed-demo.test.ts:405](apps/api/test/unit/seed-demo.test.ts) — `it.skip('ensureMembership: re-throw si error no es 23505', ...)`

Ambos skipped sin GitHub issue linkeado en el comentario adyacente. Política CLAUDE.md §4: `// TODO` sin issue es drift; `it.skip` sin issue equivalentemente.

**Acción**: o se arregla el setup que los hace failed → enable, o se elimina el test si la ruta cambió, o se enlaza issue + razón en comentario.

Cero `it.todo`, cero `xit`.

---

## 5. Heavy mocking — 75 archivos usan `vi.mock`

75 de 230 archivos de test = **33% usa `vi.mock` para mockear deps**.

**Lectura**:
- Si los mocks son de boundaries externos (Firebase, KMS, GCS, Pub/Sub, fetch) → **legítimo y necesario**.
- Si los mocks son de packages internos (`@booster-ai/matching-algorithm`, `@booster-ai/pricing-engine`) → **anti-pattern**: testea contra mock, no contra implementación real. Es exactamente el riesgo que CLAUDE.md "memory feedback_testing" advierte ("se nos cae prod cuando los mocks pasan").

**No revisado exhaustivamente** qué mockean — pero 33% es alto. Una pasada manual de los 75 archivos puede revelar 5-10 candidatos a re-escribir contra el package real.

**Sample a inspeccionar primero** (cualquiera de los matching v2 tests, factory tests, etc.).

---

## 6. Integration tests — AUSENTES (0)

Búsqueda de directorio `test/integration/` o `integration/` en todo el repo: **0 resultados**.

Toda la suite es **unit**. Esto es coherente con el setup actual de Vitest pero **deja sin verificar**:

- HTTP boundary completo (Hono + Postgres + Firebase real).
- Pub/Sub end-to-end (publish → consume → persist).
- Drizzle migrations sobre Postgres real (las migrations corren en test setup pero contra el mismo schema una vez).

**Mitigación parcial existente**:
- `apps/web/e2e/` (Playwright) — cubre browser → backend pero contra mocks de Firebase a veces.
- ADR-? menciona la posibilidad de tests con Testcontainers o supabase-local.

**Acción**: añadir `apps/api/test/integration/` con Vitest + Testcontainers postgres para 3-5 paths críticos (auth, matching, certificate emission, DTE).

---

## 7. Surfaces críticas sin test colocado (cruza con quality.md §9)

Servicios y routes que tocan **auth + dinero + legal + LLM** sin sibling `.test.ts`:

| Path | Razón crítica | Status |
|---|---|---|
| [apps/api/src/services/emitir-certificado-viaje.ts](apps/api/src/services/emitir-certificado-viaje.ts) | KMS sign + GCS — certificado huella carbono (GLEC) | sin test |
| [apps/api/src/services/consent.ts](apps/api/src/services/consent.ts) | Gates de consent stakeholder (ADR-028) | sin test |
| [apps/api/src/services/gemini-client.ts](apps/api/src/services/gemini-client.ts) | Llamadas LLM con PII en prompts (billing + privacy) | sin test |
| [apps/api/src/services/estimar-distancia.ts](apps/api/src/services/estimar-distancia.ts) | Distancia → pricing + emisiones | sin test |
| [apps/api/src/routes/me-clave-numerica.ts](apps/api/src/routes/me-clave-numerica.ts) | Set/rotate clave universal auth (ADR-035) | sin test |
| [apps/api/src/routes/feature-flags.ts](apps/api/src/routes/feature-flags.ts) | Decide qué UI renderiza el cliente | sin test |
| [apps/api/src/routes/admin-cobra-hoy.ts](apps/api/src/routes/admin-cobra-hoy.ts) | Aprobar adelantos (dinero al transportista) | sin test |
| [apps/api/src/routes/admin-seed.ts](apps/api/src/routes/admin-seed.ts) | Seed/cleanup demo (datos productivos en riesgo) | sin test |

CLAUDE.md skill `31-test-driven-development` dice: **"Mandatory for code paths affecting auth, money, or data integrity."** Las 8 entradas cumplen un al menos uno de los tres. Tener cero tests sibling **viola la política**.

(Verificar si hay test en otro path antes de declarar "sin cobertura": tools de import-graph lo confirmarían. Búsqueda manual con `grep -r "from.*emitir-certificado-viaje" apps/api/test/` mostraría sí o no.)

---

## 8. Tests del feature observability (rama feature, no main)

La rama `feat/security-blocking-hotfixes-2026-05-14` (ver inventory.md §11) añade **24 archivos de test nuevos** (14 backend + 9 frontend + 1 hook). El commit `ce0b508` reporta "coverage branches a 75%". Cuando se mergee a main, el ratio test/src del workspace `apps/api` y `apps/web` mejora.

No reflejado en el conteo actual (sólo main).

---

## 9. Configuración de coverage

[turbo.json](turbo.json) declara `test:coverage` con `outputs: ["coverage/**"]`. Vitest config esperado por workspace. [.github/workflows/ci.yml](.github/workflows/ci.yml) tiene el gate de coverage 80% bloqueante (verificado por la pasada de architecture §J).

**Confianza en el enforcement**: alta, condicionada a que el gate de CI esté operando sobre `coverage-summary.json` real. Verificación pendiente: revisar el último run de CI exitoso y confirmar los % por workspace.

---

## 10. Comparación con la política CLAUDE.md

| Política | Estado actual | Veredicto |
|---|---|---|
| "Sin features sin tests" (§1.4) | 8 surfaces críticas sin test sibling | **PARCIAL** |
| "Coverage 80% bloqueante en CI" | Gate existe en `ci.yml`; % real no medido en esta pasada | **NO MEDIDO** |
| "Tests TDD: red→green→refactor" (skill 31) | No verificable estáticamente | **n/d** |
| "Prove-It pattern" | 10 archivos con `toBeDefined/toBeTruthy` posibles violadores | **REVISAR** |
| "Integration tests obligatorios para money/auth/integrity" | 0 integration dirs en el repo | **AUSENTE** |
| "Mocks solo en boundaries externos" (memory feedback) | 33% archivos con vi.mock; sample no inspeccionado | **REVISAR** |

---

## Acciones priorizadas

| Prioridad | Acción | Esfuerzo |
|---|---|---|
| 1 (HIGH) | Añadir tests sibling a los 8 paths críticos de §7 (auth/money/legal/LLM) | 2-3d |
| 2 (HIGH) | Tests para los 3 packages con 0: `logger` (PII redact), `config` (env parse), `ui-tokens` (snapshot) | 1d |
| 3 (HIGH) | Levantar ratio test/src de `shared-schemas` 0.14 → ≥0.50 (domain canónico) | 1-2d |
| 4 (HIGH) | Resolver los 2 `it.skip` en `seed-demo.test.ts` | 1h |
| 5 (HIGH) | Correr `pnpm install && pnpm test:coverage` y reportar %s reales por workspace | 30min |
| 6 (MEDIUM) | Revisar los 10 archivos Prove-It pattern (§3) y reforzar asserts | 4h |
| 7 (MEDIUM) | Crear `apps/api/test/integration/` con Testcontainers postgres para auth, matching, cert | 1d |
| 8 (MEDIUM) | Auditar los 75 `vi.mock` para detectar mocking de packages internos | 4h |
| 9 (LOW) | Documentar política de mocks en `references/testing.md` (sólo boundaries externos) | 1h |

---

## Procedencia

- `find -type f -name '*.test.{ts,tsx}'` por workspace + `wc -l`.
- `grep -rl` para anti-patterns: `toBeDefined`, `toBeTruthy`, `vi.mock`, `it.skip`, `it.todo`.
- Cross-check con `quality.md §9` (surfaces sin colocación de tests).
- `pnpm test:coverage` intentado y fallido (no node_modules instalado) — documentado como gap.
- Sin lectura de archivos individuales de test; muestreo por nombres.
