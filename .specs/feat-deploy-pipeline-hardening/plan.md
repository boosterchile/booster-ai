# Plan: feat-deploy-pipeline-hardening

- Spec: .specs/feat-deploy-pipeline-hardening/spec.md
- Created: 2026-06-11
- Status: Complete

### T1 [DONE]: canary-verify real (Monitoring API, error_rate+p95, defensivo sin-muestra)
### T2 [DONE]: release.yml espera CI Success del mismo SHA (gh api poll, 30min timeout)
### T3 [DONE]: var sre_webhook_url + canal count-gated + 20 policies → local.alert_channel_ids
