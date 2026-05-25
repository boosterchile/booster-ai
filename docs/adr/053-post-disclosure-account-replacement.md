# ADR-053: Post-disclosure account replacement (SEC-001 H1.1)

- **Status**: Proposed (2026-05-25; transitions to Accepted at PR #1 Sprint 2a H1.1 merge per plan T7b).
- **Date**: 2026-05-25
- **Deciders**: Felipe Vicencio (PO)
- **Linked**:
  - Spec: `.specs/sec-001-cierre/spec.md` §3 H1.1 (SC-1.1.1..SC-1.1.5), §13 decision log
  - Plan: `.specs/sec-001-cierre/plan-sprint-2a.md` T4 (script + one-shot retire), T7a/T7b (this ADR lifecycle)
  - Origin audit: `feat/security-blocking-hotfixes-2026-05-14:.specs/audit-2026-05-14/security.md` (SHA256 `ea8f258dca391836142165b9ac46de71d1b4c254d2a7309c84f533f4d371add4`)
  - PR de origen del vector: #206 (`feat(demo): subdominio demo.boosterchile.com operativo`)
  - References: NIST SP 800-63 §5.1.1.1 (memorized secret post-compromise); OWASP Top 10 2021 A07 (Identification and Authentication Failures)

## Context

El 2026-05-10 mergeó a `main` el PR #206 que activó `demo.boosterchile.com` con 4 cuentas demo seedeadas en Firebase Auth. El seed contenía un literal password `BoosterDemo2026!` hardcoded en `apps/api/src/services/seed-demo.ts:86` y `seed-demo-startup.ts:142` (Sprint 1 T8 ya migró estos a Secret Manager — ver `infrastructure/security-hotfixes-2026-05-14.tf`).

La auditoría de seguridad del 2026-05-14 (`.specs/audit-2026-05-14/security.md`) catalogó el literal como **public attack surface** dado que el repo `boosterchile/booster-ai` ya tenía el commit `8400542` (literal en plain) push-edo público desde 2026-05-10. 4 días de exposición pública + 4 UIDs de cuentas activas (`nQSqGqVCHGUn8yrU21uFtnLvaCK2`, `Uxa37UZPAEPWPYEhjjG772ELOiI2`, `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1`, `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3`) + emails predecibles (`demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com`, `drivers+123456785@boosterchile.invalid`) constituyen un compromise de la primary credential (password) bajo control del Booster.

Decisión obligada: ¿qué hacer con cuentas Firebase Auth cuya primary credential es públicamente conocida?

## Decision

**Retirar las 4 UIDs comprometidas (irreversiblemente, `disabled: true`) y crear 4 UIDs nuevas con emails nuevos consistentes (substring `demo-2026`) + passwords nuevos (random 128-bit en Secret Manager) + custom claims `expires_at` 30d.**

Esta decisión sigue **NIST SP 800-63 §5.1.1.1** (Memorized Secret Verifiers, sub-sección "Compromised Authenticators"): cuando un authenticator es comprometido, no es suficiente rotar el credential — el authenticator (cuenta) debe ser tratado como compromised hasta que sea explícitamente recreated. La identidad de la cuenta (UID, email) es parte del attack surface bajo modelo de threat de credential stuffing y account enumeration.

OWASP Top 10 2021 **A07: Identification and Authentication Failures** refuerza: predictable email patterns + known passwords + active accounts = brute-force/credential-stuffing target. La defensa estructural es retirement, no rotation.

Concretamente, el plan Sprint 2a T4 implementa:

1. `harden-demo-accounts.ts --recreate`: crea 4 nuevas UIDs con emails `demo-2026-<persona>@boosterchile.com` (con dash entre `demo` y `2026` per spec v3.2 P0-R4-1), passwords from new Secret Manager secrets `demo-account-password-*-2026`, claims `{is_demo: true, persona: <Spanish enum>, expires_at: <now+30d>}`.
2. `harden-demo-accounts.ts --retire-old-batch`: `auth.updateUser(uid, { disabled: true })` para las 4 UIDs originales + audit log entry `audit.demo_uid_retired`.
3. Middleware `demo-expires.ts` enforces `expires_at` server-side con `checkRevoked: true`.
4. Cron `demo-account-ttl-alerter` emite log + Cloud Monitoring alert si TTL < 7d.
5. Cron secondary guard log-based metric: si `count(audit.demo_uid_retired) < 4 WITHIN 4h of deploy_event_timestamp` → alert (silent-window guard).

## Consequences

### Positivas

- **Vector cerrado completamente**: passwords publicados ya no autentican (UIDs disabled); emails publicados ya no pertenecen a cuentas activas; nuevas UIDs siguen pattern `demo-2026-*` distinguible.
- **Audit trail**: Firebase audit log + Cloud Monitoring metric + evidence file dan paper trail completo para compliance Chile (Ley 19.628 + SII).
- **TTL 30d renovable**: forces operational discipline — PO debe renovar via `--renew` periódicamente o la cuenta expira (defense-in-depth si el patrón se repite).
- **Naming compliance CLAUDE.md**: enum values Spanish (`generador_carga`, `transportista`, etc.) per spec v3.3 amendment.

### Negativas

- **Irreversible by design**: si en el futuro descubrimos que retirar fue prematuro (e.g., una de las 4 UIDs tenía data útil), no hay rollback. El paper de SP 800-63 explícitamente acepta esta consecuencia — once-compromised es permanently-compromised.
- **Operational overhead**: PO debe ejecutar manual one-shot post-deploy (SLA 4h, forbidden Friday after 12:00 Santiago per plan T4) + monitor TTL renewals + rotate passwords periódicamente.
- **Email contract drift**: cualquier consumer externo que tuviera hardcoded los emails viejos (improbable pero posible — playbook integrations, monitoring scripts) rompe. Mitigation: emails viejos quedan en `disabled_at` row de `cuentas_demo` para audit reference + sprint 2a evidence documenta el cambio.
- **No-rotation precedent**: este ADR establece que post-disclosure de credenciales públicas para cuentas de servicio/demo, la respuesta estándar es retire+recreate, no rotation. Para cuentas de usuarios reales, política puede diferir (caso por caso per Ley 19.628 obligation to notify).

### Riesgo residual

- **R-DA-IDEMPOTENCY**: si el script T4 `--retire-old-batch` falla mid-batch (network/SDK timeout), estado inconsistente (algunas UIDs disabled, otras no). Mitigation: script idempotente con state-check pre-call + `--dry-run` flag + Cloud Monitoring silent-window guard alert si count <4 within 4h.
- **R-DA-LITERAL-HISTORY**: literal `BoosterDemo2026!` permanece en git history público (force-push imposible en repo público compartido). Spec §9 R-LIT-HIST documenta este residual; aceptado per OWASP irreversibility de public disclosure. Monitoring sostenido 90d (plan Sprint 3 H1.5) detecta intentos retroactivos.

## Alternatives considered

### A. Rotation-only (rotate passwords, keep UIDs + emails)

**Rejected**. NIST SP 800-63 §5.1.1.1 explicitly: rotation of memorized secret no es defensa suficiente cuando authenticator está compromised. El attacker conoce emails + UIDs + login flow — rotation solo cambia el secret pero no neutraliza enumeration risk ni patrones predecibles. Spec v1 originalmente proponía rotation; devils-advocate round 0 (O-11) rejected por OWASP / SP-800-63 alignment.

### B. Monitoring sostenido sin retire (forensia + alert on use)

**Rejected**. Esto reduce el response time, no elimina vector. Cualquier login exitoso post-disclosure es ya un compromise — alert post-facto es inferior a prevent. Spec H1.5 monitoring queda IN-scope como defense-in-depth (post Sprint 2a), no replacement para retirement.

### C. Account suspension sin replacement

**Rejected**. Deshabilita el producto demo (negocio bloqueado) sin abordar reactivación. Booster necesita demo operativa post-cierre per business requirement. Demo se reactiva en Sprint 3 H1.6 con UIDs nuevas + claims + TTL — replacement es prerequisito de reactivación.

### D. Spec hermano dedicado a H1.1 (in vez de in-scope)

**Rejected**. H1.1 está acoplado tightly a H1.4 Secret Manager + H1.3 middleware enforcement + H1.6 reactivación. Split a spec hermano duplicaría context. Spec v3.2 mantiene H1.1 in-scope; this ADR documents the decision.

## Notes for future-self

- Cuando un segundo developer se sume, reconsiderar `enforce_admins=true` + `required_approving_review_count=0` setup (cambiar a count=1 cuando haya 2do dev — plan T0.5 nota).
- Si patrón demo se replica (e.g., staging fixtures publicados), aplicar mismo ADR como template.
- Considerar Firebase App Check + provider gate para reducir attack surface estructural (out-of-scope SEC-001; tracked en backlog).

## Acceptance criterion para transition Proposed → Accepted

Este ADR transiciona a `Status: Accepted` cuando:
1. T4 `harden-demo-accounts.ts` script + tests mergeado en main (PR #1 Sprint 2a).
2. T5 `demo-expires.ts` middleware mergeado.
3. T6a Cloud Monitoring alerts mergeados.
4. One-shot retire ejecutado en prod + 4 UIDs viejas verificadas `disabled === true` via Admin API.
5. T7b commit transition `Status: Accepted` (línea 3 de este file) como parte del PR #1 final commit antes de squash-merge.
