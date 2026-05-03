# HANDOFF — Booster AI (Claude.ai → Claude Code, 2026-05-03)

> Documento vivo de transición. Reconstruido desde el repositorio (commits, ADRs, packages, infra) sin transcripts externos. Actualizar al final de cada sprint mayor.

**Origen**: el trabajo previo se hizo en sesiones de Claude.ai (chat web). Este archivo + `AUDIT.md` + `CLAUDE.md` + `docs/CLAUDE-CODE-WORKFLOW.md` reemplazan ese canal: cualquier agente de Claude Code en terminal arranca con contexto suficiente.

---

## 1. Snapshot de hoy (2026-05-03)

| Item | Valor |
|------|-------|
| Branch activo | `claude/analyze-booster-ai-DoJpv` |
| Último commit en main | `0a79641 feat(chat): P3.f.bonus cerrar 2 deudas explicitas P3.e` |
| Sprint cerrado más reciente | **P3 chat realtime** (a-f) — schema, REST, Pub/Sub, SSE, Web Push VAPID, UI, fallback WhatsApp |
| Apps funcionales | api, web, whatsapp-bot, telemetry-tcp-gateway, telemetry-processor (5/8) |
| Apps skeleton | document-service, matching-engine, notification-service (3/8) |
| Packages funcionales | shared-schemas, carbon-calculator, certificate-generator, codec8-parser, whatsapp-client, config, logger, ui-tokens (8/17) |
| Packages MVP | matching-algorithm, notification-fan-out (2/17) |
| Packages placeholder | pricing-engine, trip-state-machine, ai-provider, document-indexer, dte-provider, carta-porte-generator, ui-components (7/17) |
| ADRs vigentes | 001, 002, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014 (14) |
| Infra prod | Cloud Run × 7, GKE Autopilot, Pub/Sub × 8 + DLQ, Cloud SQL privado, Firestore, GCS retention 6yr, KMS RSA-4096, Redis Memorystore, Secret Manager × 14 |
| Infra staging | ❌ pendiente (GCP project no creado) |
| CI/CD | `ci.yml`, `security.yml`, `release.yml`, `e2e-staging.yml` (placeholder); Cloud Build prod operativo |
| Coverage gate | ≥80% líneas / 75% branches / 80% functions |

---

## 2. Sprints cerrados (últimos 50 commits, agrupados)

| Sprint | Commits | Resultado |
|--------|---------|-----------|
| **Telemetría IoT phase-2** | 6 | `codec8-parser` + TCP gateway en GKE + processor + admin dispositivos pendientes |
| **Certificados ESG** | 8 | KMS RSA-PKCS1-4096-SHA256 + `certificate-generator` package + endpoints emisión/download/listado/verify + UI 3 surfaces + backfill job |
| **Live tracking maps** | 4 | `/vehiculos/:id/live` + `/cargas/:id/track` tipo Uber, hero map en detalle |
| **Chat P3 (a-f)** | 6 | Schema + REST endpoints + Pub/Sub realtime + SSE endpoint + Web Push VAPID + UI ChatPanel + WhatsApp fallback unread |
| **Vehículos / Cargas CRUD** | 4 | UI shipper end-to-end, listado activo + historial, edición |
| **DB access (ADR-013)** | 8 | 3 capas: runtime VPC, bastion IAP human, Cloud Run Jobs one-off |
| **Auth refinements** | 3 | Account linking + cache invalidation + provider cleanup |

---

## 3. Decisiones que NO están en ADR (todavía)

Detectadas leyendo commits + estructura. Si alguna se mantiene en producción, **debe materializarse como ADR**:

1. **KMS RSA-PKCS1-4096-SHA256** para firmar certificados — implementado en `packages/certificate-generator` y `apps/api`. **Falta ADR**.
2. **Web Push VAPID** como canal de notificación realtime (vs FCM puro). **Falta ADR**.
3. **SSE como mecanismo de chat realtime** (vs WebSocket o Firestore listeners directos). **Falta ADR**.
4. **Pub/Sub como bus interno de chat** (`chat-messages` topic). **Falta ADR**.
5. **Workbox PWA** stack en `apps/web` (configuración + estrategias de cache). **Falta ADR**.
6. **Drizzle migrator con advisory lock** para evitar carreras en arranque. Convención implícita.
7. **Backfill via Cloud Run Jobs** (patrón `merge-job.yaml`) — coherente con ADR-013 capa 3.

> Acción recomendada: abrir ADRs 015-019 cubriendo (1)-(5) en el próximo ciclo.

---

## 4. Bloqueantes activos (priorizados)

### 🔴 Regulatorios go-live Chile

1. **DTE Guía de Despacho** — `packages/dte-provider` placeholder. Sin esto no se puede operar legalmente.
2. **Carta de Porte Ley 18.290** — `packages/carta-porte-generator` placeholder.
3. **Document indexing + retention 6yr aplicado** — `packages/document-indexer` placeholder; `apps/document-service` skeleton.

### 🟡 Estructurales (deuda CLAUDE.md)

4. **Matching algorithm en `apps/api/services/`** debe moverse a `packages/matching-algorithm`.
5. **`trip-state-machine` XState** nunca codificada (FSM hoy implícita en handlers).
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
- [ ] Codificar `trip-state-machine` en XState (18 estados ADR-004)
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
- [ ] ADRs 015-019 para decisiones detectadas en sección 3

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
| Staging env | Requiere GCP project separado y parametrización Terraform por environment | Felipe |
| Coverage real | 80% gate se cumple por consumidores, packages clave sin tests propios | Cualquier agente |
| ADRs 015-019 | Documentar KMS, Web Push, SSE, Pub/Sub chat, Workbox | Cualquier agente |
| `apps/marketing` | Next.js standalone, e-commerce pricing, SEO | Por priorizar |
| Observatorio | BigQuery aggregations + gemelos digitales | Backlog post-launch |
| **Vulnerabilidades npm audit** | 1 CRITICAL + 2 HIGH detectadas en CI (PR #19): `crypto-js <4.2.0` (PBKDF2 weak, GHSA-xwcq-pm8m-c4vf), `serialize-javascript <=7.0.2` (RCE, GHSA-5c6j-r48x-rmvq), `drizzle-orm <0.45.2` (SQL injection, GHSA-gpj5-g38j-94v9). Bumpear deps en sprint próximo (PR dedicado, scope security). | Cualquier agente |
| **Trivy + SBOM en CI** | Failing en `main`. Investigar logs autenticados (no son introducidos por PR de solo-docs). | Felipe |

Actualizar esta tabla cuando se abra/cierre algo no trivial.
