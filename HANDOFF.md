# HANDOFF — Booster AI (Claude.ai → Claude Code, 2026-05-03)

> Documento vivo de transición. Reconstruido desde el repositorio (commits, ADRs, packages, infra) sin transcripts externos. Actualizar al final de cada sprint mayor.

**Origen**: el trabajo previo se hizo en sesiones de Claude.ai (chat web). Este archivo + `AUDIT.md` + `CLAUDE.md` + `docs/CLAUDE-CODE-WORKFLOW.md` reemplazan ese canal: cualquier agente de Claude Code en terminal arranca con contexto suficiente.

---

## 1. Snapshot de hoy (2026-05-03 — sesión "tomar el control")

| Item | Valor |
|------|-------|
| Branch activo | `claude/analyze-booster-ai-DoJpv` (PR #19) |
| Último commit en main | `5b48034 fix(iam): self-binding serviceAccountTokenCreator para signed URLs v4` |
| Sprint cerrado más reciente | **Handoff Claude Code + cleanup CI + ADR backfill + trip-state-machine** (sesión 2026-05-03) |
| **PRs draft activos** | #19 (handoff), #20 (cloud-sql-proxy IAP), #21 (security bumps + typecheck fix), #22 (ADRs 015-019), #23 (CI cleanup), #24 (trip-state-machine) |
| Apps funcionales | api, web, whatsapp-bot, telemetry-tcp-gateway, telemetry-processor (5/8) |
| Apps skeleton | document-service, matching-engine, notification-service (3/8) |
| Packages funcionales | shared-schemas, carbon-calculator, certificate-generator, codec8-parser, whatsapp-client, config, logger, ui-tokens, **trip-state-machine** (9/17) |
| Packages MVP | matching-algorithm, notification-fan-out (2/17) |
| Packages placeholder | pricing-engine, ai-provider, document-indexer, dte-provider, carta-porte-generator, ui-components (6/17) |
| ADRs vigentes | 001, 002, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, **015, 016, 017, 018, 019** (19) |
| Infra prod | Cloud Run × 7, GKE Autopilot, Pub/Sub × 8 + DLQ, Cloud SQL privado, Firestore, GCS retention 6yr, KMS RSA-4096, Redis Memorystore, Secret Manager × 14 |
| Infra staging | ❌ pendiente (GCP project no creado) |
| CI/CD | `ci.yml`, `security.yml`, `release.yml`, `e2e-staging.yml` (con skip-when-empty post #23); Cloud Build prod operativo |
| Coverage gate | ≥80% líneas / 75% branches / 80% functions |

---

## 2. Sprints cerrados (últimos 50 commits, agrupados)

| Sprint | Commits | Resultado |
|--------|---------|-----------|
| **Sesión 2026-05-03 "tomar control"** | 6 PRs | Handoff Claude.ai → Claude Code, cloud-sql-proxy IAP (ADR-014), 5 ADRs backfill (015-019), security bumps drizzle 0.45 + crypto-js + serialize-javascript, CI cleanup SBOM + Playwright, trip-state-machine XState v5 con 54 tests |
| **Telemetría IoT phase-2** | 6 | `codec8-parser` + TCP gateway en GKE + processor + admin dispositivos pendientes |
| **Certificados ESG** | 8 | KMS RSA-PKCS1-4096-SHA256 + `certificate-generator` package + endpoints emisión/download/listado/verify + UI 3 surfaces + backfill job |
| **Live tracking maps** | 4 | `/vehiculos/:id/live` + `/cargas/:id/track` tipo Uber, hero map en detalle |
| **Chat P3 (a-f)** | 6 | Schema + REST endpoints + Pub/Sub realtime + SSE endpoint + Web Push VAPID + UI ChatPanel + WhatsApp fallback unread |
| **Vehículos / Cargas CRUD** | 4 | UI shipper end-to-end, listado activo + historial, edición |
| **DB access (ADR-013)** | 8 | 3 capas: runtime VPC, bastion IAP human, Cloud Run Jobs one-off |
| **Auth refinements** | 3 | Account linking + cache invalidation + provider cleanup |

---

## 3. Decisiones que NO están en ADR (todavía)

Detectadas leyendo commits + estructura. Las primeras 5 fueron documentadas en PR #22 (ADRs 015-019). Quedan:

1. ~~**KMS RSA-PKCS1-4096-SHA256** para firmar certificados~~ → ✅ **ADR-015** (PR #22)
2. ~~**Web Push VAPID** como canal de notificación realtime~~ → ✅ **ADR-016** (PR #22)
3. ~~**SSE como mecanismo de chat realtime**~~ → ✅ **ADR-017** (PR #22)
4. ~~**Pub/Sub como bus interno de chat**~~ → ✅ **ADR-018** (PR #22)
5. ~~**Workbox PWA stack** en `apps/web`~~ → ✅ **ADR-019** (PR #22)
6. **Drizzle migrator con advisory lock** para evitar carreras en arranque. Convención implícita.
7. **Backfill via Cloud Run Jobs** (patrón `merge-job.yaml`) — coherente con ADR-013 capa 3.

> Acción pendiente: ADRs para (6) y (7) cuando próximos PRs los toquen.

---

## 4. Bloqueantes activos (priorizados)

### 🔴 Regulatorios go-live Chile

1. **DTE Guía de Despacho** — `packages/dte-provider` placeholder. Sin esto no se puede operar legalmente.
2. **Carta de Porte Ley 18.290** — `packages/carta-porte-generator` placeholder.
3. **Document indexing + retention 6yr aplicado** — `packages/document-indexer` placeholder; `apps/document-service` skeleton.

### 🟡 Estructurales (deuda CLAUDE.md)

4. **Matching algorithm en `apps/api/services/`** debe moverse a `packages/matching-algorithm`.
5. ~~**`trip-state-machine` XState** nunca codificada~~ → ✅ **PR #24** — package implementado con 54 tests. Falta migrar 6 services (apps/api/src/services/matching.ts, offer-actions.ts, confirmar-entrega-viaje.ts, routes/trip-requests-v2.ts) a `assertTripTransition()` — 1 commit por service como follow-up.
6. **`pricing-engine` MVP** — pricing manual del shipper sin sugerencia algorítmica.
7. **Notification fan-out** parcialmente embebido en `apps/api/services/notify-offer.ts`.

### 🟢 Operacionales

8. **Sin staging environment** — todo deploy es prod-direct con canary manual.
9. **Tests propios** ausentes en `shared-schemas`, `matching-algorithm`, `pricing-engine`, `ui-tokens`, `logger`, `config`.
10. **`apps/marketing`** Next.js (ADR-010) no iniciado.
11. **Observatorio urbano + digital twins** (ADR-012) no iniciado.

---

## 5. Próximos pasos (orden recomendado)

> Cada paso debe pasar por `/spec` → `/plan` → `/build` → `/test` → `/review` → `/ship`. Ver `docs/CLAUDE-CODE-WORKFLOW.md`.

### Sprint 1 (1-2 semanas) — cerrar deuda estructural
- [ ] Mover matching-algorithm a `packages/` y refactor `apps/api`
- [x] ~~Codificar `trip-state-machine` en XState~~ → **PR #24** (falta migrar 6 services como follow-up)
- [ ] Tabla `stakeholders` + `consent_grants` en Drizzle
- [ ] Tests propios en `shared-schemas`, `matching-algorithm`

### Sprint 2 (3-4 semanas) — go-live regulatorio
- [ ] `dte-provider` (Bsale o Paperless)
- [ ] `carta-porte-generator` (PDF Ley 18.290)
- [ ] `document-indexer` + retention 6yr aplicado
- [ ] `apps/document-service` orquestando los tres

### Sprint 3 (1-2 semanas) — operacional
- [ ] Staging environment Terraform + GCP project
- [ ] `pricing-engine` MVP
- [ ] Mover notification-fan-out fuera de `apps/api/services`

### Backlog post go-live
- [ ] `ai-provider` + NLU Gemini en whatsapp-bot
- [ ] `apps/marketing` Next.js (ADR-010)
- [ ] Observatorio urbano + digital twins (ADR-012)
- [x] ~~ADRs 015-019 para decisiones detectadas en sección 3~~ → **PR #22**

---

## 6. Cómo arrancar como agente nuevo en este repo

1. **Lee en orden**: `CLAUDE.md` → `AUDIT.md` → este archivo → ADRs relevantes para tu tarea.
2. **Confirma branch** activo y `git status` antes de tocar nada.
3. **Si la tarea menciona telemetría** → ADR-005. **WhatsApp** → ADR-006. **Documentos/SII** → ADR-007. **UI/roles** → ADR-004 + ADR-008. **DB** → ADR-013.
4. **Antes de codificar**: invoca `/spec` para escribir spec en `docs/specs/`. Sin spec aprobado no se va a `/build`.
5. **Pasos completos del workflow**: ver `docs/CLAUDE-CODE-WORKFLOW.md`.
6. **Playwright MCP** está activado (ver `.mcp.json`). Lo puedes usar para snapshots, navegación, y validación visual de cambios en `apps/web`.

---

## 7. Convenciones rápidas (recordatorio)

- TypeScript: identifiers en inglés camelCase. SQL: tablas/columnas en español snake_case sin tildes.
- Carrier→**Transportista**, Shipper→**GeneradorCarga** en código y SQL nuevo. Stakeholder se mantiene.
- Sin `any`, sin `console.*`, sin secretos en repo, sin features sin tests, sin infra manual.
- Algoritmos en `packages/`. `apps/<x>/services/` orquesta DB/transacciones, no contiene lógica pura.
- Cada endpoint nuevo: log estructurado con `correlationId`, span OTel, métrica si es op de negocio.
- Conventional Commits estricto. Branches `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.

---

## 8. Issues abiertos / contexto en vivo

| Issue | Detalle | Owner |
|-------|---------|-------|
| **PRs draft pendientes de review** | #19 (handoff), #20 (cloud-sql-proxy IAP), #21 (security bumps + typecheck fix), #22 (ADRs 015-019), #23 (CI cleanup), #24 (trip-state-machine). Orden recomendado: #23 → #21 → #19 → #22 → #24 → #20 (último porque depende de runtime Mac). | Felipe |
| **Mac steps PR #20** | terraform apply + restart bastion + GRANTs SQL + LaunchAgent + claude mcp add. Comandos exactos en PR #20 description. | Felipe |
| **Migración 6 services a `assertTripTransition()`** | Follow-up de PR #24. Sites: matching.ts (×3), offer-actions.ts, confirmar-entrega-viaje.ts, trip-requests-v2.ts. 1 commit por service con su test E2E. | Cualquier agente |
| **Drift documental ADR-015** | `packages/certificate-generator/src/firmar-kms.ts:24` dice "RSA-PSS" pero el algoritmo real es PKCS#1 v1.5. Fix de 1 línea (comment update). | Cualquier agente |
| **Lint backlog** | `pnpm lint` reporta 159 errors + 80 warnings pre-existentes en main. Spike de horas/días para limpiar. | Cualquier agente |
| **Trivy filesystem CI** | failure pre-existente en main; ortogonal a npm audit. Requiere logs autenticados (Felipe sign-in en GitHub Actions) para investigar root cause. | Felipe |
| Staging env | Requiere GCP project separado y parametrización Terraform por environment | Felipe |
| Coverage real | 80% gate se cumple por consumidores, packages clave sin tests propios | Cualquier agente |
| `apps/marketing` | Next.js standalone, e-commerce pricing, SEO | Por priorizar |
| Observatorio | BigQuery aggregations + gemelos digitales | Backlog post-launch |
| ~~Vulnerabilidades npm audit~~ | ~~1 CRITICAL + 2 HIGH detectadas en CI (PR #19)~~ → ✅ **Resuelto en PR #21** (drizzle-orm 0.45.2, crypto-js 4.2.0, serialize-javascript 7.0.3) | — |
| ~~SBOM CI failure~~ | ~~`@cyclonedx/cyclonedx-npm` exit 254 en pnpm~~ → ✅ **Resuelto en PR #23** (migrado a cdxgen) | — |
| ~~Playwright a11y CI failure~~ | ~~"No tests found" cuando workflow se dispara sin specs~~ → ✅ **Resuelto en PR #23** (skip-when-empty) | — |
| ~~`@booster-ai/config` typecheck error~~ | ~~`Cannot find namespace 'NodeJS'`~~ → ✅ **Resuelto en PR #21** (`@types/node` añadido) | — |
| ~~ADRs 015-019 no documentados~~ | → ✅ **Resuelto en PR #22** | — |
| ~~`trip-state-machine` placeholder~~ | → ✅ **Resuelto en PR #24** (54 tests, falta migrar 6 services follow-up) | — |

Actualizar esta tabla cuando se abra/cierre algo no trivial.
