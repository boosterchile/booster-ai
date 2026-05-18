# `@booster-ai/repo-checks`

Scripts de validación que corren en pre-commit hook + CI. Cada script es independiente, ESM, sin runtime deps fuera del stdlib de Node.

## Scripts

| Script | Propósito | Origen |
|---|---|---|
| `check-adr-numbering.mjs` | Detecta colisiones de número en `docs/adr/`. Soporta whitelist legacy. | Sprint S0 T3 |
| `drift-inventory.mjs` | Detecta drift entre `packages/shared-schemas/src/domain/` (Zod) y `apps/api/src/db/schema.ts` (Drizzle pgEnum). | Sprint S1a T1.1 (ADR-043) |
| `spec-canonical-drift.mjs` | Detecta drift entre listas canónicas en specs markdown (anotadas) y sus definiciones source-of-truth en código (Drizzle pgEnum o Zod z.enum). | Sprint S2 — Hallazgo H-S1a-2 |

---

## `spec-canonical-drift` — annotation convention

### Format

```markdown
<!-- canonical-source: <path>:<identifier> -->
- `value1`
- `value2`
- `value3`
```

- **HTML comment** en su propia línea, format exacto: `<!-- canonical-source: <path>:<identifier> -->`.
- **`<path>`**: ruta relativa al repo root del archivo fuente (`apps/api/src/db/schema.ts`, `packages/shared-schemas/src/domain/trip.ts`, etc.). Charset permitido: `[a-zA-Z0-9_./-]+`.
- **`<identifier>`**: nombre exportado del enum/schema en el archivo source (`tripStatusEnum`, `tripStateSchema`, etc.). Debe matchear identifier TS válido: `[a-zA-Z_$][a-zA-Z0-9_$]*`.
- **Bullets**: inmediatamente después del comment (líneas en blanco intermedias OK). Format estricto: `- \`value\`` (dash, espacio, backtick, valor, backtick). Indent leading OK (para bullets anidados bajo SCs).
- El listado de bullets termina en la primera línea que no matchea `^\s*-\s+\`...\`\s*$` (blank line, paragraph, etc.).

### Semantics — subset check

El script verifica que **cada bullet del spec exista en la fuente**. La fuente puede tener valores adicionales no listados.

**Por qué subset y no exact-match**: specs frecuentemente enumeran un **subset documentado** (e.g. "los 5 canonical states de la machine" sobre un enum SQL de 9 valores). Exact-match obligaría a listar todos los valores del enum aunque la spec solo refiera a algunos.

**Drift kinds reportados** por el script:

| Kind | Significado |
|---|---|
| `source-not-found` | El path en la annotation no existe en disco. |
| `identifier-not-found` | El path existe pero no contiene `export const <identifier>` con `pgEnum(...)` o `z.enum(...)`. |
| `no-bullets` | La annotation no es seguida por bullets parseables. |
| `value-not-in-source` | Un bullet del spec no existe en los valores del source — típicamente typo o rename pendiente. |

### Source types soportados (actuales)

- **Drizzle pgEnum**: `export const <id> = pgEnum('sql_name', ['v1', 'v2', ...]);`
- **Zod z.enum**: `export const <id> = z.enum(['v1', 'v2', ...]);`

### Extensión a otros source types

El parsing source vive en `extractSourceValues(sourceContent, identifier)`. Para agregar un nuevo source type (e.g. TS const arrays, `enum` declarations TS):

1. Agregar otra regex al fall-through chain en `extractSourceValues`.
2. Asegurar que la regex extrae los valores como strings sin comillas.
3. Agregar tests específicos del nuevo source type.

**Fuera de scope del PR original** (Hallazgo H-S1a-2): TS `enum` keyword, `as const` arrays, JSON sidecar files. Se agregan si surgen casos de uso concretos.

### Ejemplo real

Ver [`SC-S1.5` en `.specs/s1-drift-coverage-e2e/spec.md`](../../.specs/s1-drift-coverage-e2e/spec.md) para una aplicación viva (canonical states de la trip state machine vs `tripStatusEnum` SQL).

### CLI

```bash
# Default scan (.specs + docs):
node scripts/repo-checks/spec-canonical-drift.mjs

# Custom scan dirs:
node scripts/repo-checks/spec-canonical-drift.mjs --scan-dirs .specs,docs,custom

# Machine-readable output for CI:
node scripts/repo-checks/spec-canonical-drift.mjs --json

# Silent (no stdout); writes drift count to stderr if drift exists:
node scripts/repo-checks/spec-canonical-drift.mjs --quiet
```

**Exit codes**:
- `0` = no drift (incluye 0 annotations encontradas).
- `1` = drift detectado.
- `2` = error de uso (ningún scan dir existe).

### Integration

- **Pre-commit hook** (`.husky/pre-commit`): corre el script si hay cambios staged en `.specs/**/*.md`, `docs/**/*.md`, o en los source files típicos referenciados (`apps/api/src/db/schema.ts`, `packages/shared-schemas/src/domain/*.ts`). Latencia <2s en repo típico.
- **CI** (`.github/workflows/ci.yml`): job dedicado `spec-canonical-drift` que corre sobre el repo entero.

---

## Tests

Cada script tiene su `<name>.test.mjs` co-localizado.

```bash
cd scripts/repo-checks
pnpm test           # run all
pnpm test:coverage  # with v8 coverage report
pnpm typecheck      # TypeScript check (incluso si los scripts son .mjs)
```

**Coverage thresholds** (in `vitest.config.ts`):
- Global: 80/75/80/80 (lines/branches/functions/statements).
- `spec-canonical-drift.mjs`: 90/90/90/90 (más estricto, gate más reciente).
