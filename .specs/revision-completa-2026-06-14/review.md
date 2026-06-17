# Revisión completa booster-ai — 2026-06-14

> Auditoría READ-ONLY (diagnóstico, sin fixes). Generada por `/booster-skills:audit-completo`.
> Informes fuente: `audit-outputs/{explore-architecture,security-scanner,dependency-auditor,performance-analyzer,tech-debt-detector,sre-oncall}.md`

## Resumen ejecutivo

Booster AI es un monorepo (10 apps + 21 packages) con **arquitectura sólida y disciplina de código excepcional**: 0 dependencias circulares, 0 violaciones de capas en dominio crítico, 0 parches silenciosos (tech-debt), reglas CLAUDE.md cumplidas, coverage gate 80% enforced. El veredicto NO es "código sucio" — el código está limpio. El riesgo está concentrado en **tres frentes operacionales/legales**: (1) secretos e identificadores de prod hardcoded en el repo, (2) compliance SII/Ley 19.628 con gaps de configuración (retention lock + IDOR en consentimientos ESG), y (3) servicios skeleton en producción consumiendo (o dejando de consumir) eventos P0 de seguridad física.

**Conteo consolidado** (tras unificar duplicados cross-dimensión):

| Prioridad | Cantidad | Origen principal |
|---|---|---|
| **P0** | 9 | security (5), sre (3), deps (1) |
| **P1** | 12 | sre (5), security (parcial), deps (2), perf (varios) |
| **P2** | ~20 | perf, security, debt, sre, arch |

**Veredicto**: NO listo para firmar caminos críticos (SRE: Signed Off NO). NO bloqueante para seguir desarrollando, pero hay **3 P0 con dimensión legal** (🔒 retention lock DTE, IDOR consent ESG, PII en git) que requieren revisión legal + versionado y NO admiten edit directo. La arquitectura está lista para TRL 10; la **operación y el compliance no**.

---

## Estado de pago (actualizado 2026-06-14, post-sesión)

| Hallazgo | Estado | PR |
|---|---|---|
| P0-H timeout Routes API | ✅ resuelto | #468 |
| P0-F Hono → 4.12.25 (reclasificado moderate) | ✅ resuelto | #468 |
| P1-D tmp override ≥0.2.6 | ✅ resuelto | #468 |
| P0-D GCP IDs hardcodeados | ✅ resuelto | #469 |
| P1-A alertas backlog Wave 2 | ✅ resuelto (⚠️ requiere `terraform apply`) | #470 |
| P0-G skeletons safety | ⏳ requiere decisión PO (P1-A mitiga visibilidad) | — |
| P0-A retention lock DTE 🔒 | ⏳ revisión legal | — |
| P0-B IDOR consent ESG 🔒 | ⏳ revisión legal | — |
| P0-C PII Firebase UIDs en git 🔒 | ⏳ revisión legal | — |
| P0-E aislamiento Firebase dev/prod | ⏳ pendiente | — |
| P0-I deploy GKE manual | ⏳ pendiente | — |

El resto de P1/P2 abajo sigue pendiente salvo lo marcado arriba.

---

## P0 — Bloqueante (riesgo legal / seguridad / outage)

| ID | Dim | Ruta:línea | Evidencia | Impacto | Esfuerzo | Deps |
|---|---|---|---|---|---|---|
| **P0-A** 🔒 | security/sre | `infrastructure/storage.tf:145-151`, `crash-traces.tf:86` | `is_locked=false` en buckets DTE/crash | Viola Código Tributario Art. 17 si hay DTEs reales | S (config) + legal | Paquete DTE (P1-F/G) |
| **P0-B** 🔒 | security | `apps/api/src/routes/me-consents.ts:85-95` | `portafolio_viajes` no valida scope_id vs trips del otorgante | IDOR sobre datos de terceros, Ley 19.628 Art. 4 | M + legal | Hermano P1-B |
| **P0-C** 🔒 | security | `apps/api/src/services/harden-demo-accounts.ts:33-38` | 4 Firebase UIDs reales versionados (PII) | PII en historial git indefinido, Ley 19.628 | M (filter-repo + legal) | — |
| **P0-D** | security/debt | `apps/api/src/config.ts:566`, `server.ts:625`, `certificate-generator/src/tipos.ts:118` | Project ID + billing account + KMS path hardcoded como defaults | Information disclosure / reconocimiento GCP | S | — |
| **P0-E** | security | `apps/web/.env.local:18` | reCAPTCHA site key de prod; sin aislamiento Firebase dev/prod | Acciones dev golpean prod | M (proyecto Firebase dev) | P2-5 |
| **P0-F** | deps | `hono@4.12.18` en api/whatsapp-bot/sms-fallback-gateway | GHSA-2gcr-mfcq-wcc3: IDOR `app.mount()`, JWT bypass, cookie injection, IP bypass | Vuln High explotable en PRODUCCIÓN | S (<1h, patch) | **Quick win** |
| **P0-G** | sre/debt | `apps/notification-service/src/main.ts` + `messaging.tf` | Skeleton consume `telemetry-events-safety-p0-notification-sub` (crash/unplug/jamming) | Eventos P0 de seguridad física sin consumidor → notificación al transportista nunca ocurre | M | P1-A, P1-F |
| **P0-H** | sre | `apps/api/src/services/routes-api.ts:179` | `fetch` a Google Routes API sin AbortController/timeout | Respuesta lenta agota slots de concurrencia Cloud Run | S (patrón en gemini-client.ts:88) | **Quick win** |
| **P0-I** | sre | `cloudbuild.production.yaml` (step gke-deploy-instructions) | GKE deploy del tcp-gateway es manual, sin rollback ni gate | Deploy parcial: gateway queda en versión vieja sin alerta | M (gate) / L (VPC) | — |

### Detalle P0

**P0-A 🔒 (CONGELADO legal)** — Política de 6 años (189216000s) configurada pero `is_locked=false` permite a un admin GCP destruir DTEs antes del plazo. Aparece en security P0-4 + sre F-12. El gate del comentario ("bucket vacío / 0 tráfico DTE") es válido HOY (`DTE_PROVIDER=disabled`). No bloqueante hasta el primer DTE real, pero el PR que active Sovos DEBE activar `is_locked=true` con sign-off PO + asesor legal. Versionar en ADR-007. **No editar directo.**

**P0-B 🔒 (requiere revisión legal)** — El propio código tiene comentario "P1: validar que TODOS los trips del portafolio sean de empresas donde el user es dueño/admin". Un `visualizador`/`conductor` puede otorgar grants ESG sobre trips de otra empresa → consentimiento inválido sobre datos de terceros. Hermano: P1-B (mismo patrón para `generador_carga`/`transportista`/`organizacion`, `me-consents.ts:98-106`).

**P0-C 🔒 (requiere revisión legal)** — `OLD_DEMO_UIDS` post-disclosure (ADR-053). Mover a Secret Manager + evaluar `git filter-repo` sobre historial con asesor legal.

**P0-D** — Defaults Zod con `'booster-ai-494222'`, billing `019461_C73CDE_DCE377`, dataset BigQuery. Mover a variable Terraform sin default; `gcpProjectId` sin fallback a prod.

**P0-E** — NO trackeado en git (`.gitignore` lo excluye, confirmado), pero revela una sola cuenta Firebase/reCAPTCHA sin aislamiento dev/prod. Crear proyecto Firebase dev + rotar key.

**P0-F** — Único P0 que es **quick win puro** (patch backward-compatible, <1h). `pnpm update hono@^4.12.25 --filter api --filter whatsapp-bot --filter sms-fallback-gateway`. **Por aquí se empieza.**

**P0-G** — Los 3 servicios son `logger.info('starting (skeleton)')`. La subscription `telemetry-events-safety-p0-notification-sub` apunta a notification-service sin consumidor. Los eventos unplug/jamming SÍ alertan vía log, pero **la notificación al transportista no ocurre**. **Decisión PO requerida**: implementar consumidor mínimo, o eliminar skeletons de Cloud Run y añadir alertas de backlog.

**P0-H** — Único cliente HTTP del repo sin AbortController (Twilio, Sovos, Gemini sí). **Quick win**: copiar patrón de `gemini-client.ts:88-90`, timeout 8-10s.

**P0-I** — Step `gke-deploy-instructions` emite instrucciones por stdout en vez de `kubectl set image` (limitación VPC peering). Corto plazo: gate que verifique imagen GKE == `_COMMIT_SHA`. Largo plazo: conectividad VPC privada.

---

## P1 — Este sprint

| ID | Dim | Ruta:línea | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| **P1-A** | sre | `telemetry-monitoring.tf:379`, `messaging.tf` | 4 subs Wave 2 sin alerta `oldest_unacked_message_age` | Consumer detenido pasa desapercibido días | S |
| **P1-B** | security | `apps/api/src/routes/me-consents.ts:98-106` | Consent empresa no valida `empresaId===scope_id` | IDOR: dueño A otorga grants sobre empresa B | M |
| **P1-C** | deps | drizzle-kit/vite/vitest → `esbuild` | GHSA RCE + file read | High, build/dev-time, supply chain | M (override) |
| **P1-D** | deps | `@testcontainers/redis@12.0.0 → tmp@0.2.5` | GHSA-ph9p path traversal | High, dev-only pero corre en CI | S (<30min) |
| **P1-E** | sre | `cloudbuild.production.yaml:266,339-344` | `_CANARY_MIN_REQUESTS=0` → gate sin muestra | Canary promueve a 100% sin validar SLO | S |
| **P1-F** | sre | `messaging.tf:83-91` | `document-events` topic sin subscription/DLQ | DTE/OCR publicados se pierden silenciosamente | S |
| **P1-G** | sre | `apps/api/src/config.ts:358`, `dte-emitter-factory.ts` | `DTE_PROVIDER=disabled` sin alerta de emisión fallida | Al activar Sovos: deuda fiscal invisible | S |
| **P1-H** | sre | `apps/api/drizzle/` (41 migrations) | Sin down migrations; rollback DDL manual | Migración errónea → recovery manual en prod | M |
| **P1-I** | perf | `apps/api/src/services/matching.ts:191-207` | N+1: SELECT vehículo por candidato en loop | 20 candidatos = 21 queries; hot path | S (2-3h) |
| **P1-J** | perf | `apps/web/src/router.tsx` | Zero code-splitting; 30 rutas síncronas | LCP >5s en 3G; bundle inicial -40-60% recuperable | M (1-2 días) |
| **P1-K** | perf | `0004_...sql:267`, `matching-v2-lookups.ts:92` | Falta índice `(empresa_id, entregado_en)` en asignaciones | Matching v2 lento con histórico grande | S (1h) |
| **P1-L** | security | `apps/telemetry-tcp-gateway/src/imei-auth.ts:32-66` | Open enrollment TCP sin rate limiting | Atacante en red agota FDs/memoria | M |

**Notas de dependencia**: P1-B complementa P0-B (un solo PR de hardening de `me-consents.ts`). P1-F/G dependen de P0-A (paquete coordinado "activar DTE real"). P1-I/K son del mismo hot path del matching engine (quick wins de backend).

Otros P1 de security (menor esfuerzo): P1-1/P1-2 (`sql.raw()` con constante — documentar por qué es seguro), P1-4 (`/public/tracking/:token` sin rate limiting — Cloud Armor), P1-6 (Twilio status callback reconstruye URL para HMAC → usar `STATUS_WEBHOOK_URL`).

---

## P2 — Siguiente

**Performance**: N+1-002 chat-whatsapp-fallback, N+1-003 reconciliarDtes, N+1-004 procesar-cobranza (bulk UPDATE CASE), ASYNC-002, PWA-002 (offline conductor), VITALS-002 (skeleton mapa/CLS), RERENDER-001/002/003, BUNDLE-002/004 (se resuelven con P1-J). **Discrepancia a verificar**: perf dice `idleTimeoutMillis` ausente en `client.ts`; sre dice 30s configurado.

**Security**: P2-3/P2-10 Trivy `exit-code:'0'` (`security.yml:111,122`), P2-7 verificar `recordStakeholderAccess` en endpoints ESG (audit bloqueante, Ley 19.628 Art. 12), P2-9 org-policy `allow_all=TRUE` amplio, P2-6 bucket certificates con key compartida, P2-2 console.* en scripts CI.

**SRE**: F-09 (spans OTel de negocio), F-10 (sms-fallback sin DLQ), F-11 (`min_instances=0` latente), F-13 (sin SLOs formales `google_monitoring_slo`), F-14 (chat fallback RUN_LIMIT 100 vs Scheduler 60s timeout → reducir a 50).

**Deps**: Turbo 2.9.12→2.9.18 (CSRF/session fixation), qs/ws/protobufjs moderates, sync drift typescript/vitest.

**Arquitectura / Tech-debt**: ARCH nomenclatura deprecated Carrier/Shipper en `schema.ts` (1859, 2007, 2039) → ADR-065 de migración; TD3 3 TODOs sin issue (se resuelven con P0-G); OnboardingForm.tsx `as unknown as` sin Zod.

---

## Secuencia recomendada de pago

**Por dónde empezar: P0-F (Hono).** Único P0 que es patch backward-compatible de <1h, mitiga una vuln High explotable, y desbloquea merge sin tocar lógica. Junto con P0-H (Routes API timeout) y P1-D (tmp) forman un **primer PR de quick wins de seguridad/operación** de medio día.

**Sprint 1 — P0 + quick wins:**
1. P0-F Hono 4.12.25 (deps, S, merge blocker).
2. P0-H Routes API AbortController (sre, S).
3. P1-D tmp/@testcontainers (deps, S).
4. P0-D des-hardcodear project/billing/KMS (security, S).
5. P1-A alertas `oldest_unacked` 4 subs Wave 2 (sre, S) — **mitigación inmediata de P0-G**.
6. P1-I N+1 matching + P1-K índice asignaciones (perf, S, mismo path).
7. P0-E proyecto Firebase dev + rotar reCAPTCHA (security, M).

**Sprint 2 — P1 con dependencias:**
8. PR de hardening `me-consents.ts`: P0-B + P1-B juntos — **requieren revisión legal** (arrancar ticket legal desde Sprint 1).
9. P0-C OLD_DEMO_UIDS a Secret Manager + ticket legal `git filter-repo`.
10. P1-C esbuild override + vite 6.4.2 (deps, M).
11. P1-J code-splitting `lazyRouteComponent` (perf, M).
12. P1-E `_CANARY_MIN_REQUESTS` + P1-H doc down-migrations (sre).
13. P1-L rate limiting TCP gateway (security, M).

**Sprint 3+ — paquete DTE coordinado + P2 estructural:**
14. **Paquete "activar DTE real"** (gated por decisión PO de activar Sovos): P0-A retention lock + P1-G alerta emisión fallida + P1-F subscription/DLQ `document-events`. Sign-off legal + PO.
15. P0-G / P0-I decisión arquitectónica de skeletons y deploy GKE (ADRs propuestos).
16. P2 estructural: OTel spans de negocio (F-09), SLOs formales (F-13), ADR-065 Carrier/Shipper, Trivy gates.

---

## Hallazgos cruzados (consolidados)

1. **`is_locked=false` (P0-A)** → security P0-4 + sre F-12. Retention lock WORM no activado.
2. **Project ID / billing hardcoded (P0-D)** → security P0-2/P2-1/P2-4 + tech-debt TD4. Mismo literal en 3 archivos.
3. **Skeletons en producción (P0-G)** → sre F-03 + tech-debt TD3 + arch. tech-debt lo minimiza (P2); **sre lo eleva a P0** por subscriptions safety apuntándoles. **Gana sre (P0).**
4. **IDOR consent ESG (P0-B + P1-B)** → security P0-5/P1-5/P1-7. Un módulo (`me-consents.ts`), dos variantes. Se pagan juntas.
5. **Hono vuln (P0-F)** → deps §3.2.4 + security (la vuln incluye IDOR + JWT bypass). El update ES la mitigación.
6. **PII en código/git (P0-C)** → security P0-3 + P1-8. Mismo hallazgo, esfuerzo distinto (código vs historial).
7. **Falta de staging / E2E contra prod** → arch §F + sre Compliance. Decisión deliberada conocida (#STAGING-ENV). No se eleva; contexto.
8. **Alertas de backlog Pub/Sub (P1-A)** → sre F-05; es la mitigación operacional de P0-G. Pagar P1-A primero da visibilidad.
9. **Discrepancia `idleTimeoutMillis`** → perf COLD-001 dice "ausente"; sre dice "30s configurado". Verificar `apps/api/src/db/client.ts`. P2 hasta resolver.

---

**TOP5 P0**: P0-F, P0-H, P0-G, P0-B, P0-A
