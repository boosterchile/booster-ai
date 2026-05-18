# RFP — Auditoría de seguridad pre-launch para Booster AI

**Fecha de emisión**: 2026-05-18
**Autor**: Felipe Vicencio (`dev@boosterchile.com`)
**Empresa**: Booster AI (marketplace B2B de logística sostenible Chile)
**Refs internos**: `.specs/production-readiness/spec.md` SC-24, `.github/workflows/security.yml`, [`docs/adr/009-competitive-analysis-and-differentiators.md`](../adr/009-competitive-analysis-and-differentiators.md), [`docs/adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md`](../adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md), [`docs/adr/035-auth-universal-rut-clave-numerica.md`](../adr/035-auth-universal-rut-clave-numerica.md), future ADR-048 (strangler vs cutover microservicios, a producir en S0.9)
**Status global del RFP**: Drafted (pendiente envío PO — ver §"Shortlist y envíos")

---

## 1. Objetivo

Contratar un vendor third-party para ejecutar **penetration test + OWASP Top 10 review** sobre Booster AI en staging, **antes del primer cliente comercial pagando** (SC-27a del plan production-readiness). El reporte priorizado por severidad alimenta los fixes que cierran SC-24 (0 findings P0/P1 abiertos al merge final).

El audit cubre:

- **Producto**: web app PWA multi-rol (shipper / carrier / driver / admin / stakeholder ESG), API HTTP (Hono + Drizzle + Postgres), microservicios extraídos (notification, matching, document) tras S3/S4.
- **Channels críticos**: auth universal RUT + clave numérica (Wave 4), Firebase ID token, OIDC SA-to-SA (Cloud Run inter-service), webhook WhatsApp (Meta Cloud + Twilio), public tracking link (UUID v4 opacity), web push (VAPID).
- **Compliance objetivo**: OWASP Top 10 (2021) mitigado; sin findings P0/P1 abiertos pre-launch.

---

## 2. Scope del audit

### 2.1 In-scope

| Item | Notas |
|---|---|
| **Web app PWA** (`apps/web` en staging) | Por rol: shipper / carrier / driver / admin / stakeholder. IDOR, XSS, CSRF, SSRF, autorización tenant-scoped (RLS). |
| **API HTTP** (`apps/api` en staging) | Auth flows (RUT + clave numérica, Firebase, OIDC), endpoints `/me/*`, `/empresas/*`, `/trip-requests-v2/*`, `/admin/*`, `/documentos/*`, `/cumplimiento/*`. OWASP API Top 10 (2023). |
| **Microservicios extraídos** (notification, matching, document) | Solo aplica si están deployados en staging al momento del audit (cronograma sugiere post-S4, sem ~7-8 del sprint plan). |
| **Webhook WhatsApp** (`apps/whatsapp-bot`) | Validación firma Meta + Twilio, idempotencia mensajes, IDOR sobre conversación cross-tenant. |
| **Telemetry TCP gateway** (`apps/telemetry-tcp-gateway`) | Validación protocol Codec8 Teltonika, DoS resistance (1000+ conexiones target), TLS mTLS Wave 3. |
| **Public tracking endpoint** (`/public/tracking/<uuid>`) | Opacity del UUID v4, rate limiting, info disclosure (driver name, plate, telemetría <30min ventana). |
| **Web push (VAPID)** | Subscription token leakage, push payload validation. |
| **Secret Manager + KMS** | Validación de IAM bindings, separación SA por servicio, no API keys en repo. |
| **Configuración GCP** (Cloud Run, GKE, VPC, IAM) | Misconfigurations de IAM, exposed ports, missing private service connect, log exclusions audit. |
| **Dependencias** | OSS dependencies (npm audit + Snyk-style review); vulnerabilities CVE >= HIGH. |

### 2.2 Out-of-scope (este audit)

- DDoS testing al volumen comercial (separado, post-launch en `apps/api/test/load/` — S8 del roadmap).
- Compliance regulatorio formal (GLEC, SII) — auditado en RFPs separados.
- Social engineering / red team escalado (post-launch comercial).
- Auditoría operacional de telemetría (data quality / falsos positivos).
- Smart contracts / blockchain (no aplica — Booster no usa).

### 2.3 Entornos de testing

| Entorno | URL/acceso | Datos |
|---|---|---|
| **Staging** | https://staging.boosterchile.com + URLs internas Cloud Run | Sintético + clones anonimizados; cero PII real. |
| **Dev local** | Docker compose | Para vendor que prefiera scope local primero. |

El vendor recibe SA credentials + VPN si requiere acceso a recursos privados. NDA mutuo firmado pre-acceso.

---

## 3. Deliverables esperados

| # | Deliverable | Formato |
|---|---|---|
| 1 | Executive summary | PDF 1-2 páginas, audiencia C-level |
| 2 | Findings report priorizado | PDF/Markdown estructurado por severidad (Critical/High/Medium/Low/Info) con CVSS scoring v3.1 |
| 3 | Reproducción técnica por finding | PoC code + steps to reproduce + impact analysis |
| 4 | Remediation recommendations | Específicas y accionables, no genéricas |
| 5 | Re-test post-fixes | ≥1 ronda incluida para verificar Critical/High fixes |
| 6 | OWASP Top 10 + API Top 10 coverage matrix | Mapping de cada categoría a hallazgos (o ausencia justificada) |
| 7 | Letter of attestation | Firmado por vendor declarando alcance + metodología + período del audit |

---

## 4. SLAs esperados

| Métrica | Target |
|---|---|
| Lead time desde firma de contrato hasta inicio audit | ≤ 2 semanas |
| Duración del audit activo (vendor trabajando) | 2–3 semanas (depende de scope) |
| Lead time desde audit hasta primer draft de findings | ≤ 1 semana post-audit |
| Tiempo para re-test post-fixes | ≤ 1 semana post-fixes Critical/High |
| **Total end-to-end** (firma → certificación final) | **≤ 6 semanas** |
| Rondas de re-test incluidas | ≥ 1 (Critical/High) |
| Confidencialidad | NDA mutuo firmado pre-acceso |
| Idioma deliverable | Inglés (preferible) o español |

---

## 5. Estructura comercial esperada

- **Pricing**: fee fijo all-inclusive preferido. Variables aceptables: extensión de scope, rondas extra de re-test, post-launch follow-ups.
- **Pago**: 30% kickoff / 40% post-draft findings / 30% post-re-test final.
- **Rango referencia mercado** (esperado): USD 12 000 – USD 35 000 para alcance descrito (web + API + microservicios + 2 webhooks + GCP config review). Si propuesta excede, justificar.
- **Forma de contratación**: contrato estándar del vendor, revisado por abogado de Booster. Jurisdicción Chile o internacional reconocida.

---

## 6. Timeline objetivo

| Hito | Fecha objetivo |
|---|---|
| RFP enviado a shortlist | **Semana de 2026-05-19** (PO send) |
| Respuestas de vendors recibidas | Semana de 2026-06-02 |
| Selección + contrato firmado | Semana de 2026-06-16 |
| Audit kickoff (vendor inicia trabajo) | Semana de 2026-06-30 (alineado con S3/S4 microservicios extracted) |
| Draft findings recibido | Semana de 2026-07-21 |
| Fixes P0/P1 mergeados | Semana de 2026-07-28 (lane Felipe en S12) |
| Re-test + certificación final | Semana de 2026-08-04 |

Alineado con S12 del roadmap maestro (fixes hallazgos pentest, 2-4 sem lane Felipe).

---

## 7. Shortlist y envíos

> **Estado**: shortlist por **categoría de vendor** redactada por el agente; los nombres comerciales específicos quedan para que el PO los complete y envíe (acción humana). Esta sección se actualiza con vendor + fecha + status real post-envío.

> **Por qué categoría y no nombre**: los nombres comerciales de vendors de pentest son información comercial sensible que conviene mantener en envíos directos del PO (no en repo público). Los criterios de selección de cada categoría sí están acá.

| Categoría | Perfil esperado | Vendores típicos en mercado (PO valida) | Status | Fecha envío | Respuesta |
|---|---|---|---|---|---|
| **Global EMEA boutique** | Application security consultancy con presencia UK/US/Madrid, experiencia con SaaS B2B y plataformas con telemetría IoT. Pentesters con OSCP/OSCE/CREST. Entrega tradicional PDF firmado. | NCC Group, Bishop Fox, Praetorian | Drafted-pending-PO-send | TBD | TBD |
| **Boutique chileno / LATAM** | Startup de security automation + pentest con presencia Chile o LATAM; foco en compliance LATAM (Ley 21.459 Chile + LGPD Brasil + ISO 27001); buena relación con ecosistema startup chileno. | (PO completa: ver https://startupsofchile.com cybersecurity directory) | Drafted-pending-PO-send | TBD | TBD |
| **Pentest-as-a-service (US)** | Plataforma SaaS con pool de pentesters validados; rapid kickoff ≤1 sem; integración con GitHub Issues; dashboard estructurado para findings. | Cobalt, Synack | Drafted-pending-PO-send | TBD | TBD |

### 7.1 Criterios de selección de la shortlist

- **Acreditación**: el vendor o sus pentesters individuales deben tener certificaciones reconocidas (OSCP / OSCE / OSEP / CREST / CEH master / similares).
- **Experiencia stack relevante**: Node.js + TypeScript + Hono + Drizzle + Postgres + GCP. Bonus si tienen casos previos con Firebase Auth y Cloud Run OIDC SA-to-SA.
- **Familiaridad LATAM** (mid-priority): si el vendor o pentester individual entiende contexto regulatorio Chile/LATAM (Ley 21.459, LGPD, frameworks comunes en B2B mid-market).
- **Modalidad de entrega**: estructurada (dashboard) o tradicional (PDF firmado). Ambas válidas, evaluar fit operacional con flujo de Booster (GitHub Issues + ADRs).

### 7.2 Mensaje template para envío PO

Texto sugerido para que el PO copie/edite al enviar:

```
Asunto: RFP — Pre-launch security audit (pentest + OWASP) for Booster AI (Chile)

Hello,

I'm Felipe Vicencio, founder of Booster AI — a B2B sustainable logistics
marketplace in Chile, preparing pre-launch security audit before first paying
client.

Stack: Node 22 + TypeScript + Hono + Drizzle + Postgres + Firebase Auth +
Google Cloud Platform (Cloud Run + GKE Autopilot + KMS + Secret Manager).
Web frontend: React 18 + Vite + PWA.

Looking for pentest + OWASP Top 10 / API Top 10 review on staging. Full
scope, deliverables, SLAs, pricing range, and timeline in attached RFP
(or via this GitHub link: <RFP url>).

Would appreciate:
- Confirmation of fit with your practice.
- Preliminary proposal (pricing range + timeline).
- Any clarifying questions on scope.

Best,
Felipe Vicencio
Booster AI · dev@boosterchile.com · +56 ...
```

### 7.3 Tracking post-envío

Después del envío real, esta tabla se actualiza con:
- `Vendor` (nombre real seleccionado por categoría).
- `Status: Sent` + fecha real.
- `Respuesta`: Pending → Received YYYY-MM-DD (link a thread / archivo de propuesta en `.private/security-rfp-responses/` gitignored).
- Decisión final + razón (selected / declined / no-response).

Si alguno no responde en 2 semanas, ampliar shortlist (categorías backup: Trustwave LATAM, Birmingham Cyber Arms LATAM, otros vendors LATAM regionales).

---

## 8. Anexos referenciados

- **`.specs/production-readiness/spec.md` SC-24** — el criterio que esta RFP cierra (0 findings P0/P1 abiertos al merge).
- **`.github/workflows/security.yml`** — checks de seguridad ya existentes en CI (gitleaks, CodeQL, Trivy, npm audit, SBOM). El audit external es complementario, no reemplaza estos.
- **`docs/adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md`** — modelo de autorización multi-tenant que el audit debe validar.
- **`docs/adr/035-auth-universal-rut-clave-numerica.md`** — auth universal RUT (Wave 4 prod desde 2026-05-13).
- **Future ADR-048** — strangler vs cutover microservicios; pentest scope incluye microservicios solo si están deployados al momento del audit.

---

## 9. Decision log

- **2026-05-18** — Initial draft (Sprint S0 T7). Shortlist redactada **por categoría** (global EMEA boutique / boutique LATAM / pentest-as-a-service US); nombres comerciales específicos quedan para que PO los seleccione y envíe directamente (información comercial sensible mantenida fuera del repo público).
