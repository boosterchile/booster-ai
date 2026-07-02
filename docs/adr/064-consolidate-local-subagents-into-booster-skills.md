# ADR-064 — Consolidación de los 3 sub-agents locales en booster-skills@0.3.0

**Estado**: Accepted
**Fecha**: 2026-06-14
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-060](./060-superpowers-replaces-agent-rigor.md) (retiro de agent-rigor), [ADR-049](./049-claude-code-plugin-system-adoption.md), [ADR-004](./004-uber-like-model-and-roles.md), [ADR-007](./007-chile-document-management.md), [ADR-034](./034-stakeholder-organizations.md), `CLAUDE.md`

---

## Contexto

ADR-049 dejó 3 archivos en `agents/` raíz como overrides locales que "extendían" sub-agents genéricos de `agent-rigor`. ADR-060 retiró `agent-rigor`, dejando esos 3 archivos **huérfanos** (ya no extendían nada). El follow-up `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` trackeaba su consolidación.

Tras el retiro de agent-rigor, el review genérico lo provee `superpowers` (subagent-driven-development: revisor de spec + calidad). Las reglas de stack ya viven en `booster-skills:booster-stack-conventions`. Quedaba decidir el destino de cada override sin duplicar lo que `superpowers` y `booster-skills` ya cubren.

## Decisión

Consolidar los 3 overrides en `booster-skills@0.3.0` (decisiones del PO, 2026-06-14):

| Override local | Destino | Razón |
|---|---|---|
| `agents/security-auditor.md` | **Extender `booster-skills:security-scanner`** con módulo compliance Chile (secciones 13–16) | OWASP/secrets/SQLi ya estaban en security-scanner. Lo único valioso = Ley 19.628, SII/DTE, RBAC por rol, consent ESG. Un solo agente de seguridad, menos superficie. |
| `agents/sre-oncall.md` | **Nuevo sub-agent `booster-skills:sre-oncall`** | Lente SRE *pre-merge* (observabilidad, rollback, SLO, capacity). Distinto de la skill `incident-response` (*durante* incidente). Sin equivalente. |
| `agents/code-reviewer.md` | **Retirar.** Plegar solo el chequeo ADR-compliance en `booster-skills:booster-stack-conventions` (paso 7) | Review genérico ya lo da `superpowers`. Único bit único = ADR-compliance. |

`booster-skills` pasa de 6 → **7 sub-agents** (entra `sre-oncall`; `security-scanner` se enriquece). Publicado como **v0.3.0** (PR boosterchile/booster-skills#2, release `v0.3.0`).

Este repo (`booster-ai`) **borra los 3 archivos `agents/`** (directorio eliminado) y deja de mantener overrides locales.

## Consecuencias

### Positivas

- **Un solo source-of-truth**: el dominio de auditoría vive en `booster-skills`, instalable y versionado, no en archivos sueltos del repo.
- **Menos superficie**: un agente de seguridad (no dos), code-reviewer no se duplica con superpowers.
- **Sin pérdida de contenido**: compliance Chile, RBAC por rol y la lente SRE pre-merge se conservan (verificado en el PR del plugin).

### Negativas / trade-offs

- **Dependencia del plugin**: los sub-agents ahora requieren `booster-skills@0.3.0` instalado (antes eran archivos locales siempre presentes). Mitigado: el plugin es el modo canónico de operar el repo (ADR-049/060).
- **`code-reviewer` deja de existir como `subagent_type`**: invocaciones explícitas a `subagent_type: code-reviewer` ya no resuelven a un override local. El review pasa por `superpowers` + el paso ADR-compliance de `booster-stack-conventions`.

## Validación

- [x] `booster-skills@0.3.0` publicado (release + tag `v0.3.0`).
- [x] `security-scanner` con compliance Chile (secciones 13–16); nuevo `sre-oncall`; paso 7 ADR-compliance en `booster-stack-conventions`.
- [x] `claude plugin validate .` ✔ + PyYAML sobre frontmatters (7 agents, 9 skills).
- [x] `agents/` raíz de `booster-ai` eliminado; CLAUDE.md sin referencia a overrides locales.
- [x] Follow-up `migrate-booster-agents-to-plugin-v0.2.0.md` cerrado (Done).

## Referencias

- [ADR-060](./060-superpowers-replaces-agent-rigor.md): retiro de agent-rigor (causa de la orfandad).
- PR `boosterchile/booster-skills#2` + release `v0.3.0`.
- `.specs/consolidate-agents-v0.3.0/spec.md`: spec de ejecución (decisiones del PO).
