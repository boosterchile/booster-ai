# SUMMARY — Auditoría arquitectónica Booster AI

**Fecha**: 2026-05-19 · **Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` · **Branch**: `chore/ci-integration-drift-scripts` @ `5d025f1`
**Modo**: read-only, static-only · **0 archivos fuente modificados**.

---

## Veredicto en una línea

> **Booster AI cumple materialmente con 6 de los 7 principios rectores; el cierre de TRL 10 está bloqueado por 1 hallazgo P0 (observabilidad declarada pero no cableada) más 14 P1 — todos accionables en 3 sprints (~6 semanas) con 7 quick wins solo en Sprint 1.**

---

## Conteos por severidad (25 recomendaciones)

| Severidad | Count | Esfuerzo agregado | Ventana objetivo |
|-----------|------:|-------------------|------------------|
| **P0** — bloquea TRL 10 | **1**  | M (1–3 días)      | Sprint 1 (esta semana) |
| **P1** — degrada calidad o introduce riesgo conocido | **14** | mezcla S/M + 1 L | Sprints 1–2 |
| **P2** — deuda incremental | **10** | mayormente S/M  | Sprint 3+ |

Vulnerabilidades supply chain: **0 críticas/altas en producción** · **2 moderates en dev** (`ws@8.20.0`, `esbuild@0.18.20`) ambas fixable con `pnpm overrides`.

Secrets en cleartext en código: **0**. Las 2 keys públicas en `cloudbuild.production.yaml` están allowlisteadas correctamente (Firebase Web + Maps con HTTP referrer restriction).

Drift vocabulary en commits últimos 30 días: **0** (446 commits revisados).

---

## El único P0

**R-001 — Cablear OpenTelemetry y `pino-http` en `apps/api`** (esfuerzo M, 1–3 días).

`apps/api/package.json` declara 7 paquetes de observabilidad (`@opentelemetry/api`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/sdk-node`, `@opentelemetry/semantic-conventions`, `pino-http`) con **0 imports en `src/`**. `main.ts` no preload-ea `NodeSDK`. Esto viola directamente **CLAUDE.md §6** ("Observabilidad desde el primer endpoint... log estructurado con `correlationId` + span OTel + métrica custom"). Sin observabilidad no hay forense post-incidente ni SLOs medibles — auditoría externa pre-TRL 10 lo va a flagear de inmediato.

**Fix**: crear `apps/api/src/instrumentation.ts` con `NodeSDK` + `OTLPTraceExporter` apuntando a Cloud Trace + middleware Hono que inyecta `correlationId` + cablear `pino-http`. Alternativa válida: ADR-050 superseding §6 (no recomendado para TRL 10).

---

## Top-5 acciones recomendadas (quick wins Sprint 1)

| # | Acción | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | **R-001 P0** — cablear OTel + `pino-http` en `apps/api` | M | Desbloquea TRL 10 + habilita forense para todos los demás items |
| 2 | **R-005** — `pnpm overrides` `ws@^8.20.1` + `esbuild@^0.25.0` (4 líneas) | S | 0 vulnerabilidades en `pnpm audit` |
| 3 | **R-006** — Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) en `apps/web/nginx.conf.template` (~10 líneas) | S | Cierra clickjacking + MIME-sniffing + MITM first-visit |
| 4 | **R-007** — Batch N+1 en matching (`apps/api/src/services/matching.ts:180-192`) usando el patrón ya presente en `matching-v2-lookups.ts` | S | p95 −200..400ms |
| 5 | **R-008** — Eliminar `SELECT COUNT(*)` por record AVL (`apps/telemetry-processor/src/persist.ts:114-119`) | S | Hotpath telemetría O(1) en lugar de O(rows/vehículo) — crítico antes de escalar flota |

Otros **5 quick wins también para Sprint 1** (todos esfuerzo S): R-003 (cerrar gate coverage), R-004 (Node 22 en CI), R-009 (pool pg hardening), R-014 (purgar `.tfplan` + `.tfvars.local` de git), R-024 (CORS credentials false).

**Resultado esperado fin Sprint 1**: 0 vulnerabilidades, observabilidad APM cableada, gate de coverage incontornable, 2 hotspots DB resueltos, runtime CI=dev=prod alineado, security headers globales.

---

## 8 hallazgos cross-cutting (mejor señal de qué tocar primero)

1. **CC-1 (P0)** — OTel declarado pero no cableado · cubierto por R-001.
2. **CC-2 (P1)** — Bundle frontend inflado: 38 rutas eager + 4 deps muertas · R-002 + R-010.
3. **CC-3 (P1)** — 8 stubs (5 packages + 3 apps skeleton) by-passan gate cobertura · R-003 + R-011.
4. **CC-4 (P1)** — Node 22 (ADR-001/.nvmrc/engines) vs Node 24 (4 workflows) · R-004.
5. **CC-5 (P2)** — `haversineKm` definido en `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75` (debería estar en `packages/`) · R-012.
6. **CC-6 (P1)** — CLAUDE.md describe Terraform inexistente (declara `main.tf` + `environments/` + 5 módulos; reality: flat 18 `.tf` + 3 módulos) + `apply-plan.tfplan` + `terraform.tfvars.local` en git · R-013 + R-014.
7. **CC-7 (P1)** — Bypass total WAF Cloud Armor para `api.boosterchile.com` (documentado como trade-off por RUTs chilenos) · R-015.
8. **CC-8 (P1)** — `pdf-lib` 4 años sin commits, usado por firma de documentos legales con retención 6 años · R-016.

---

## Aspectos sólidos confirmados

- **Cero deuda day-0 sostenida**: 0 P0 en tech-debt registry. `any` productivo limitado a 4 ocurrencias todas adaptadores externos con `biome-ignore` justificada.
- **Stack canónico estricto**: 13/16 piezas verificadas vs ADR-001. Stack legacy Booster 2.0 (`express`, `prisma`, `eslint`, `prettier`, `react-router-dom`, `next`) correctamente ausente.
- **Auth solido**: Firebase `verifyIdToken(token, true)` con `checkRevoked` + Google SA-to-SA con JWKS (RS256/ES256). Cero SQL injection vectors (Drizzle + `pg` parametrizado).
- **IAM least-privilege**: runtime SA con roles custom narrow, `github-deployer` solo impersona runtime SA. DWD sin keys via Workspace Identity Federation (sin SA keys).
- **PII auto-redaction**: Pino redacta ≥30 paths (emails, RUTs, tokens, signatures).
- **Pre-commit estricto**: 5 stages (gitleaks + lint-staged + ADR numbering + drift gate + spec-canonical-drift).
- **CI completo**: lint + typecheck + test+coverage + drift-checks + build + security (gitleaks history full, pnpm audit HIGH, CodeQL, Trivy, SBOM CycloneDX).
- **Twilio webhook HMAC verificado** antes de procesar.
- **Conventional Commits historial limpio**: 446 commits últimos 30 días, 0 drift vocabulary.

---

## Riesgos materiales para TRL 10

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| 1 | Auditor externo flagea ausencia OTel | Alta | Alta | R-001 (Sprint 1) |
| 2 | `pdf-lib` recibe bug crítico sin parche durante operación legal | Media | Alta | R-016 + ADR-049 (Sprint 3) |
| 3 | Bug en Firebase Auth/Zod/Drizzle escala a explotación por bypass WAF | Baja | Alta | R-015 opt-out granular (Sprint 2) |
| 4 | Falso verde CI por stubs en coverage gate masks regression | Media | Media | R-003 + R-011 (Sprint 1-2) |
| 5 | Divergencia runtime Node 22 (prod) vs 24 (CI) causa incident productivo | Baja | Media | R-004 (Sprint 1) |
| 6 | Filtración de IPs/recursos via `apply-plan.tfplan` en historial git | Baja | Media | R-014 (Sprint 1) — revisar contenido antes de purge |

---

## Roadmap consolidado

- **Sprint 1** (2 semanas) — "Cierre del gap observable": R-001 P0 + 9 quick wins (R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-014, R-024).
- **Sprint 2** (2 semanas) — "Frontend y boundaries": R-002, R-010, R-011, R-013, R-015 + quick wins R-012, R-018, R-022, R-025.
- **Sprint 3+** — "Mantenimiento de deps y deuda de calidad": R-016 (L), R-017, R-019, R-020, R-021, R-023.

**5 ADRs propuestos por la auditoría** (no redactados):
- ADR-049: reemplazo `pdf-lib` (R-A1)
- ADR-050: política observabilidad (R-A2)
- ADR-051: resolución stubs (R-A3)
- ADR-052: estructura Terraform definitiva (R-A4)
- ADR-053: frontend security headers + CSP (R-A5)

---

## Próximos pasos sugeridos

1. **Esta semana**: revisar `06_REFACTOR_PRIORITIES.md` completo, aprobar Sprint 1, abrir issue tracker con R-001..R-014 quick wins.
2. **Antes de cualquier deploy a prod**: completar R-001 (OTel) + R-014 (purga binarios Terraform).
3. **Antes de auditoría externa pre-TRL 10**: completar Sprints 1 + 2.
4. **Decisión Product Owner pendiente**: stubs (R-011 / ADR-051) y Terraform structure (R-013 / ADR-052) — ambos son decisiones de roadmap, no técnicas puras.

Para detalle por dimensión:
- Estructura → `01_ARCHITECTURE.md` (39.5 KB)
- Supply chain → `02_DEPENDENCIES.md` (18.6 KB)
- Seguridad → `03_SECURITY_FINDINGS.md` (18.9 KB)
- Performance → `04_PERFORMANCE_FINDINGS.md` (19.5 KB)
- Deuda técnica → `05_TECH_DEBT_REGISTRY.md` (18.8 KB)
- Plan accionable → `06_REFACTOR_PRIORITIES.md` (38.4 KB)
- Visión consolidada → `PROJECT_OVERVIEW.md`
- Constitución propuesta → `CLAUDE.md` (no promover sin ADR)
- Extensiones futuras → `EXTENSIONS_RECOMMENDATIONS.md`
