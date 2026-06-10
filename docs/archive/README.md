# docs/archive/

Documentos archivados que tuvieron un rol activo y fueron superseded por artefactos vivos en `.specs/`, `docs/adr/`, `docs/handoff/` o `CLAUDE.md`.

## Regla

Un documento se archiva acá cuando todos sus contenidos están reflejados en otro lugar del repo que es la fuente de verdad actual. **NUNCA** se borra del git (history se preserva via `git mv`) — esto permite trazar qué decisiones se tomaron en qué momento.

Cada archivo lleva frontmatter YAML al inicio con:

```yaml
---
archived_at: YYYY-MM-DD
archived_in: <PR description>
superseded_by:
  - <ruta al sucesor 1>
  - <ruta al sucesor 2>
archived_reason: |
  <por qué se archiva, en 1-3 líneas>
status: archived
---
```

## Convención de naming

`docs/archive/YYYY-MM-DD-<slug-en-kebab-case>.md` donde la fecha es la del archivado (no la del documento original).

## Catálogo

| Archivo | Origen | Superseded by |
|---|---|---|
| `2026-05-17-audit.md` | `AUDIT.md` (raíz, 2026-05-01) | `.specs/audit-2026-05-14/inventory.md` |
| `2026-05-17-plan-phase-0.md` | `PLAN-PHASE-0.md` (raíz, greenfield init) | `.specs/production-readiness/spec.md+roadmap.md`, ADR-042, ADR-043, `CLAUDE.md §"Reglas de naming bilingüe"` |
| `2026-05-17-design.md` | `DESIGN.md` (raíz, 2026-04-30) | `packages/ui-tokens/`, `design-system/MASTER.md` (futuro) |
| `2026-06-10-wave-2-3-deploy.md` | `docs/runbooks/wave-2-3-deploy.md` | `cloudbuild.production.yaml`, ADR-059, `scripts/deploy-telemetry-gateway.sh` |
| `2026-06-10-dns-migration-godaddy-to-cloud-dns.md` | `docs/runbooks/dns-migration-godaddy-to-cloud-dns.md` | `infrastructure/networking.tf` (zona Cloud DNS) |
| `2026-06-10-twilio-sender-registration.md` | `docs/runbooks/twilio-sender-registration.md` | `infrastructure/variables.tf` (sender registrado) |
| `2026-06-10-credential-rotation-2026-04.md` | `docs/runbooks/credential-rotation-2026-04.md` | `infrastructure/security-hotfixes-2026-05-14.tf`, `docs/runbooks/secret-init-runbook.md` |

## No-goals

- Esto **no** es un dumping ground. Si un doc se archiva, debe tener `superseded_by` real y verificable (no `TBD`).
- Si un doc no tiene sucesor pero sigue siendo histórico relevante (ej. retros, RFCs cerrados), mejor ubicación es `docs/decisions/` o `docs/retros/` (no este folder).
- Si un doc tiene contenido obsoleto pero parcialmente válido, **NO** se archiva: se actualiza in-place y se queda donde está.
