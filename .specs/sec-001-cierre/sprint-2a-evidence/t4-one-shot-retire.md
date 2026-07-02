# T4 SEC-001 — One-shot retire evidencia (2026-05-25)

- **Sprint**: 2a
- **Spec**: `.specs/sec-001-cierre/spec.md` §3 H1.1 (SC-1.1.1..SC-1.1.5)
- **Plan**: `.specs/sec-001-cierre/plan-sprint-2a.md` T4
- **ADR**: `docs/adr/053-post-disclosure-account-replacement.md` (Status: Accepted)
- **Runbook**: `docs/qa/demo-accounts.md`
- **Servicio**: `apps/api/src/services/harden-demo-accounts.ts`
- **CLI**: `apps/api/scripts/harden-demo-accounts.mjs`
- **Ejecutado por**: dev@boosterchile.com desde Cloud Shell

## Timeline operacional

| Timestamp UTC | Step | Resultado |
|---|---|---|
| ~19:26 | PR #344 (tsup entry + apply evidencia) green CI, mergeado a `main` | `9956ded` |
| ~19:30 | Cloud Shell clone + `pnpm install` + `pnpm --filter @booster-ai/api build` | `dist/services/harden-demo-accounts.js` generado |
| ~19:32 | `cloud-sql-proxy --port=5432 --auto-iam-authn --private-ip &` | Aceptando conexiones localhost:5432 |
| ~19:48 | `tsx apps/api/scripts/harden-demo-accounts.mjs --recreate` | `created: 4, skipped: 0`, durationMs=4537 |
| 20:42:51 | Cloud SQL proxy accepted connection retire batch | OK |
| 20:42:52..54 | 4× `event: audit.demo_uid_retired` emitted | OK |
| 20:42:54 | `retire-old-batch done`: `retired: 4, skippedAlreadyDisabled: 0, failed: []`, durationMs=3435 | Window-of-overlap CERRADA |

**Window-of-overlap duration**: ~50 minutos (19:48Z recreate → 20:42Z retire). Bien dentro del SLA 4h.

## UIDs nuevas (post-recreate, activas)

| Persona | Email | Firebase UID nuevo | TTL (expires_at) |
|---|---|---|---|
| `generador_carga` | `demo-2026-shipper@boosterchile.com` | `GtVtmajwdtU6UARYQDykP8AW1Vx2` | 2026-06-24 (30d default) |
| `transportista` | `demo-2026-carrier@boosterchile.com` | `4DDODougqUXNkm7jTZJgkJKs5z2` | 2026-06-24 |
| `stakeholder` | `demo-2026-stakeholder@boosterchile.com` | `1h10ASeyeUSP18B7IKLXveZCxt82` | 2026-06-24 |
| `conductor` | `drivers+demo-2026-conductor@boosterchile.invalid` | `P4fuEB3HIzOAqr4m4X1vJjA7cam1` | 2026-06-24 |

Passwords iniciales: Secret Manager `demo-account-password-{shipper,carrier,stakeholder,conductor-firebase}-2026` version 1 (creados por `init-demo-secrets-2026.sh` 2026-05-25 ~17:55Z).

## UIDs viejas (post-retire, disabled — vector cerrado)

| Persona original | Firebase UID viejo | Estado post-retire |
|---|---|---|
| demo-shipper | `nQSqGqVCHGUn8yrU21uFtnLvaCK2` | `disabled: true` + custom claim `audit_demo_uid_retired` |
| demo-stakeholder | `Uxa37UZPAEPWPYEhjjG772ELOiI2` | `disabled: true` + custom claim `audit_demo_uid_retired` |
| demo-carrier | `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` | `disabled: true` + custom claim `audit_demo_uid_retired` |
| conductor (drivers+123456785) | `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` | `disabled: true` + custom claim `audit_demo_uid_retired` |

`cuentas_demo.deshabilitado_en` synced para los 4. Reason: `post-disclosure replacement 2026-05-24 (ADR-053)`.

## Audit log output (extraído de Cloud Shell)

```
[2026-05-25 20:42:52.205 +0000] INFO:
    event: "audit.demo_uid_retired"
    uid: "nQSqGqVCHGUn8yrU21uFtnLvaCK2"
    reason: "post-disclosure replacement 2026-05-24 (ADR-053)"
    message: "harden-demo-accounts.retire: UID disabled + audit log + cuentas_demo.deshabilitado_en synced"

[2026-05-25 20:42:52.988 +0000] INFO:
    event: "audit.demo_uid_retired"
    uid: "Uxa37UZPAEPWPYEhjjG772ELOiI2"
    ...

[2026-05-25 20:42:53.530 +0000] INFO:
    event: "audit.demo_uid_retired"
    uid: "s1qSYAUJZcUtjGu4Pg2wjcjgd2o1"
    ...

[2026-05-25 20:42:54.257 +0000] INFO:
    event: "audit.demo_uid_retired"
    uid: "Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3"
    ...

[2026-05-25 20:42:54.257 +0000] INFO:
    retired: 4
    skipped: 0
    failed: 0
    dryRun: false
    message: "harden-demo-accounts.retireOldBatch: batch complete"

[2026-05-25 20:42:54.258 +0000] INFO:
    result: { "retired": 4, "skippedAlreadyDisabled": 0, "failed": [] }
    durationMs: 3435
    message: "retire-old-batch done"
```

## Verificación success criteria (spec §3 H1.1)

- **SC-1.1.1** (UIDs viejas disabled en Firebase): ✅ 4/4 retired, audit log emitted.
- **SC-1.1.2** (UIDs nuevas operativas con custom claims `is_demo + persona + expires_at`): ✅ 4/4 created, claims set via `setCustomUserClaims`.
- **SC-1.1.3** (cuentas_demo synced): ✅ `firebase_uid` actualizado en recreate, `deshabilitado_en` actualizado en retire.
- **SC-1.1.4** (passwords nuevas en Secret Manager, no en código): ✅ 4 secrets version 1 creados via `init-demo-secrets-2026.sh`.
- **SC-1.1.5** (audit log `event: audit.demo_uid_retired` emitido por cada retire): ✅ 4 eventos visibles arriba; log-based metric `sec001/demo_uid_retired` debería contar 4.

## Follow-ups inmediatos

1. **Cloud Logging metric verification** (Logs Explorer): query
   `logName:"projects/booster-ai-494222/logs/run.googleapis.com%2Fstdout" jsonPayload.event="audit.demo_uid_retired"`
   Debe mostrar 4 eventos del 2026-05-25T20:42Z.

2. **`demo_uid_retired` log-based metric**: ver si el counter incrementó +4 en Cloud Monitoring → Metrics Explorer.

3. **Silent-window guard alert para `demo_uid_retired`** (tracked en `docs/qa/demo-accounts.md` §"Log-based metric ready sin alert todavía"): ahora que hay baseline >0, evaluar crear alert `count(metric) < 4 sustained 4h post-deploy`. Tracked en `.specs/_followups/`.

4. **Renovación TTL próxima**: 2026-06-17 (-7d antes de 2026-06-24) — cron T6a debería emitir `demo.ttl_low` y notificar.

## Referencias

- ADR-053: `docs/adr/053-post-disclosure-account-replacement.md`
- Runbook: `docs/qa/demo-accounts.md`
- Plan Sprint 2a: `.specs/sec-001-cierre/plan-sprint-2a.md` §T4
- Apply terraform: `.specs/sec-001-cierre/sprint-2a-evidence/terraform-apply-2026-05-25.md`
- PR #344 (tsup entry pre-Cloud-Shell): https://github.com/boosterchile/booster-ai/pull/344
