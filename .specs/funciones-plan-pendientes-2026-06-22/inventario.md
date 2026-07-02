# Inventario — Funciones del plan inicial NO implementadas / no desarrolladas

**Fecha**: 2026-06-22
**Método**: 3 subagentes en paralelo (minar gaps ya catalogados · extraer plan de los ADRs/playbooks · inventariar código vivo) + verificación directa de discrepancias contra el código.
**Fuente del "plan inicial"**: ADRs 004-070 (visión/producto), playbooks 001/002, README, plan phase-0 (archivado), `.specs/production-readiness/roadmap.md`, y los gap-docs previos (`adr-vs-prod-inventory`, `stubs-decision`, `revision-completa-2026-06-14`).

> **Reconciliación de staleness**: varios gap-docs previos estaban desactualizados. Verificado en código vivo 2026-06-22:
> - `document-service` (527 LOC) y `trip-state-machine` (139 LOC, tabla de transiciones pura ADR-061) **SÍ están construidos** — los docs los llamaban "skeleton/stub de 7-13 LOC" (stale).
> - `carbon-calculator`, `certificate-generator`, `factoring-engine`, `pricing-engine`, `transport-documents`, `coaching-generator`, `driver-scoring` **están construidos y con tests**.
> - matching v2 está **implementado + cableado** (no ausente) — solo apagado por flag.

---

## Resumen ejecutivo

El **núcleo del marketplace está construido y funcional**: ~200K LOC, 7/9 apps y 18/21 packages reales (onboarding, viajes, ofertas, matching v1, telemetría IoT Teltonika, carbono GLEC v3 + certificados KMS, repositorio documental F4, factoring + pricing engines, chat SSE, coaching IA). Los gaps se concentran en **(A) features "moat" ambiciosas nunca construidas**, **(B) features desarrolladas pero dormidas tras flag o sin cablear**, y **(F) todo el bloque de endurecimiento operacional + go-to-market del roadmap (S8-S13) que no se ejecutó**.

---

## Estado de resolución (reconciliado 2026-06-22)

> Tras el goal "resolver todos los gaps 🔴/🟡", se reconcilió cada ítem contra el **código vivo** + los PRs de esta sesión (#509-#527) y merged (#495/#496). **Hallazgo: la mayoría de los gaps de compliance/infra/seguridad YA estaban resueltos** — el inventario base se apoyó en gap-docs stale. El resto **no es agent-resolvable en sesión** (decisión de negocio, feature-producto futura, o bloqueo externo) y se etiqueta con su acción de owner. No se construyen features-producto enteras unilateralmente.

### ✅ Ronda 2 — goal "resolver gaps rojo/amarillo" (2026-06-22)
Producidos como PRs validados (owner aplica/decide; no se flipean flags ni se aplica prod):
| Gap | PR |
|---|---|
| Endpoint geo k-anon stakeholder (B2) — cablea servicio dormido + TDD | #529 |
| SLOs formales + burn-rate alerts (F-13/SC-20) — `terraform validate` OK | #530 |
| DLQ sms-fallback (F-10) | N/A — es webhook HTTP, el consumidor real ya tiene DLQ |
| Spans OTel de negocio (F-09) — helper + 9 operaciones | #531 |
| Trivy gate bloqueante HIGH/CRITICAL (F/P2-3) — 0 findings verificado | #532 |
| 4 alertas CodeQL/high (PIN sesgado + URL substring + log password + regex) | #533 |
| Remueve placeholder `ai-provider` (C) | #528 |
| Cron mensual membership fees pricing v2 (B5) — TDD, pago stub, scheduler pausado | #535 |
| Runbooks por servicio (SC-21) — 9 runbooks + índice | #534 |
| Matching v2 activation | MOOT — ADR-033 ya documenta criterios+backtest; resta solo el flip del PO |

### ♻️ "Gaps" que resultaron YA hechos (docs stale — verificado vs código vivo 2026-06-22)
El inventario base sobrecontaba por gap-docs viejas. Estos NO eran gaps:
| "Gap" del doc | Realidad en código |
|---|---|
| SSE auth token single-use (G, ALTO) | **Hecho** — `mintStreamTicket`/`sse-ticket.ts`, el EventSource usa `?ticket=` single-use (fix-sse-ticket-auth); el follow-up `sse-auth-token-en-url.md` quedó stale |
| Coaching por voz/TTS (D, "en cola") | **Hecho** — `apps/web/src/components/scoring/CoachingVoicePlayer.tsx` + `services/coaching-voice.ts` + tests |
| k6 load-test scripts (F) | **Existen** — `scripts/load-test/telemetry-gateway.ts` (correrlos a escala objetivo es owner/entorno) |
| telemetry-tcp-gateway README `SKELETON` | **Corregido** — el gateway está live; README stale arreglado (#536) |

### ✅ Ya resueltos (merged o PR abierto de esta sesión)
| Gap | Resuelto en |
|---|---|
| REDIS_PASSWORD → Secret Manager (G) | #520 |
| XFF trust boundary + reset-on-success login (G) | #512 |
| IDOR consent P0-B / P0-C (G) | #510 (#495/#496 merged) |
| SSE auth/reconnect chat (G) | #513 |
| Secret Manager hardening (placeholder no tumba boot) (G) | #526 |
| Fan-out safety P0-G (consumer real en apps/api, no skeleton) (F) | #511 |
| Topic huérfano `document-events` (P1-F) | #493 |
| Audit ESG P2-7 | #494 |
| Retention-lock DTE P0-A → MOOT por pivote | #517 / ADR-069 |
| Down-migration strategy (P1-H) | ADR-066 + `drizzle/down/_TEMPLATE.down.sql` |
| canary-verify MQL (error_rate/p95/min_requests reales; `exit 0` = fallback defensivo) | cloudbuild.production.yaml |
| Marketing gateado + /signup (A4 parcial) | #426 (ADR-067) |
| Onboarding admin-gated (A4) | #428 |
| Placeholder `packages/ai-provider` (C) | #528 (removido, typecheck 31/31 ok) |
| **Endpoint geo k-anon stakeholder (B2)** — cablea el servicio dormido | **#529 (ruta + TDD 8 tests, gate dataset-level + filtro comuna + k-anon)** |

### 🔵 NO agent-resolvable — decisión de negocio (código listo, PO activa el flag)
| Gap | Acción del owner |
|---|---|
| Matching v2 backhaul (B1) — **confirmado completo** (449+202 LOC, cero stubs/TODOs) | flip `MATCHING_ALGORITHM_V2_ACTIVATED` (hoy false) cuando haya señal |
| Factoring v1 a escala (B4) | flip `FACTORING_V1_ACTIVATED` + wire partner real (externo) |
| Pricing v2 cobro recurrente (B5) | flip `PRICING_V2_ACTIVATED` + activar cron al 1er carrier de pago |

### 🔵 NO agent-resolvable — feature-producto futura (PO + ADR, fuera de fase)
El roadmap S8-S13 se **despriorizó deliberadamente** por seguridad/compliance/costos. Construir esto es decisión de producto del PO, no un "fix":
- Eco-routing realtime (A1), Observatorio urbano (A2), Gemelos digitales (A3) — ADR-012, fases Q3'26–Q3'27.
- Módulos Admin avanzados (A5) — impersonation, broadcasts, Cmd+K, `audit_log`.
- Endurecimiento S8-S10: load test a escala, DR drill, SLOs formales, runbooks, on-call.

### 🔵 NO agent-resolvable — bloqueo externo / owner-ops
| Gap | Bloqueador |
|---|---|
| Wake-word "Oye Booster" (D) | approval del vendor Picovoice (sin ETA) |
| Pentest externo · cert GLEC externa · cliente piloto · sign-off legal (F) | terceros (lead time) |
| Staging real #STAGING-ENV (F) | 2º proyecto GCP (infra + costo — owner) |
| App Check enforcement server-side (G) | consola Firebase (PO, tras observar tráfico) |
| `terraform apply` de los PRs de infra (#520/#526/ingress) | ops de prod (owner) |

### 🟡 Abierto — requiere spec/decisión antes de tocar (no un fix suelto)
- **Trivy gate bloqueante** (F): cambiar `exit-code` es quality-gate (`.github/workflows`) → CLAUDE.md exige justificación PO; trivy no está instalado local → no se puede verificar si rompe CI con findings existentes → no se flipea a ciegas.
- **`document-indexer` / `carta-porte-generator`** (C): referenciados en specs del pivote F4 → fate incierto; no se borran hasta decidir 4c.
- **consent-scope + audit del endpoint geo** (B2 residual): el endpoint #529 quedó con RBAC-rol + k-anon (privacidad de individuos garantizada); el consent-scope (qué stakeholder ve qué zona) NO es expresable en ADR-028 → decisión Producto/ADR. Ver `.specs/_followups/stakeholder-zonas-consent-scope-y-audit.md`.

---

## A. Funciones del plan NUNCA construidas (ADR aceptado, ~0 código vivo) — los gaps reales

| # | Función | ADR | Estado | Evidencia |
|---|---|---|---|---|
| A1 | **Eco-routing en tiempo real** (detección de congestión desde telemetría → sugerencia de reruteo al conductor por push). El "diferenciador estrella" de ADR-012 Capa 1. | 012 | **No existe** | No hay `apps/eco-routing-service`, `traffic-condition-detector`, `route-alternatives-evaluator`. Solo existe un *eco-route preview* pre-aceptación (`eco-route-preview.ts`), feature más simple y distinta. |
| A2 | **Observatorio urbano** (piloto Coquimbo: métricas por comuna, OD matrix, dashboards municipales, revenue B2G UF 50/mes). | 012 Capa 2 | **No construido** | Surface `/app/stakeholder/zonas` es skeleton con data mock. Sin Dataform/materialized views, sin `routes/observatory/*`. |
| A3 | **Gemelos digitales** (flota per-carrier y ciudad per-comuna; SimPy/Python, Vertex AutoML). | 012 Capa 3-4 | **Backlog explícito** | 0 archivos `.py`. Movido a "Out of scope" en production-readiness (Q1-Q3 2027). |
| A4 | **Sitio marketing + e-commerce** (`apps/marketing` Next.js, checkout self-serve, `payment-provider` Flow/Stripe, pricing público multi-SKU, blog MDX/SEO, A/B testing). | 010 | **No construido** (y `marketing` se sacó del plan en ADR-034) | No existe `apps/marketing`. Onboarding self-serve cerrado por hotfix SEC-001 (`EMPRESA_SELF_ONBOARDING_ENABLED=false`); pilotos provisionados a mano. |
| A5 | **Panel Admin avanzado** (impersonation con audit, broadcasts segmentados multicanal, command palette Cmd+K, tabla `audit_log` 7 años, gestión incidentes/disputas). | 011 | **No construido** (solo el núcleo "admin dentro de apps/web") | Los ~12 módulos específicos = 7🔴 en el inventario; tabla `audit_log` no existe. |
| A6 | **Extracción a microservicios** de matching y notificaciones. | 048 | **Skeletons de 13 LOC** | `apps/matching-engine` y `apps/notification-service` = `logger.info('starting (skeleton)')` + TODO. La lógica vive inline en `apps/api`. (Nota: `document-service` SÍ se extrajo y está funcional.) |

## B. Construido pero DORMIDO (código real, apagado por flag o sin cablear a runtime)

| # | Función | ADR | Estado | Evidencia |
|---|---|---|---|---|
| B1 | **Matching v2 multifactor backhaul-aware** (0.40 capacidad + 0.35 backhaul + 0.15 reputación + 0.10 tier). | 033 | **Implementado + cableado, flag OFF** | `packages/matching-algorithm/src/v2/` real; `services/matching.ts:171-184` branchea en `MATCHING_ALGORITHM_V2_ACTIVATED` (default `false`) → en prod corre v1 greedy. |
| B2 | **Geo-aggregations stakeholder con k-anonymity ≥5** (privacidad zona/comuna). | 041/042 | **Servicio existe, sin endpoint de prod** | `services/stakeholder-aggregations.ts` + helpers + schema + migrations reales, pero ninguna ruta HTTP de producción los expone (la surface es demo). Garantías de privacidad "aspiracionales en prod". Falta también el gate dataset-level `insufficient_data`. |
| B3 | **NLU WhatsApp end-to-end vía Meta** (intents carrier `accept_offer`/`upload_pod`, templates Meta, cutover Twilio→Meta). | 006/025 | **Parcial — cliente Meta desconectado** | Corre solo Twilio; `sendText` de Meta existe pero sin cablear; `packages/ai-provider` = placeholder 7 LOC; sin flag `WHATSAPP_BSP_PROVIDER`. |
| B4 | **Factoring v1 "Cobra Hoy" a escala plena** (partner real, underwriting automático, cesión DTE). | 029/032 | **Engine construido, modo demo/escala mínima** | `factoring-engine` + endpoints + UI reales, pero partner stubeado (sin transferencia), underwriting manual, cesión DTE removida por el pivote. |
| B5 | **Pricing v2 cobro recurrente** (cron membership fees + dunning). | 030/031 | **Engine construido, activación parcial** | `pricing-engine` detrás de flag; `cobrar-memberships-mensual` diferido hasta primer carrier de pago; emisión DTE de liquidación removida. |

## C. Stubs / placeholders explícitos (paquetes vacíos, decisión pendiente)

| Package | LOC | Estado / decisión |
|---|---|---|
| `packages/ai-provider` | 7 | Placeholder. Gemini se integra directo (`services/gemini-client.ts`, ADR-037). Decisión stubs: **eliminar**. |
| `packages/document-indexer` | 7 | Placeholder. Indexación inline con Drizzle. Decisión: **eliminar** (o diferir a fase 4c). |
| `packages/carta-porte-generator` | 7 | Placeholder. **Carta de Porte (Ley 18.290) no implementada**. Rol incierto tras el pivote documental. |

## D. Wave 5 — voz (bloqueado por vendor externo)

| Función | ADR | Estado |
|---|---|---|
| **Wake-word "Oye Booster"** (Porcupine on-device). | 036 | **Stub, no operativo.** Hooks/UI existen (`use-wake-word.ts`, `wake-word.ts`) pero **el SDK real no está instalado** (sin dep `@picovoice` en `apps/web/package.json`); usa controller stub. **Bloqueado por approval de Picovoice (sin ETA).** Modelo custom `oye-booster-cl.ppn` sin entrenar. |
| **Coaching IA por voz/TTS en PWA** (pre-viaje + post-entrega). | Playbook 002 | `packages/coaching-generator` SÍ existe (Gemini, 991 LOC). El delivery por WhatsApp se **canceló**; el delivery por voz/TTS está **en cola** (no construido). |

## E. Plan CAMBIADO — cancelado / superseded (NO son "pendientes")

| Función original | Cambio | Fuente |
|---|---|---|
| **Emisión DTE vía Sovos** (Booster emitía Guía 52 / Factura 33 por el carrier). | **REMOVIDA deliberadamente.** Booster pasa de emisor a receptor/archivador de DTE de terceros (repositorio F4, construido). | ADR-069 (supersede 024) |
| **Retention-Lock WORM bucket DTE (P0-A 🔒)** | **"No aplica"** post-pivote (el lock se ataba a la emisión). | ADR-069 §4 |
| **Adapters DTE multi-vendor** (bsale/defontana/alanube/edicom) + secrets per-carrier | Superseded por el pivote. | ADR-069 |
| **Google sign-in Blocking Function** (gate signup Google) | Superseded por boundary + reaper. | ADR-057 (supersede 054) |
| **Matching geo por bounding-box lat/lng** | Reemplazado por filtro `originComunaCode`. | ADR-042 (supersede 041 §1) |

## F. Endurecimiento operacional + go-to-market — roadmap S8-S13 NO ejecutado

El roadmap maestro production-readiness (S0-S13, 2026-05-17) **casi no se ejecutó**: solo S0 + S1a-BloqueA cerrados. El proyecto pivotó a seguridad/compliance/costos. Pendientes:

- **Load test al volumen target** + perf hardening (S8; solo smoke k6 existe).
- **DR drill ejecutado** (S9; infra DR provista, drill no corrido).
- **SLOs formales** (`google_monitoring_slo`) + burn-rate alerts (S10).
- **Runbooks por servicio (≥10)** + on-call ritual documentado (S9-S10).
- **2º canal de alertas SRE** (Slack/Telegram/SMS para P0).
- **Pentest externo** + OWASP (S12; RFP existe).
- **Certificación GLEC v3.0 externa** (auditor third-party, sello en certificados) (S0 RFP enviado).
- **Cliente piloto firmado y operando** (S13; outreach iniciado, sin contrato).
- **Términos legales revisados por abogado** (S13; el modelo de consentimiento ESG sí avanzó).
- **Entorno staging real** (#STAGING-ENV; el e2e nightly pega a PRODUCCIÓN).
- **`canary-verify` real (MQL check)** (hoy `exit 0` siempre → promoción 1%→100% sin validar SLO).
- **Down-migrations / rollback DDL** (41 migrations sin down).

## G. Fixes de compliance / seguridad aún abiertos (no son "features" pero sí del plan de calidad)

- **IDOR consent ESG `portafolio_viajes` (P0-B 🔒)** y consent empresa (P1-B) — validación de scope_id pendiente.
- **App Check enforcement server-side** — cliente desplegado, enforcement NO activo (decisión PO).
- **SSE auth token single-use** — hoy el ID token viaja en `?auth=` (se filtra a Trace/Logging).
- **`REDIS_PASSWORD` a Secret Manager** (P1, viola CLAUDE.md §Seguridad).
- **XFF trust boundary** en signup/demo-cache-warm; **rate-limit reset-on-success** login.
- **P0-G safety fan-out**: `notification-service` consume el sub `…safety-p0-notification` **sin consumidor** → la alerta al transportista (crash/unplug/jamming) por ese path no ocurre (mitigado por push directo desde api).

---

## Lo que SÍ está construido (para balance)

Núcleo marketplace (onboarding, empresas, viajes, ofertas, asignaciones, RBAC multi-tenant), matching v1, telemetría IoT Teltonika (gateway TCP + processor + Codec8 parser, 10+ devices en prod), carbono GLEC v3 (3 modos + empty-backhaul) + certificados PAdES/KMS, repositorio documental F4 (TED PDF417 + retención custodia 6 años), factoring + pricing engines, chat SSE realtime, coaching IA (Gemini), web push, wake-word *infra* (sin SDK), eco-route *preview*, trip-state-machine (tabla pura), PWA multi-rol (shipper/carrier/driver/admin/stakeholder).

## Top prioridades sugeridas (si se retoma el plan)

1. **Decidir microservicios**: o se implementa el consumer P0-G de safety en `notification-service`, o se retiran los skeletons (la lógica ya corre en api). El gap de safety fan-out es el de mayor riesgo.
2. **Activar lo dormido** (decisión de negocio, no de código): matching v2 (flag), geo-aggregations stakeholder (cablear endpoint), factoring/pricing a escala real.
3. **Endurecimiento operacional** (S8-S10) antes del primer cliente B2B con SLA: SLOs, runbooks, load test, DR drill, canary-verify real.
4. **Eco-routing realtime + observatorio** (ADR-012) — el "moat" de mayor lead time; nunca arrancado.
5. **Limpiar placeholders**: eliminar `ai-provider`/`document-indexer`; decidir `carta-porte-generator` a la luz del pivote.
