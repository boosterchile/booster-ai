# Handoff — Continuación post-GLEC v3.0 (2026-05-05)

Documento de continuidad para retomar el trabajo después de la sesión del
2026-05-05 que cerró BUG-001..BUG-014, configuró CI/CD en GitLab, migró
forms a RHF y dejó `packages/carbon-calculator/` compliant con GLEC v3.0
+ empty backhaul allocation.

**Lectura para Claude (otro turno) o un humano que toma el trabajo.**

## TL;DR del estado actual

- ✅ **Repo en GitLab** (`boosterchile-group/booster-ai`), CI activo
  (`.gitlab-ci.yml` lint + typecheck + test + build), `only_allow_merge_if_pipeline_succeeds=true`.
- ✅ **Todos los fixes del playbook QA cerrados** (BUG-001..BUG-014). Ver
  los 16 MRs mergeados (!1–!16) en `git log main`.
- ✅ **`packages/carbon-calculator/`** implementa GLEC v3.0 + IPCC AR6 +
  empty backhaul allocation (§6.4). API pura, 44/44 tests verde.
- ⏳ **El empty backhaul aún no llega al certificado del cliente** porque
  los 5 pasos de integración están pendientes. Ver §1 abajo.
- ⏳ Infra CI tiene gaps: E2E, security, coverage gate (§2).
- ⏳ Algunos pendientes cosméticos / housekeeping (§3).

## Cómo arrancar la nueva sesión

```bash
cd /Volumes/Pendrive128GB/Booster-AI
git checkout main
git pull origin main
git log --oneline -20   # ver el contexto reciente
```

Lectura recomendada antes de tocar código:

1. [docs/adr/021-glec-v3-compliance.md](../adr/021-glec-v3-compliance.md)
   — decisión arquitectónica del calculator, plan de despliegue T+0..T+4.
2. [docs/research/013-glec-audit.md](../research/013-glec-audit.md) —
   auditoría con citas a GLEC, IPCC, DEFRA, ICCT, ISO 14083.
3. [docs/adr/020-ci-cd-strategy.md](../adr/020-ci-cd-strategy.md) — por
   qué usamos GitLab.com shared runners y criterio de migración.
4. [CLAUDE.md](../../CLAUDE.md) — contrato de trabajo del agente.

## §1 — Pendientes críticos: empty backhaul end-to-end

El módulo `calcularEmptyBackhaul()` está listo en código pero su valor
solo llega al cliente cuando estos 5 pasos estén cerrados. Plan de
despliegue T+0..T+4 semanas en ADR-021.

### 1.1 Schema migration `metricas_viaje` (BLOQUEANTE para los siguientes)

**Branch sugerida**: `feat/013a-schema-empty-backhaul`

Agregar 3 columnas nuevas a `metricas_viaje`:

```sql
ALTER TABLE metricas_viaje
  ADD COLUMN factor_matching_aplicado DECIMAL(3, 2),
  ADD COLUMN emisiones_empty_backhaul_kgco2e_wtw DECIMAL(10, 3),
  ADD COLUMN ahorro_co2e_vs_sin_matching_kgco2e DECIMAL(10, 3);
```

- Drizzle migration nueva en `apps/api/src/db/migrations/`.
- Actualizar el Drizzle schema en `apps/api/src/db/schema.ts` (tabla `metricas_viaje`, mantener naming snake_case en SQL).
- Tipos derivados llegan automáticamente vía `$inferSelect` / `$inferInsert`.
- **Riesgo**: bajo. Columnas nuevas nullable, sin re-write de existentes.

**Estimación**: 30 min.

### 1.2 Servicio orquestador pasa `backhaul` al calculator

**Branch sugerida**: `feat/013b-servicio-empty-backhaul`

`apps/api/src/services/calcular-metricas-viaje.ts` debe consultar al
matching engine para obtener el `factorMatching` real del viaje y
pasárselo al calculator:

```ts
const factorMatching = await matchingEngine.getReturnMatchingRatio(tripId);
const result = calcularEmisionesViaje({
  metodo: 'modelado',
  // ...
  backhaul: factorMatching != null
    ? { distanciaRetornoKm: trip.distanciaKm, factorMatching }
    : undefined,
});

// Persistir los nuevos campos:
await db.insert(metricasViaje).values({
  // ... campos existentes
  factorMatchingAplicado: result.backhaul?.factorMatchingAplicado ?? null,
  emisionesEmptyBackhaulKgco2eWtw: result.backhaul?.emisionesKgco2eWtw ?? null,
  ahorroCo2eVsSinMatchingKgco2e: result.backhaul?.ahorroVsSinMatchingKgco2e ?? null,
});
```

**Dependencia**: §1.1 mergeado. Requiere también la API del matching
engine (§1.3).

**Estimación**: 1 h (incluye tests).

### 1.3 Matching engine reporta `factorMatching` real

**Branch sugerida**: `feat/013c-matching-factor`

El matching engine debe exponer un método nuevo:

```ts
// packages/matching-algorithm/ o apps/matching-engine/
export async function getReturnMatchingRatio(tripId: TripId): Promise<number | null> {
  // Buscar el siguiente trip del mismo carrier que arranca cerca del
  // destino del trip dado. Si existe y empieza dentro de un threshold
  // temporal/geográfico, calcular qué fracción del retorno geográfico
  // está cubierta por ese trip loaded.
}
```

Implementación: requiere análisis del grafo de viajes consecutivos del
transportista. Datos disponibles:
- `assignments.assigned_at` y `assignments.completed_at`
- Coordenadas de origen/destino de cada `trip_request`.

Heurística inicial (puede refinarse después):

```
Si trip_n+1 del mismo carrier empieza dentro de 4h de la entrega de trip_n
   y el origen de trip_n+1 está a < 50 km del destino de trip_n:
       factorMatching = min(distancia_retorno_loaded / distancia_retorno_total, 1.0)
Si no:
       factorMatching = 0
```

**Dependencia**: ninguna; se puede hacer en paralelo con §1.1 y §1.2.

**Estimación**: 2-3 h. Trabajo de algoritmo + tests con escenarios sintéticos.

### 1.4 Certificado PDF: sección "Ahorro CO₂e via matching"

**Branch sugerida**: `feat/013d-certificado-backhaul`

`packages/certificate-generator/` genera el PDF firmado. Agregar:

- Una sección visual nueva con el desglose:
  - Emisiones loaded leg (ya estaba)
  - Empty backhaul attributable (nueva)
  - **Ahorro CO₂e via Booster matching** (highlight)
- Un párrafo explicativo con cita a GLEC §6.4 e ISO 14083.
- Si `factorMatching` es null o 0, mostrar "Sin matching de retorno disponible para este viaje" en lugar de la sección.

**Dependencia**: §1.2 mergeado (necesita los datos persistidos).

**Estimación**: 1.5 h.

### 1.5 UI shipper: mostrar el ahorro en `/app/certificados`

**Branch sugerida**: `feat/013e-ui-ahorro-backhaul`

En `apps/web/src/routes/certificados.tsx`:

- Nueva columna "Ahorro CO₂e" en la tabla.
- En el resumen agregado del top: total de ahorro mensual del shipper.
- Componente que explica el cálculo al hacer click (tooltip o modal con cita a GLEC).

**Dependencia**: §1.2 mergeado.

**Estimación**: 1 h.

### 1.6 Comunicación pública

Una vez §1.1–§1.5 estén en producción:

- Nota técnica en `boosterchile.com/transparencia` con metodología
  GLEC v3.0 + ISO 14083 explicada en lenguaje natural.
- Email a clientes con pilot trips activos: explicación del nuevo KPI.

**Estimación**: 2 h (no es código, es contenido + envío).

## §2 — Pendientes de infra CI/CD

Documentados como out-of-scope de ADR-020. Activarlos sube el rigor del
quality gate.

### 2.1 E2E pipeline contra staging

**Branch sugerida**: `ci/e2e-staging-pipeline`

El bootstrap E2E ya existe (`apps/web/e2e/fixtures.ts`) desde MR !8.
Falta:

1. Crear un user de test en Firebase staging con onboarding completado.
2. Configurar CI vars en GitLab Settings → CI/CD → Variables:
   - `E2E_USER_EMAIL` (masked)
   - `E2E_USER_PASSWORD` (masked, protected)
3. Agregar job al `.gitlab-ci.yml`:

```yaml
e2e:
  stage: e2e
  needs: [build]
  image: mcr.microsoft.com/playwright:v1.49.1-noble
  variables:
    BASE_URL: "https://staging.app.boosterchile.com"
  before_script:
    - corepack enable
    - corepack prepare pnpm@9.15.4 --activate
    - pnpm install --frozen-lockfile
    - pnpm --filter @booster-ai/web exec playwright install chromium
  script:
    - pnpm --filter @booster-ai/web exec playwright test
  artifacts:
    when: always
    paths:
      - apps/web/playwright-report/
    expire_in: 14 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

**Dependencia**: staging desplegado (verificar con Felipe que la URL
existe y es estable).

**Estimación**: 1 h + setup de credenciales con Felipe.

### 2.2 Security pipeline

**Branch sugerida**: `ci/security-pipeline`

Replicar `.github/workflows/security.yml` en `.gitlab-ci.yml`:

- **Gitleaks** (escaneo de secretos): hay una imagen oficial
  `zricethezav/gitleaks:latest` que se puede usar como job.
- **npm audit**: simple `pnpm audit --audit-level=high` como job.
- **GitLab SAST nativo**: incluir el template
  `Security/SAST.gitlab-ci.yml` para análisis estático automático.

**Estimación**: 1 h.

### 2.3 Coverage gate ≥ 80% bloqueante

**Branch sugerida**: `ci/coverage-gate`

Hoy `vitest.config.ts` declara `thresholds: { lines: 80, ... }` en cada
workspace, pero el script root `pnpm test` usa `turbo run test` sin
`--coverage`. Requiere:

1. Agregar script `test:coverage` al root y a cada workspace:
   ```json
   "test:coverage": "vitest run --coverage --passWithNoTests"
   ```
2. Cambiar el job `test` del CI a `pnpm test:coverage`.
3. Agregar step de validación que falle el job si algún workspace
   `coverage-summary.json` no cumple el threshold.

**Riesgo**: actualmente algunos workspaces tienen 0% de coverage
(ej. `packages/whatsapp-client`). Activar el gate sin antes elevar el
coverage los rompería. Estrategia gradual: aplicar gate solo a workspaces
con coverage > 60% inicialmente, ir subiendo.

**Estimación**: 2 h (incluye agregar tests donde hay holes).

### 2.4 Limpiar `.github/workflows/*.yml`

Los archivos en `.github/workflows/` están **inertes** desde la migración
a GitLab. Mantenerlos confunde a colaboradores nuevos. Plan:

1. Verificar que todos los pipelines portados a `.gitlab-ci.yml` cubren
   lo necesario.
2. Borrar `.github/workflows/` completo o moverlo a
   `.archive/legacy-github-workflows/` con un README explicando.

**Estimación**: 15 min.

## §3 — Pendientes cosméticos / housekeeping

### 3.1 Mover `<CompanySwitcher>` al Layout global

`!11` (FIX-011b) integró `<CompanySwitcher>` en el header de `/app/perfil`
porque `Layout.tsx` no existía aún. Después de `!3` (FIX-003) que
introdujo `Layout`, el switcher debería estar en el header global de
todas las rutas autenticadas.

**Branch sugerida**: `chore/company-switcher-en-layout`

- Mover `<CompanySwitcher>` de `apps/web/src/routes/perfil.tsx` a
  `apps/web/src/components/Layout.tsx`.
- Pasar `me` y `useSwitchCompany` desde el Layout (que ya tiene `me` por prop).
- Verificar que rutas como `/app/cargas`, `/app/vehiculos`, `/app/ofertas`
  ahora muestran el switcher.

**Estimación**: 30 min.

### 3.2 Eliminar 63 warnings biome `noEmptyBlockStatements`

Patrón: mocks de logger en tests con `trace: () => {}` etc. Soluciones
posibles:

```ts
// Opción A: vi.fn() — actual con mock observable.
const noopLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  // ...
};

// Opción B: comentario explícito que biome reconoce.
const noopLogger = {
  trace: () => {
    // intencionalmente vacío para tests
  },
  // ...
};
```

**Estimación**: 30 min para todo el repo (es repetitivo).

### 3.3 Borrar branches locales mergeadas

```bash
git branch | grep -E "^  fix/|^  chore/|^  docs/|^  research/|^  ci/" \
  | xargs -n1 git branch -D 2>/dev/null
```

(No incluye `fix/014-gps-stale` que está en otro worktree.)

**Estimación**: 1 min.

### 3.4 Doc obsoleto `docs/fix-session-handoff.md`

Vive en branch `docs/fix-session-handoff` (no en main). Todos los fixes
referenciados están cerrados. Acciones:

- **Opción A**: borrar la branch remota: `git push origin --delete docs/fix-session-handoff`.
- **Opción B**: dejarla como evidencia histórica (es lo que hicimos hasta acá).

Recomendación: dejarla. No molesta y sirve para auditoría futura.

## §4 — Pendientes estratégicos / decisiones de producto

### 4.1 Matching engine sub-óptimo

Audit FIX-013 §3.1 detectó que **si el matching engine asigna un camión
grande para una carga chica**, la intensidad CO₂e/t·km del shipment es
alta (ej. 5000 kg en camión 28t da ~250 g/t·km). No es bug del calculator
— es un problema del producto matching engine.

**Acciones posibles**:

- KPI nuevo: "fit ratio = cargaKg / capacidadKg" por trip.
- Threshold para alertar al carrier si fit < 0.3 (camión muy grande para la carga).
- En la UI shipper, ranking de carriers por intensidad CO₂e/t·km
  histórica.

**Estimación**: trabajo de producto. Conversación con Felipe para definir
prioridad.

### 4.2 Asesor GLEC externo

Smart Freight Centre tiene partners certificados en LATAM
(<https://www.smartfreightcentre.org/>). Antes de TRL 10, considerar
validación externa del calculator + certificados firmados:

- Costo aproximado: USD 2-5k según alcance.
- Beneficio: defensa ante auditoría corporativa CDP / SBTi.
- Output: carta de validación + posible co-branding "GLEC certified".

**Decisión**: Felipe / cuando convenga estratégicamente.

### 4.3 Multi-modal (rail / sea / air)

Booster hoy es 99% road freight. Si expande a intermodal:

- ISO 14083:2023 cubre los 4 modos.
- GLEC v3.2 (oct 2025) tiene secciones específicas.
- Implementar un modo nuevo `intermodal` que combine road + rail/ship.

**Decisión**: cuando haya cliente real con esa necesidad. No bloquea TRL 10.

### 4.4 Coverage de huella tipo Scope 1/2/3

Booster reporta Scope 3 Cat 4 (transporte upstream del shipper). Si el
producto evoluciona a "ESG dashboard completo":

- Scope 1 del transportista (combustible directo).
- Scope 2 (electricidad para bodegas, oficinas).
- Resto de Scope 3 del shipper (no solo transport).

**Decisión**: probable post-MVP. No urgente.

## §5 — Métricas para revisar

A los 30 días de mergeado el último MR:

- **CI**: minutos consumidos / 400 disponibles. Si > 320 (80%), considerar
  self-hosted runner según ADR-020.
- **Empty backhaul**: % de viajes con `factorMatching > 0`. Target ≥ 50%.
- **Calidad del calculator**: comparar `metricas_viaje.intensidad_gco2e_por_ton_km`
  agregada con benchmarks GLEC para detectar desviaciones operativas.

## §6 — Comandos rápidos para la nueva sesión

```bash
# Sincronizar y ver estado
git checkout main && git pull origin main
git log --oneline -10

# Listar MRs abiertos en GitLab
glab mr list --repo boosterchile-group/booster-ai

# Validar CI pipeline antes de pushear
glab ci lint --repo boosterchile-group/booster-ai

# Correr tests del calculator (44 tests, < 1s)
corepack pnpm --filter @booster-ai/carbon-calculator run test

# Typecheck full
corepack pnpm --filter @booster-ai/web exec tsc --noEmit
corepack pnpm --filter @booster-ai/api exec tsc --noEmit

# Lint full
corepack pnpm exec biome check .

# Iniciar dev server (si necesitas debug en browser)
corepack pnpm --filter @booster-ai/web run dev
```

## §7 — Cuándo descartar este documento

Cuando los 5 pasos de §1 estén cerrados (= empty backhaul end-to-end en
producción mostrando el ahorro al shipper). En ese punto, archivar este
handoff o reemplazarlo por uno nuevo de la siguiente fase.

---

**Sesión que produjo este documento**: 2026-05-05, 16 MRs mergeados,
~3000 líneas de código + 600 líneas de docs. Ver
`git log --merges main --since='2026-05-05'` para el histórico completo.
