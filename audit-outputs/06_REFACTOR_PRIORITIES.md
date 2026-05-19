# 06 — Refactor Priorities (Booster AI)

**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Subagent**: `refactor-advisor` (model: opus)
**Generado**: 2026-05-19T02:55Z
**Modo**: síntesis read-only de `01_ARCHITECTURE.md` · `02_DEPENDENCIES.md` · `03_SECURITY_FINDINGS.md` · `04_PERFORMANCE_FINDINGS.md` · `05_TECH_DEBT_REGISTRY.md`
**Marco**: principios rectores de `CLAUDE.md` (1–7) + ADR-001 (stack canónico) + objetivo TRL 10.

Cada recomendación cita evidencia (sección del reporte + `archivo:línea`). Cero recomendaciones inventadas.

---

## Resumen ejecutivo

| Severidad | Count | Esfuerzo agregado |
|-----------|-------|-------------------|
| **P0**    | 1     | M (≤5d)           |
| **P1**    | 14    | mezcla S/M, una L |
| **P2**    | 10    | mayormente S/M    |
| **Total** | 25    | ~3 sprints        |

**Top 5 quick wins** (alto impacto × esfuerzo S, ejecutables en Sprint 1):

1. **R-005** — `pnpm overrides` para `ws@^8.20.1` y `esbuild@^0.25.0` → lleva el repo a 0 vulnerabilidades (dev incluidas) con un PR de 4 líneas. Fuente: `02_DEPENDENCIES.md §3.2`.
2. **R-006** — Agregar bloque de security headers (HSTS / CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy) a `apps/web/nginx.conf.template`. ~10 líneas, bloquea clickjacking + MITM first-visit. Fuente: `03_SECURITY_FINDINGS.md §P1-1`.
3. **R-007** — N+1 sobre `vehicles` en matching (`apps/api/src/services/matching.ts:180-192`): aplicar el mismo patrón batch que ya usa `matching-v2-lookups.ts:97-138`. p95 −200..400ms con ~0.5d. Fuente: `04_PERFORMANCE_FINDINGS.md §B1.1`.
4. **R-008** — `SELECT COUNT(*)` por cada AVL record en telemetry-processor (`apps/telemetry-processor/src/persist.ts:114-119`): reemplazar con flag `tiene_primer_punto` en `vehiculos` o `WHERE NOT EXISTS LIMIT 1`. Crítico antes de escalar flota. Fuente: `04_PERFORMANCE_FINDINGS.md §B1.2`.
5. **R-009** — Endurecer el pool `pg` de `apps/api` añadiendo `idleTimeoutMillis: 30_000` + `statement_timeout: 10_000` en `apps/api/src/db/client.ts:18-25`. 5 minutos de config, elimina zombies y queries colgadas. Fuente: `04_PERFORMANCE_FINDINGS.md §B5`.

---

## Cross-cutting findings

Hallazgos que aparecen en ≥2 dimensiones (architecture/deps/security/perf/tech-debt). El cruce es la mejor señal de qué tocar primero.

### CC-1 — Observabilidad declarada pero no cableada (deps + architecture + tech-debt)

- `02_DEPENDENCIES.md §4` enumera 6 paquetes `@opentelemetry/*` + `pino-http` declarados en `apps/api` con **0 imports en `src/`**.
- `01_ARCHITECTURE.md §1` confirma que `apps/api/src/main.ts` no preload-ea `@opentelemetry/sdk-node` (no hay `--require`/`--import` en `package.json scripts.start` ni en Dockerfile).
- Esto contradice frontalmente el **principio rector §6 de `CLAUDE.md`** ("Observabilidad desde el primer endpoint... cada endpoint del backend... genera log estructurado con `correlationId` + span OTel + métrica custom").
- Bloqueante TRL 10 — sin observabilidad de producción no hay forense post-incidente ni SLOs medibles.
- **Recomendaciones**: R-001 (P0).

### CC-2 — Bundle frontend inflado: rutas eager + deps muertas + Tremor + Maps (perf + deps)

- `04_PERFORMANCE_FINDINGS.md §F1.1` flags 38 rutas eager en `apps/web/src/router.tsx:1-46`, cero `lazyRouteComponent`, Tremor + Recharts + Google Maps + Firebase Auth en chunk inicial (estimado 400-700KB gzip).
- `02_DEPENDENCIES.md §4` lista 4 deps prod en `apps/web` con **0 imports**: `clsx`, `idb`, `tailwind-merge`, `zustand`. Las dos últimas son features prometidas en ADR-001 / ADR-008 (state global, offline queue) que ni siquiera empezaron.
- Recomendaciones convergentes: **R-002 (P1)** corta el bundle vía lazy routes; **R-010 (P1)** decide implementar-o-remover las 4 deps muertas.

### CC-3 — Skeleton workspaces colapsan el gate de coverage (architecture + tech-debt + ci)

- `01_ARCHITECTURE.md §6.4` cataloga 8 placeholders (5 packages stub + 3 apps skeleton) que pasan `vitest --passWithNoTests` trivialmente.
- `01_ARCHITECTURE.md §H-ARCH-07` (P3): el gate de coverage en `.github/workflows/ci.yml:106-126` itera sobre `coverage-summary.json` existentes — si un workspace no emite el archivo, no se evalúa. Resultado: el "≥80% bloqueante" puede ser falso verde silencioso.
- `05_TECH_DEBT_REGISTRY.md §TD3` confirma los TODO genéricos en `apps/{matching-engine,notification-service,document-service}/src/main.ts:12`.
- Recomendaciones: **R-003 (P1)** cierra el gate; **R-011 (P2)** ata cada stub a un `feature: <slug>` con fecha.

### CC-4 — Node 22 ↔ Node 24 drift CI/dev (architecture + reproducibility)

- `01_ARCHITECTURE.md §H-ARCH-01` (P1): `.nvmrc=22` + `engines.node>=22` (ADR-001 LTS) vs todos los workflows hardcodeando Node 24 en `ci.yml:18`, `security.yml:57,150`, `release.yml:21`, `e2e-staging.yml:34`.
- No es performance ni security puro — es reproducibilidad. CI puede dar verde sobre Node 24 mientras Cloud Run runtime (default Node 22 LTS) ejecuta otra cosa.
- Recomendación: **R-004 (P1)** — reconciliar a 22 o crear ADR-049 que supersede.

### CC-5 — `haversineKm` definido en service (architecture + perf + tech-debt)

- `01_ARCHITECTURE.md §6.2 + §H-ARCH-04`: `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75` define **y exporta** `haversineKm`, importado por `apps/api/src/services/actualizar-factor-matching.ts:6` y `apps/api/src/services/get-public-tracking.ts:33`.
- `05_TECH_DEBT_REGISTRY.md §TD8` cataloga `apps/api/src/services/estimar-distancia.ts:11` con comentario que documenta haversine como aproximación pendiente sustitución por routing real.
- Viola la regla CLAUDE.md "Algoritmos viven en `packages/`". Cualquier app fuera de `apps/api` que necesite haversine rompe el monorepo.
- Recomendación: **R-012 (P2)** — mover a `packages/matching-algorithm/src/geo/haversine.ts` o nuevo `packages/geo-utils/`.

### CC-6 — Infraestructura: descripción en CLAUDE.md ≠ realidad + state files en git (architecture + security)

- `01_ARCHITECTURE.md §H-ARCH-02` (P1): `CLAUDE.md` describe `infrastructure/main.tf` + `environments/{dev,staging,prod}/` + 5 módulos. Realidad: 18 `.tf` planos + 3 módulos + sin `environments/`.
- `01_ARCHITECTURE.md §H-ARCH-06` (P2): `infrastructure/apply-plan.tfplan` (binario tfplan) + `infrastructure/terraform.tfvars.local` checked-in al repo. Puede contener nombres de recursos / IPs / overrides locales.
- `03_SECURITY_FINDINGS.md` no lo catalogó como P0 explícitamente (delegado), pero la presencia de `.tfplan` binario + `.tfvars.local` en `git ls-files` justifica revisión P1.
- Recomendaciones: **R-013 (P1)** alinear `CLAUDE.md` ↔ realidad; **R-014 (P1)** purgar binarios y añadir patrones al `.gitignore`.

### CC-7 — Bypass total de WAF para `api.boosterchile.com` (security)

- `03_SECURITY_FINDINGS.md §P1-3`: `infrastructure/networking.tf:198-225` aplica `action = "allow"` con prioridad 390 para `host == 'api.boosterchile.com'`, bypaseando todo OWASP CRS. Trade-off documentado (RUTs chilenos con `-9` rompen reglas SQLi).
- Dimensión única (security) pero impacto cross-app (toda la API queda dependiendo de Firebase Auth + Zod + Drizzle).
- Recomendación: **R-015 (P1)** — migrar a opt-out granular usando la sintaxis correcta `evaluatePreconfiguredWaf` + `opt_out_rule_ids` (ver memoria `reference_cloud_armor_opt_out_syntax.md`).

### CC-8 — `pdf-lib` sin mantenimiento + `certificate-generator` firma documentos legales (deps + compliance)

- `02_DEPENDENCIES.md §6`: `pdf-lib` última release 2022-05-12 (~4 años), >200 issues abiertos, sin commits. Usado por `apps/api` y `packages/certificate-generator`.
- `packages/certificate-generator` produce certificados PDF firmados KMS+signpdf usados en documentos legales Chile (Carta Porte, Ley 18.290, retención 6 años).
- Bug crítico sin parche upstream = riesgo para evidencia legal.
- Recomendación: **R-016 (P1)** — PoC migración a `pdfme` / `hummus-recipe` / fork antes de TRL 10.

---

## Recomendaciones P0

P0 = bloquea TRL 10, certificación o launch. Violación estructural de un principio rector.

### R-001 — Cablear OpenTelemetry y `pino-http` en `apps/api` (o decidir explícitamente diferir)

- **Severidad**: P0
- **Justificación**: `02_DEPENDENCIES.md §4` documenta 7 paquetes prod declarados con cero uso en `src/`. `01_ARCHITECTURE.md §1` confirma que `apps/api/src/main.ts` no preload-ea SDK Node OTel. Esto viola directamente **CLAUDE.md Principio §6** ("Observabilidad desde el primer endpoint"). Sin cableo no hay correlación request → log → span, no hay forense, no hay SLOs medibles. Bloqueante para certificación (auditoría externa esperará trazas) y para operaciones en producción (debugging post-incidente sería ciego).
- **Evidencia**:
  - `02_DEPENDENCIES.md §4` tabla "Deps no usadas" (filas `@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/sdk-node`, `@opentelemetry/semantic-conventions`, `pino-http`).
  - `02_DEPENDENCIES.md §7.3` anomalía 1: "OTel declarado pero no cableado: viola principio rector #6 de CLAUDE.md".
  - `01_ARCHITECTURE.md §2` confirma entrypoint `apps/api/src/main.ts` sin preload.
- **Esfuerzo**: M (1–3 días si se cablea correctamente: crear `apps/api/src/instrumentation.ts` con `NodeSDK` + `OTLPTraceExporter` + resource attrs `service.name=booster-ai-api`, exportar a Cloud Trace; añadir `--import ./dist/instrumentation.js` al start; añadir middleware Hono que injecta `correlationId` + cablea `pino-http`). La alternativa "remover deps" es S pero requiere ADR superseding §6.
- **Dependencias**: ninguna previa. Habilita posteriormente forense correcta para R-007/R-008/R-015.
- **Quick win**: NO (esfuerzo M+ y bloqueante).

---

## Recomendaciones P1

P1 = degrada calidad observable o introduce riesgo conocido. Sin bloqueo de launch inmediato pero debe cerrarse antes de TRL 10.

### R-002 — Lazy routes en `apps/web/src/router.tsx` (split del initial bundle)

- **Severidad**: P1
- **Justificación**: 38 rutas eager + Tremor + Recharts + Google Maps + Firebase Auth en el chunk inicial. Impacto directo en INP/LCP en mobile mid-range y en la PWA install size (precache descarga ~700KB+ antes del primer uso).
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §F1.1` (`apps/web/src/router.tsx:1-46`), `§F5.2` (INP), `§F4.2` (precache inflado), `§F3.1` (lazyRouteComponent no usado: 0 ocurrencias).
- **Esfuerzo**: M (1–2 días). Patrón: `lazyRouteComponent` de TanStack Router para `platform-admin-*`, `vehiculo-live`, `carga-track`, `flota`, `public-tracking`, `cargas`, `vehiculos`, `conductores`, `sucursales`. Mantener eager solo login + home.
- **Dependencias**: ninguna. Recomendado antes de R-019 (SW runtime caching) para que el precache no engorde.
- **Quick win**: parcial (impacto alto, esfuerzo M — no S).

### R-003 — Cerrar gate de coverage en CI (workspaces ausentes deben fallar)

- **Severidad**: P1
- **Justificación**: el gate "≥80% bloqueante desde el primer PR" (CLAUDE.md §1) es estructuralmente by-passable hoy: 8 placeholders pasan `--passWithNoTests` sin emitir `coverage-summary.json` y el loop de validación en `.github/workflows/ci.yml:106-126` los salta.
- **Evidencia**: `01_ARCHITECTURE.md §H-ARCH-07` + `§6.4` (8 stubs); `01_ARCHITECTURE.md §6.3` (si una app no emite `coverage-summary.json` porque `--passWithNoTests` no produjo tests, el bucle `for f in $(find ...)` puede dar 0 archivos y pasar trivialmente).
- **Esfuerzo**: S (≤1 día). Definir lista esperada de workspaces (derivada de `pnpm -r exec`) y validar que cada uno tiene `coverage-summary.json` antes de promediar.
- **Dependencias**: relacionada con R-011 (decisión sobre stubs). Puede ir antes — si R-003 fuerza implementar tests, R-011 marca prioridad por workspace.
- **Quick win**: **SÍ** (impacto alto, esfuerzo S).

### R-004 — Reconciliar Node 22 (ADR-001) ↔ Node 24 en GitHub Actions

- **Severidad**: P1
- **Justificación**: drift de runtime entre dev (`.nvmrc=22`), Cloud Run (`engines: >=22`) y CI (hardcoded 24 en 4 workflows). El comportamiento de APIs Node 22 vs 24 difiere (ej. `fetch` global, `--experimental-*` flags, runtime defaults). CI verde no garantiza prod verde.
- **Evidencia**: `01_ARCHITECTURE.md §H-ARCH-01`: `.nvmrc` literal `22\n`; `package.json` engines `>=22.0.0`; ADR-001 declara Node 22 LTS inalterable sin nuevo ADR; pero `.github/workflows/ci.yml:18`, `security.yml:57,150`, `release.yml:21`, `e2e-staging.yml:34` usan `'24'`.
- **Esfuerzo**: S (≤1 día) — search/replace en 4 archivos + verificación de que no hay APIs Node 24-only en uso.
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto alto, esfuerzo S).

### R-005 — Aplicar `pnpm overrides` para `ws@^8.20.1` y `esbuild@^0.25.0`

- **Severidad**: P1
- **Justificación**: 2 únicos hallazgos moderate de `pnpm audit` (uninitialized memory disclosure + dev-server SSRF/CORS). Ambos dev-only pero bloquean reportar "0 vulnerabilidades" en audit externo pre-TRL-10.
- **Evidencia**: `02_DEPENDENCIES.md §3.2` (GHSA-58qx-3vcg-4xpx, GHSA-67mh-4wv8-2f99).
- **Esfuerzo**: S (≤1 día — añadir 4 líneas a root `package.json`, validar `pnpm install` resuelve, correr `pnpm audit` para confirmar 0).
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto alto-medio, esfuerzo trivial).

### R-006 — Security headers globales en `apps/web/nginx.conf.template`

- **Severidad**: P1
- **Justificación**: PWA servida por nginx sin CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Permite clickjacking, MITM en first-visit (sin HSTS), MIME-sniffing y XSS reflejado sin restricción.
- **Evidencia**: `03_SECURITY_FINDINGS.md §P1-1`: `apps/web/nginx.conf.template:1-55` sólo emite `Cache-Control`.
- **Esfuerzo**: S (≤1 día) — ~10 líneas de `add_header` + 48h con CSP en `Report-Only` antes de enforcement.
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto alto, esfuerzo S, fix bien acotado).

### R-007 — Batch N+1 en matching v1/v2 (`apps/api/src/services/matching.ts:180-192`)

- **Severidad**: P1
- **Justificación**: bucle `for (const emp of candidateEmpresas)` con `await tx.select().from(vehicles)...limit(1)` por empresa. 50 empresas = 50 round-trips serializados. p95 estimado −200..400ms con un batch.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §B1.1`. El patrón batch correcto ya existe en `apps/api/src/services/matching-v2-lookups.ts:97-138` (5 queries batch) — solo hay que aplicarlo.
- **Esfuerzo**: S (≤0.5 día) — copy pattern + tests.
- **Dependencias**: ninguna. Se beneficia de R-001 (OTel cableado) para medir mejora real.
- **Quick win**: **SÍ** (impacto alto, esfuerzo S, patrón ya conocido en el repo).

### R-008 — Eliminar `SELECT COUNT(*)` por record AVL (`apps/telemetry-processor/src/persist.ts:114-119`)

- **Severidad**: P1
- **Justificación**: tras cada INSERT de punto de telemetría se ejecuta `SELECT COUNT(*) FROM telemetria_puntos WHERE vehiculo_id = ?` para detectar "primer punto". Postgres no hace COUNT(*) O(1); con 1M rows/vehículo se vuelve I/O-bound. 50 devices × 1 record/min = 72k counts/día hoy; escala lineal con flota.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §B1.2`.
- **Esfuerzo**: S (≤0.5 día) — añadir columna `tiene_primer_punto BOOLEAN DEFAULT FALSE` en `vehiculos` + `UPDATE ... RETURNING` (idempotente) o usar `WHERE NOT EXISTS LIMIT 1`.
- **Dependencias**: migración Drizzle (atómica, sin downtime) — debería ir junto a R-009.
- **Quick win**: **SÍ** (impacto alto, esfuerzo S, hotpath operations).

### R-009 — Endurecer pool `pg` en `apps/api` (idleTimeoutMillis + statement_timeout)

- **Severidad**: P1
- **Justificación**: `apps/api/src/db/client.ts:18-25` no setea `idleTimeoutMillis` ni `statement_timeout`. Cloud Run con CPU-throttle al idle puede acumular conexiones zombies del lado Postgres; queries colgadas bloquean el pool sin escape.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §B5`.
- **Esfuerzo**: S (5 minutos config + 1 ciclo de tests).
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto medio, esfuerzo trivial).

### R-010 — Decidir destino de 4 deps muertas en `apps/web` (`clsx`, `idb`, `tailwind-merge`, `zustand`)

- **Severidad**: P1
- **Justificación**: `idb` (offline queue PWA prometida en ADR-008) y `zustand` (state global declarado en ADR-001) son features importantes que no han empezado. `clsx` + `tailwind-merge` parecen utilities olvidados. La decisión "implementar vs remover" tiene impacto en roadmap.
- **Evidencia**: `02_DEPENDENCIES.md §4` (4 filas en tabla de deps no usadas para `apps/web`).
- **Esfuerzo**: S si remover (1 PR) / L si implementar offline queue + state global completos. Cuenta como P1 por la decisión de roadmap.
- **Dependencias**: bloquea R-019 indirectamente (saber si SW debe interactuar con `idb`).
- **Quick win**: parcial — si la decisión es remover, sí; si implementar, no.

### R-011 — Atar cada stub (5 packages + 3 apps) a un `feature: <slug>` con fecha

- **Severidad**: P1
- **Justificación**: 8 placeholders productivos colapsan el gate de coverage (R-003) y dejan TODOs genéricos sin trazabilidad. `apps/{matching-engine,notification-service,document-service}` tienen ADR-048 (microservices-extraction-strategy) pero los 5 packages stub no tienen ADR ni spec activa salvo `.specs/stubs-decision/` (out-of-scope del subagent).
- **Evidencia**: `01_ARCHITECTURE.md §6.4 + §H-ARCH-03`; `05_TECH_DEBT_REGISTRY.md §TD3` (4 TODOs sin issue tracking).
- **Esfuerzo**: M (1–3 días) — leer `.specs/stubs-decision/` y producir ADR-049 (o spec) que para cada stub fije: dueño, fecha objetivo, decisión "implementar | extraer | eliminar".
- **Dependencias**: precede a R-003 (si stubs se eliminan, no hay que tratarlos en coverage; si quedan, el gate los debe enforcear).
- **Quick win**: NO (decisión de roadmap, M).

### R-013 — Alinear descripción Terraform en `CLAUDE.md` con realidad

- **Severidad**: P1
- **Justificación**: `CLAUDE.md:74-90` describe `infrastructure/main.tf` + `environments/{dev,staging,prod}/` + 5 módulos (`gke-telemetry`, `cloud-run-service`, `pubsub-topic`, `firestore`, `secret`). Realidad: flat 18 `.tf` + 3 módulos (`cloud-run-job`, `cloud-run-service`, `iap-bastion`). El contrato del agente describe un estado falso → el agente puede asumir multi-env Terraform cuando es single-project.
- **Evidencia**: `01_ARCHITECTURE.md §H-ARCH-02 + §5`.
- **Esfuerzo**: S (≤1 día) si solo se actualiza el documento. M si la decisión es alinear la realidad al diseño (refactor Terraform a `environments/`).
- **Dependencias**: ninguna previa. Recomendado antes de cualquier trabajo serio sobre infra para evitar drift adicional.
- **Quick win**: **SÍ** (si se elige actualizar el doc).

### R-014 — Purgar binarios Terraform del git y reforzar `.gitignore`

- **Severidad**: P1
- **Justificación**: `infrastructure/apply-plan.tfplan` (binario tfplan) y `infrastructure/terraform.tfvars.local` están checked-in. El primero puede contener nombres de recursos / IPs / ARNs. El segundo, por convención, son overrides locales con valores sensibles.
- **Evidencia**: `01_ARCHITECTURE.md §6.3 + §H-ARCH-06`.
- **Esfuerzo**: S (≤1 día) — `git rm` + `.gitignore` con `*.tfplan`, `*.tfstate*`, `*.tfvars.local`, `.terraform/`.
- **Dependencias**: subagent seguridad debería inspeccionar contenido antes del rm para clasificar si lo borrado merece rotación de secrets.
- **Quick win**: **SÍ** parcial (esfuerzo S, impacto depende de qué contienen los archivos).

### R-015 — Sustituir bypass total de WAF en `api.boosterchile.com` por opt-out granular

- **Severidad**: P1
- **Justificación**: `infrastructure/networking.tf:198-225` aplica `action = "allow"` con prio 390 para `host == 'api.boosterchile.com'`, bypaseando OWASP CRS entero. Trade-off documentado (RUTs `-9` rompen reglas SQLi) pero perder un layer de defense-in-depth significa que un bug en Firebase Auth / Zod / Drizzle escala directo. Memoria del proyecto tiene la sintaxis correcta (`evaluatePreconfiguredWaf` + `opt_out_rule_ids`).
- **Evidencia**: `03_SECURITY_FINDINGS.md §P1-3`; `~/.claude/memory/reference_cloud_armor_opt_out_syntax.md` (citado por el subagent de security).
- **Esfuerzo**: M (1–3 días) — identificar las 2-3 rule IDs con falso positivo (probable: `id942200`, `id942432`) + reemplazar regla allow por `evaluatePreconfiguredWaf('sqli-v33-stable', { opt_out_rule_ids = [...] })` + validación en staging con tráfico real (RUTs).
- **Dependencias**: ninguna previa; se beneficia de R-001 (telemetría) para detectar bloqueos legítimos vs falsos.
- **Quick win**: NO (esfuerzo M y requiere test cuidadoso).

### R-016 — Plan de migración de `pdf-lib` (mantenimiento congelado, firma documentos legales)

- **Severidad**: P1
- **Justificación**: `pdf-lib` última release 2022-05-12 (~4 años), sin commits, >200 issues. Usado por `apps/api` y `packages/certificate-generator` que firma documentos legales (Carta Porte, Ley 18.290, retención 6 años). Bug crítico sin parche upstream = riesgo para evidencia legal.
- **Evidencia**: `02_DEPENDENCIES.md §6` y `§8` (Top-5 acción #5).
- **Esfuerzo**: L (>5 días) — PoC con `pdfme` / `hummus-recipe` / fork mantenido, garantizar paridad de firma KMS+signpdf, regenerar fixtures de certificados, plan de migración.
- **Dependencias**: requiere ADR (R-A1 propuesto abajo).
- **Quick win**: NO.

---

## Recomendaciones P2

P2 = deuda incremental, mejora futura, sin bloqueo conocido.

### R-012 — Mover `haversineKm` de `apps/api/src/services/` a un package

- **Severidad**: P2
- **Justificación**: ver CC-5. Algoritmo puro en service viola "Algoritmos viven en `packages/`".
- **Evidencia**: `01_ARCHITECTURE.md §6.2 + §H-ARCH-04`.
- **Esfuerzo**: S (≤1 día) — mover a `packages/matching-algorithm/src/geo/haversine.ts`, agregar tests, actualizar 3 imports.
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto bajo arquitectónico, esfuerzo S).

### R-017 — Tipar los 4 `any` productivos restantes (TD1)

- **Severidad**: P2
- **Justificación**: 4 hits productivos: `apps/web/src/services/voice-commands.ts:244` (DOM Speech Recognition), `apps/api/src/db/migrator.ts:115` (`db: any` con biome-ignore), `apps/telemetry-processor/src/crash-trace-adapters.ts:53` (BigQuery SDK), `packages/certificate-generator/src/ca-self-signed.ts:183` (`node-forge` no exporta `getTBSCertificate` en typings).
- **Evidencia**: `05_TECH_DEBT_REGISTRY.md §TD1`.
- **Esfuerzo**: S (≤1 día) — declarar `interface` local en cada callsite con el shape consumido.
- **Dependencias**: ninguna.
- **Quick win**: parcial.

### R-018 — Alinear `google-auth-library` cross-workspace (v9 vs v10)

- **Severidad**: P2
- **Justificación**: único drift cross-workspace detectado. `apps/api` declara `^10.6.2`; `apps/whatsapp-bot` declara `^9.15.0`. pnpm hoist puede instalar ambos.
- **Evidencia**: `02_DEPENDENCIES.md §2`.
- **Esfuerzo**: S (≤1 día) — bump `whatsapp-bot` a v10 + verificar OAuth/ADC sigue funcionando.
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto bajo-medio, esfuerzo trivial).

### R-019 — Runtime caching en service worker (`apps/web/src/sw.ts:44-71`)

- **Severidad**: P2
- **Justificación**: SW solo cachea Google Fonts. No hay NetworkFirst para `/api/*` reads, ni CacheFirst para imágenes ni chat photos. La PWA no degrada offline.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §F4.1`.
- **Esfuerzo**: M (~1 día) — añadir `registerRoute` para API GET con `NetworkFirst` + ExpirationPlugin, imágenes CacheFirst, chat photos TTL 5min.
- **Dependencias**: R-002 (lazy routes) primero — evita inflar el precache con el bundle gigante actual.
- **Quick win**: parcial.

### R-020 — `React.memo` + memoización granular en listas con polling

- **Severidad**: P2
- **Justificación**: cero `React.memo` en `apps/web/src/**/*.tsx`. Rutas que poll-ean (`flota.tsx:153` cada 20s, `cargas.tsx:431,497` cada 30s, `vehiculos.tsx`) re-renderizan listas completas en cada tick. Impacto INP en mobile mid-range con 50+ items visibles.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §F2.1`.
- **Esfuerzo**: M (~1 día) — extraer rows a componentes memo con props granulares.
- **Dependencias**: ninguna.
- **Quick win**: NO (esfuerzo M).

### R-021 — Mover migraciones a Cloud Run Job (precondición de deploy) en lugar de runtime

- **Severidad**: P2
- **Justificación**: `apps/api/src/main.ts:31` corre `runMigrations` bloqueante antes del listen. En cold start con N migraciones nuevas suma latencia al primer ready signal.
- **Evidencia**: `04_PERFORMANCE_FINDINGS.md §B4`.
- **Esfuerzo**: M (~1–2 días) — crear Cloud Run Job + hook en `cloudbuild.production.yaml` que ejecute job antes del traffic switch.
- **Dependencias**: ninguna técnica; requiere coordinación deploy.
- **Quick win**: NO.

### R-022 — Refactor `sql.raw` en migrator a parameter binding (`apps/api/src/db/migrator.ts:177`)

- **Severidad**: P2
- **Justificación**: `INSERT ... VALUES ('${hash}', ${entry.when})` con datos derivados de journal en repo. Inocuo hoy (controlled inputs), brittle si en el futuro el journal viene de fuera del repo.
- **Evidencia**: `03_SECURITY_FINDINGS.md §P2-2`.
- **Esfuerzo**: S (≤1 día, ~2 líneas).
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto bajo, esfuerzo trivial).

### R-023 — Convertir 14 comentarios de aplazamiento conocido en TODOs trackeables

- **Severidad**: P2
- **Justificación**: 14 comentarios de aplazamiento conocido sin referencia a ticket/spec (paráfrasis en `05_TECH_DEBT_REGISTRY.md §TD8`). Cumplen disciplina semántica de CLAUDE.md (transparencia) pero rompen trazabilidad operativa.
- **Evidencia**: `05_TECH_DEBT_REGISTRY.md §TD8` (lista completa de 14 archivos).
- **Esfuerzo**: S (≤1 día) — pasada de housekeeping reemplazando texto libre por `TODO(feature: <slug>)`.
- **Dependencias**: ninguna.
- **Quick win**: parcial.

### R-024 — `CORS credentials: false` en `apps/api/src/server.ts:102-108`

- **Severidad**: P2
- **Justificación**: API es bearer-only (cero `Cookie` headers en `apps/api/src`); `credentials: true` no agrega protección pero abre surface si en el futuro se introducen cookies por error (CSRF).
- **Evidencia**: `03_SECURITY_FINDINGS.md §P1-4` (clasificado P1 por security pero impacto bajo; se ubica como P2 quick win).
- **Esfuerzo**: S (5 min config + tests CORS).
- **Dependencias**: ninguna.
- **Quick win**: **SÍ** (impacto bajo, esfuerzo trivial).

### R-025 — Rate limit per-token en `/public/tracking/:token`

- **Severidad**: P2 (escalable a P1 antes de publicación pública masiva)
- **Justificación**: comentario explícito en `apps/api/src/routes/public-tracking.ts:13-18` reconoce que la opacidad UUID no es suficiente bucket. Cloud Armor 1000/min/IP no cubre abuso de un token legítimo. Mientras los links no se publiquen masivamente, P2.
- **Evidencia**: `03_SECURITY_FINDINGS.md §P1-2`.
- **Esfuerzo**: S (≤1 día) — bucket Redis TTL 60s, cap 60 req per token + regex UUID v4 pre-DB.
- **Dependencias**: `ioredis` ya está en `apps/api`. Ninguna.
- **Quick win**: **SÍ**.

---

## Módulos candidatos: reescritura / refactor / mantener

| Módulo | Estado actual | Decisión | Justificación |
|--------|--------------|----------|---------------|
| `apps/api` | Monolito funcional, 26.493 LOC, 60+ services, 37 routes, 13 packages internos consumidos | **Refactor incremental** | No requiere reescritura. Issues son acotados: N+1 (R-007), OTel (R-001), pool (R-009), CORS (R-024), migrator types (R-017), `haversineKm` (R-012). Estructura DAG limpia. |
| `apps/web` | PWA 28.185 LOC, 231 archivos, 38 rutas eager, 4 deps muertas | **Refactor incremental con foco bundle** | R-002 (lazy routes) + R-010 (decisión deps) + R-019 (SW caching) + R-020 (memo). Sin necesidad de reescritura. |
| `apps/telemetry-processor` | 6 archivos, hotpath SELECT COUNT(*) | **Refactor incremental** | R-008 es el único cambio crítico. Resto OK (pool, batching, backpressure). |
| `apps/telemetry-tcp-gateway` | 5 archivos, parser Codec8 + TCP server | **Mantener** | Comportamiento esperado bajo carga normal. Solo P2 menor (Buffer.concat slow-loris guard documentado en `04_PERFORMANCE_FINDINGS.md §B6`). |
| `apps/whatsapp-bot` | 14 archivos, Hono + xstate | **Mantener** | Sin findings críticos. Solo drift de `google-auth-library` (R-018) que es trivial. |
| `apps/sms-fallback-gateway` | 4 archivos, Hono Twilio | **Mantener** | Solo cleanup de dep no usada `@hono/zod-validator` (`02_DEPENDENCIES.md §4`). |
| `apps/matching-engine` | SKELETON | **Decidir vía R-011** | Implementar (extraer desde `apps/api`) o eliminar. ADR-048 ya documenta el plan. |
| `apps/document-service` | SKELETON | **Decidir vía R-011** | Idem. |
| `apps/notification-service` | SKELETON | **Decidir vía R-011** | Idem. |
| `packages/{ai-provider,trip-state-machine,carta-porte-generator,document-indexer,ui-components}` | STUBS placeholder | **Decidir vía R-011** | Atar cada uno a un `feature: <slug>` con fecha objetivo o eliminar. |
| `packages/certificate-generator` | Producción legal Chile, usa `pdf-lib` sin mantenimiento | **Refactor con dep migration (R-016)** | El código del package está OK; el riesgo es la dep upstream. PoC de reemplazo antes de TRL 10. |
| `packages/codec8-parser` | Funcional + tests | **Mantener** | Allocations menor (`04_PERFORMANCE_FINDINGS.md §B6`) solo si flota >1000 devices. |
| `packages/{shared-schemas,logger,config,carbon-calculator,matching-algorithm,pricing-engine,factoring-engine,driver-scoring,whatsapp-client,coaching-generator,dte-provider,notification-fan-out,ui-tokens}` | Funcionales, deps mínimas, testeados | **Mantener** | Cumplen estándar. Hoja del grafo. Sin findings cross-cutting. |
| `infrastructure/` | Flat 18 `.tf`, 3 módulos, sin `environments/` | **Refactor pragmático O actualizar doc** | Decisión vía R-013 (alinear CLAUDE.md) y R-014 (purgar binarios). Si la decisión es seguir flat (single-project), suficiente con R-013. Si multi-env real, M-L. |

---

## ADRs propuestos

Cinco ADRs propuestos por el análisis transversal. **No** se redactan aquí — solo se enuncian.

### R-A1 — ADR-049: Reemplazo de `pdf-lib` para firma de documentos legales

- **Problema**: `pdf-lib` está en mantenimiento congelado desde 2022; `packages/certificate-generator` emite documentos legales Chile con retención 6 años; bug crítico sin parche upstream sería material para evidencia.
- **Alternativas a evaluar**: (a) `pdfme` (mantenido, no firma KMS nativa), (b) `hummus-recipe` (fork de HummusJS), (c) mantener `pdf-lib` + fork interno + parches selectivos, (d) servicio externo (DocuSign / Adobe Sign API).
- **Disparador**: R-016.

### R-A2 — ADR-050: Política de observabilidad obligatoria en backend (OTel + correlationId)

- **Problema**: el principio §6 de CLAUDE.md exige observabilidad desde el primer endpoint, pero hoy no existe enforcement automático ni cableado. Falta una decisión técnica concreta: qué exporter (Cloud Trace vs OTLP HTTP), qué sampling, qué resource attrs canónicos, qué middleware Hono provee `correlationId`.
- **Alternativas a evaluar**: (a) `@opentelemetry/sdk-node` con auto-instrumentations + Cloud Trace exporter, (b) Cloud Trace SDK nativo (menos vendor-neutral), (c) diferir y aceptar que §6 no aplique hasta GA (require ADR superseding).
- **Disparador**: R-001.

### R-A3 — ADR-051: Resolución de stubs (5 packages + 3 apps skeleton)

- **Problema**: 8 placeholders productivos contradicen "Sin features sin tests" y colapsan el gate de coverage. Hay una `.specs/stubs-decision/` pendiente. Sin decisión escrita, los stubs siguen pasando CI como falso verde.
- **Alternativas a evaluar**: (a) extracción gradual desde `apps/api` (ADR-048 ya en esta dirección para apps), (b) eliminación física (los packages que no tienen consumer real), (c) mantener con `package.json private:true` + `test:` script que falle deliberadamente hasta que haya implementación.
- **Disparador**: R-011.

### R-A4 — ADR-052: Estructura definitiva de Terraform (flat vs environments)

- **Problema**: `CLAUDE.md` describe un layout `environments/{dev,staging,prod}/` + 5 módulos que no existen. Terraform real es flat single-project. Hay `cloudbuild.staging.yaml` huérfano. Hay `apply-plan.tfplan` + `terraform.tfvars.local` en git.
- **Alternativas a evaluar**: (a) consolidar como single-project y actualizar `CLAUDE.md`, (b) refactor a multi-env real (staging real + DR + prod) con módulos reusables (cuesta L), (c) workspace-based separation en lugar de directory-based.
- **Disparador**: R-013 + R-014.

### R-A5 — ADR-053: Frontend security headers + Content Security Policy

- **Problema**: la PWA servida por nginx no tiene CSP, HSTS, X-Frame-Options. CLAUDE.md §7 ("Seguridad por defecto") está incumplido en el borde nginx.
- **Alternativas a evaluar**: (a) headers en nginx config (R-006), (b) headers en Cloud Run LB (Terraform `compute.tf`), (c) ambos (defense-in-depth — recomendado).
- **Disparador**: R-006.

---

## Roadmap sugerido

Tres sprints de ~2 semanas con cero overlap de dependencies. Solo P0 + quick wins + un L estructural por sprint.

### Sprint 1 — "Cierre del gap observable" (2 semanas)

Objetivo: 0 vulnerabilidades, observabilidad cableada, gate de coverage real.

- **R-001** (P0, M) — cablear OpenTelemetry + `pino-http` en `apps/api`. Bloquea cualquier debugging serio de los demás items.
- **R-005** (P1, S) — `pnpm overrides` ws + esbuild. **Quick win**.
- **R-006** (P1, S) — security headers en nginx. **Quick win**.
- **R-007** (P1, S) — batch N+1 matching. **Quick win** + se aprovecha de R-001 para medir.
- **R-008** (P1, S) — eliminar `COUNT(*)` AVL. **Quick win**.
- **R-009** (P1, S) — endurecer pool pg. **Quick win**.
- **R-003** (P1, S) — cerrar gate de coverage. **Quick win**.
- **R-004** (P1, S) — alinear Node 22 en workflows. **Quick win**.
- **R-024** (P2, S) — CORS credentials false. **Quick win**.
- **R-014** (P1, S) — purgar binarios Terraform del git.

**Resultado esperado al final del Sprint 1**: 0 vulnerabilidades en `pnpm audit`, observabilidad APM viva, gate de coverage incontornable, dos hotspots de DB resueltos, runtime CI=dev=prod alineado. Esto debería tomar ~7-10 días con un developer dedicado (la mayoría son S).

### Sprint 2 — "Frontend y boundaries" (2 semanas)

Objetivo: bundle frontend bajo control, decisiones de roadmap pendientes resueltas, boundaries arquitectónicos limpios.

- **R-002** (P1, M) — lazy routes en `apps/web`.
- **R-010** (P1, S si remover) — decidir destino de las 4 deps muertas en web.
- **R-011** (P1, M) — decisión escrita sobre los 8 stubs (ADR-051).
- **R-013** (P1, S) — alinear `CLAUDE.md` ↔ realidad Terraform (o iniciar refactor — decisión via ADR-052).
- **R-015** (P1, M) — WAF opt-out granular `api.boosterchile.com`.
- **R-012** (P2, S) — mover `haversineKm` a package. **Quick win**.
- **R-018** (P2, S) — alinear `google-auth-library` v10. **Quick win**.
- **R-022** (P2, S) — `sql.raw` migrator → parameter binding. **Quick win**.
- **R-025** (P2, S) — rate limit per-token tracking. **Quick win** (eleva a P1 antes de publicación masiva).

### Sprint 3+ — "Mantenimiento de deps y deuda de calidad"

Objetivo: cerrar deuda de mantenimiento upstream + housekeeping.

- **R-016** (P1, L) — migración `pdf-lib` (ADR-049 + PoC + plan de rollout).
- **R-017** (P2, S) — tipar 4 `any` productivos.
- **R-019** (P2, M) — runtime caching SW.
- **R-020** (P2, M) — `React.memo` en listas con polling.
- **R-021** (P2, M) — migraciones como Cloud Run Job.
- **R-023** (P2, S) — convertir comentarios de aplazamiento en TODOs trackeables.

Post Sprint-3: revisión semestral de deps stale (`web-push`, `@tremor/react`, `@hookform/resolvers`) y bump planificado `@biomejs/biome` 1→2.

---

## Apéndice — Trazabilidad recomendación ↔ evidencia

| ID | Severidad | Esfuerzo | Quick win | Fuente principal | Sección |
|----|-----------|----------|-----------|------------------|---------|
| R-001 | P0 | M | — | `02_DEPENDENCIES.md` | §4, §7.3 |
| R-002 | P1 | M | parcial | `04_PERFORMANCE_FINDINGS.md` | §F1.1, §F3.1, §F5.2 |
| R-003 | P1 | S | sí | `01_ARCHITECTURE.md` | §6.4, §H-ARCH-07 |
| R-004 | P1 | S | sí | `01_ARCHITECTURE.md` | §H-ARCH-01 |
| R-005 | P1 | S | sí | `02_DEPENDENCIES.md` | §3.2 |
| R-006 | P1 | S | sí | `03_SECURITY_FINDINGS.md` | §P1-1 |
| R-007 | P1 | S | sí | `04_PERFORMANCE_FINDINGS.md` | §B1.1 |
| R-008 | P1 | S | sí | `04_PERFORMANCE_FINDINGS.md` | §B1.2 |
| R-009 | P1 | S | sí | `04_PERFORMANCE_FINDINGS.md` | §B5 |
| R-010 | P1 | S/L | parcial | `02_DEPENDENCIES.md` | §4 |
| R-011 | P1 | M | — | `01_ARCHITECTURE.md` + `05_TECH_DEBT_REGISTRY.md` | §6.4 + §TD3 |
| R-012 | P2 | S | sí | `01_ARCHITECTURE.md` | §6.2, §H-ARCH-04 |
| R-013 | P1 | S | sí | `01_ARCHITECTURE.md` | §H-ARCH-02 |
| R-014 | P1 | S | parcial | `01_ARCHITECTURE.md` | §6.3, §H-ARCH-06 |
| R-015 | P1 | M | — | `03_SECURITY_FINDINGS.md` | §P1-3 |
| R-016 | P1 | L | — | `02_DEPENDENCIES.md` | §6, §8 |
| R-017 | P2 | S | parcial | `05_TECH_DEBT_REGISTRY.md` | §TD1 |
| R-018 | P2 | S | sí | `02_DEPENDENCIES.md` | §2 |
| R-019 | P2 | M | parcial | `04_PERFORMANCE_FINDINGS.md` | §F4.1 |
| R-020 | P2 | M | — | `04_PERFORMANCE_FINDINGS.md` | §F2.1 |
| R-021 | P2 | M | — | `04_PERFORMANCE_FINDINGS.md` | §B4 |
| R-022 | P2 | S | sí | `03_SECURITY_FINDINGS.md` | §P2-2 |
| R-023 | P2 | S | parcial | `05_TECH_DEBT_REGISTRY.md` | §TD8 |
| R-024 | P2 | S | sí | `03_SECURITY_FINDINGS.md` | §P1-4 |
| R-025 | P2 | S | sí | `03_SECURITY_FINDINGS.md` | §P1-2 |

Distribución final: **P0 = 1 (R-001)** · **P1 = 14** (R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-010, R-011, R-013, R-014, R-015, R-016) · **P2 = 10** (R-012, R-017, R-018, R-019, R-020, R-021, R-022, R-023, R-024, R-025).

---

*Fin de 06_REFACTOR_PRIORITIES.md*
*Síntesis read-only producida por `refactor-advisor`. Cero modificación de código fuente.*
