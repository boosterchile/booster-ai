# Followup: migrate-booster-agents-to-plugin-v0.2.0

**Status**: Draft (stub, no ejecutar todavía)
**Created**: 2026-05-20
**Triggered by**: ADR-049 (PR-2 cierra cleanup local pero deja overrides Booster en `agents/` raíz)
**Estimated effort**: 1-2 días (depende de magnitud del coverage diff)

---

## Objetivo

Migrar el contenido específico Booster de `agents/code-reviewer.md`, `agents/security-auditor.md`, `agents/sre-oncall.md` al plugin `booster-skills` v0.2.0 para eliminar los últimos overrides locales y consolidar el source-of-truth en el plugin.

## Trigger (cuándo ejecutar)

Iniciar esta migración cuando ocurra cualquiera de:

- Un PR nuevo necesite modificar uno de los 3 archivos `agents/{code-reviewer,security-auditor,sre-oncall}.md`.
- Se publique `booster-skills@0.2.0` por otro motivo (aprovechar la versión bump).
- El PO marque esta migración como prioridad explícita.

## Inputs requeridos

- [ADR-049](../../docs/adr/049-claude-code-plugin-system-adoption.md) §Replicabilidad (procedimiento de plugin update).
- [`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../../docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md) (template de migración trabajada).
- Coverage diff de los 3 archivos vs plugin actual: ver [`.specs/integrate-booster-skills-plugin/spec-v2-cascade-of-errors.md`](../integrate-booster-skills-plugin/spec-v2-cascade-of-errors.md) §8.R-2.evidence (security-auditor.md con 3 gaps sustantivos: Ley 19.628 / SII-DTE / roles Uber-like).
- [ADR-004](../../docs/adr/004-uber-like-model-and-roles.md): uber-like model + roles.
- [ADR-007](../../docs/adr/007-chile-document-management.md): chile-document-management (SII / DTE).
- [ADR-021](../../docs/adr/021-glec-v3-compliance.md): GLEC v3.0.
- [ADR-034](../../docs/adr/034-stakeholder-organizations.md): stakeholder-organizations (Sustainability Stakeholder).

## Procedimiento (esbozado)

1. **Clonar y branch**: clonar `boosterchile/booster-skills` localmente y crear branch `feat/v0.2.0-chile-compliance-overrides`.
2. **Diseño**: crear nuevo sub-agent `booster-skills:chile-compliance-auditor` que absorba contenido Ley 19.628 + SII/DTE + roles Uber-like + Sustainability Stakeholder. O alternativamente expandir `booster-skills:security-scanner` con esos modules (decisión arquitecto-maestro).
3. **Decisión sre-oncall**: crear nuevo agent `booster-skills:sre-oncall` (no tiene equivalente en agent-rigor) o expandir skill `booster-deploy-cloud-run` con su contenido SRE.
4. **Strict-spec validation**: `claude plugin validate .` + PyYAML para frontmatters + `json.loads` para manifests.
5. **CHANGELOG + version bump**: `version` en `plugin.json` y `marketplace.json` → `0.2.0`; CHANGELOG con notes detalladas.
6. **Release**: tag `v0.2.0` + `gh release create`.
7. **PR-2.1 en repo Booster**: borrar los 3 archivos overrides locales (rollback via plugin cache, mismo patrón de PR-2).
8. **Actualizar CLAUDE.md**: sección "Capas adicionales locales del proyecto" se modifica para reflejar que ya no hay overrides locales (o se elimina si queda vacía).

## Acceptance criteria

- `agents/` raíz vacía o eliminada.
- `/plugin list` muestra `booster-skills@booster-skills v0.2.0`.
- Sub-agent compliance Chile (nombre tbd) accesible vía `Task subagent_type: ...`.
- Coverage diff documentado: 100% del contenido sustantivo de los 3 agents originales presente en el plugin.
- CLAUDE.md sin referencia a `agents/` como capa local (o sección actualizada para reflejar nuevo estado).

## Prompt para sesión futura (copy/paste)

```
Retomar la migración planificada en .specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md.

Contexto previo: PR-2 cerrado, plugin booster-skills v0.1.0 operativo, overrides Booster en agents/{code-reviewer,security-auditor,sre-oncall}.md.

Objetivo de esta sesión: publicar booster-skills v0.2.0 con migración del contenido Chile compliance + borrar overrides locales en PR-2.1.

Leer en este orden antes de actuar:
1. docs/adr/049-claude-code-plugin-system-adoption.md (§Replicabilidad)
2. docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md (ejemplo trabajado completo)
3. .specs/integrate-booster-skills-plugin/spec-v2-cascade-of-errors.md §8.R-2.evidence (coverage diff)
4. docs/adr/004-uber-like-model-and-roles.md
5. docs/adr/007-chile-document-management.md
6. docs/adr/021-glec-v3-compliance.md
7. docs/adr/034-stakeholder-organizations.md
8. agents/code-reviewer.md, agents/security-auditor.md, agents/sre-oncall.md (contenido a migrar)

Aplicar booster-skills:arquitecto-maestro para spec v0.2.0 antes de ejecutar.
```

## Notas

- No es bloqueante para sprints actuales de Booster (S1b, S2, Mini-Sprint 0 OTel, Fase 1.5 Terraform).
- Es deuda técnica conocida con tracking explícito — Principio §1 de CLAUDE.md (Cero deuda técnica day 0) admite deuda **documentada con plan de pago**.
- Si pasan >90 días sin ejecutar, el PO debe re-evaluar prioridad o considerar si los overrides locales se vuelven el estado deseado de facto.
