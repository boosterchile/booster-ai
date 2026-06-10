# Plan: docs-runbooks-staleness

- Spec: .specs/docs-runbooks-staleness/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Correcciones in-place (dr-failover banner, oncall, content-sids, secret-init, guía demo, goal-templates)
- Files: docs/runbooks/{dr-failover-test,oncall-telemetry-incidents,load-content-sids,secret-init-runbook,goal-templates}.md, docs/demo/guia-uso-demo.md
- LOC estimate: ~80
- Acceptance: spec §10 T1–T3, T5.

### T2: Archivar 4 runbooks ejecutados/obsoletos + catálogo
- Files: docs/runbooks/{wave-2-3-deploy,dns-migration-godaddy-to-cloud-dns,twilio-sender-registration,credential-rotation-2026-04}.md → docs/archive/2026-06-10-*.md, docs/archive/README.md
- LOC estimate: ~50 (frontmatter ×4 + catálogo)
- Acceptance: spec §10 T4.
