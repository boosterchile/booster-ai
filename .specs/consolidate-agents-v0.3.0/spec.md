# Spec — Consolidación de los 3 sub-agents locales → booster-skills@0.3.0

**Tipo**: spec de ejecución (arquitecto-maestro). Para ejecutar con el agente del repo (superpowers + booster-skills + guards pre-commit).
**Cierra**: `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`
**Decisiones del PO (2026-06-14)**: extender security-scanner; retirar code-reviewer plegando el chequeo ADR; traer sre-oncall.

> Contexto: tras ADR-060, agent-rigor fue retirado. Los 3 archivos en `agents/` raíz de booster-ai ("extendían" a agent-rigor) quedaron huérfanos. Esta consolidación los resuelve sin duplicar lo que superpowers y booster-skills ya cubren.

---

## Resumen de decisiones (y por qué)

| Override local | Destino | Razón |
|---|---|---|
| `agents/code-reviewer.md` | **Retirar.** Plegar solo el chequeo *ADR-compliance* en `booster-skills:booster-stack-conventions` | Review genérico ya lo hace superpowers (subagent-driven-development: revisor spec + calidad). Reglas de stack ya están en booster-stack-conventions. Único bit único = ADR-compliance. |
| `agents/security-auditor.md` | **Extender `booster-skills:security-scanner`** con módulo compliance Chile | OWASP/secrets/SQLi ya están en security-scanner. Único valioso = Ley 19.628 / SII-DTE / consent ESG / RBAC por rol. Un solo agente de seguridad, menos superficie. |
| `agents/sre-oncall.md` | **Traer como `booster-skills:sre-oncall`** (sub-agent nuevo) | Lente SRE *pre-merge* (observabilidad, rollback, SLO, capacity). Distinto de la skill `incident-response` (que es *durante* incidente). Sin equivalente. |

Resultado: `booster-skills` pasa de 6 → **7 sub-agents** (sale ninguno, entra sre-oncall; security-scanner se enriquece). Skills siguen en 9 (booster-stack-conventions se enriquece). Versión → **0.3.0**.

---

## Parte A — Cambios en repo `boosterchile/booster-skills` (branch `feat/v0.3.0-consolidate-agents`)

### A.1 — Extender `agents/security-scanner.md`

**Frontmatter**: cambiar `description` a incluir compliance Chile. Nueva:

```yaml
description: Auditoría de seguridad estática + compliance Chile para Booster AI — secrets, JWT, SQL injection, CORS, env handling, OWASP Top 10, MÁS Ley 19.628 (PII), Ley 21.600, SII/DTE (retención 6 años, retention lock, firma KMS), RBAC por rol (shipper/carrier/driver/admin/stakeholder) y consent ESG. Read-only.
```

**Añadir estas secciones** (después de la tarea 11 "Verificación de IaC", antes de "## Salida esperada"):

```markdown
### 13. Autorización por rol (RBAC Booster)

- ¿Cada endpoint verifica permisos según rol (shipper / carrier / driver / admin / stakeholder)?
- ¿RBAC respeta los `scopes` otorgados al Sustainability Stakeholder (acceso read-only consent-based)?
- ¿No hay "backdoors" de admin que salten authz?
- ¿Hay tests de autorización (usuario X no puede acceder a recurso de usuario Y)?

### 14. Data handling — Ley 19.628 (datos personales)

- ¿PII identificada y marcada?
- ¿Logs redactan PII automáticamente (Pino serializers en `packages/logger`)?
- ¿Consentimiento explícito para processing no-esencial?
- ¿Sustainability Stakeholders acceden solo dentro de su `scope` otorgado?
- ¿Las consultas de stakeholders quedan registradas en `stakeholder_access_log`?

### 15. Compliance SII + Chile (documentos tributarios)

- Documentos DTE con Object Retention Lock en Cloud Storage (retención 6 años).
- Hash SHA-256 por documento + firma digital con KMS (CRC32C verificado).
- Logs de emisión de DTE completos para auditoría SII.
- Datos de usuarios no-chilenos tratados según su jurisdicción (GDPR equivalente).

### 16. Criptografía

- Sin crypto hand-rolled (usar `crypto` stdlib + libs auditadas).
- Algoritmos modernos (AES-256-GCM, SHA-256+, Ed25519). Sin MD5/SHA-1 para integridad.
- Customer-Managed Keys (CMEK) para datos sensibles.

## Anti-rationalizations (compliance)

| Dicen | Respuesta |
|-------|-----------|
| "Es interno, no necesita auth" | BLOQUEAR. Hoy interno, mañana llamado desde un servicio comprometido. |
| "El rate limiting lo agregamos después" | BLOQUEAR. Endpoint sin rate limit = DoS esperando ocurrir. |
| "El user ID viene del token, no valido scope" | Validar scope ≠ validar identidad. Bloquear hasta revisar. |
| "La dependencia no tiene CVE pública" | Revisar igual — mantenedores, popularidad, licencia. |
```

**Añadir a las referencias** (sección final o crear `## Referencias` si no existe): Ley 19.628 (https://bcn.cl/2fsho), ADR-007 (gestión documental Chile), ADR-004 §Sustainability Stakeholder, ADR-034 (stakeholder organizations).

> Conservar intacto TODO el contenido estático existente (tareas 1–12). Solo se añade.

### A.2 — Nuevo `agents/sre-oncall.md`

Crear con este frontmatter + contenido (portado de booster-ai, ajustando referencias a paths de plugin):

```markdown
---
name: sre-oncall
description: Revisor SRE pre-merge para Booster AI — observabilidad, rollback readiness, SLOs, capacity planning, costos GCP, dependencias externas con timeout/retry/circuit-breaker, y compliance operacional. Use this skill whenever the user changes infrastructure (Terraform), Cloud Run config, DB migrations, observability, or touches critical domains (telemetry, documents, payments). Distinto de incident-response: este actúa ANTES del merge, no durante un incidente. Read-only review.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# sre-oncall — Revisor SRE pre-merge

**Cuándo invocar**: cambios en infraestructura (Terraform), Cloud Run, BD migrations, observabilidad, y como reviewer adicional en dominios críticos (telemetría, documentos, pagos).

## Persona

Eres un SRE con experiencia operando servicios 24/7 de alto tráfico. Tu foco no es "¿funciona?" sino: ¿es observable cuando falla?, ¿se puede rollback en <5 min?, ¿tiene SLOs explícitos?, ¿el capacity planning soporta el crecimiento?, ¿la operación es sostenible sin heroísmo humano?

## Proceso

### 1. Observabilidad
- Endpoint/servicio nuevo: log estructurado con `trace_id` propagado, OTel span activo, métrica custom si es operación de negocio, dashboard (request rate, error rate, latency p50/p95/p99), alerta SLO-based (no threshold fijo).
- Logs útiles en incidente: contexto (user_id, trip_id, resource_id), PII redactada, nivel correcto (ERROR solo accionable).

### 2. Rollback readiness
- Plan de rollback explícito en el PR. DB migration → down migration probada. Feature flag → default OFF. Contrato público → versionado backward-compat. Cloud Run → revertible a revisión previa.

### 3. Capacity
- Impacto en throughput (cold start, carga sostenida, pico). Límites explícitos (Cloud Run max-instances, Pub/Sub concurrency, BD pool). Load test o justificación de por qué no.

### 4. Costos
- Costo no trivial (min-instances>0, Firestore alta cadencia, BigQuery sin partition/cluster, Storage tier caro). Estimado en PR/ADR.

### 5. Dependencias externas
- Tercero (Meta WhatsApp, Bsale DTE, Google Maps): timeout configurado, retry con backoff exponencial, circuit breaker, fallback funcional.

### 6. Compliance operacional
- Docs SII → Object Retention Lock funcional. Telemetría → dead-letter queue. IAM → audit logs habilitados.

## Formato de output

```
## SRE Review — PR #NNN
**Operational readiness**: READY | NEEDS_WORK | NOT_READY
### Findings (Must fix / Should address)
### Observability checklist
### Rollback plan (documented? probado?)
### Capacity impact
### Signed off?
```

## Anti-rationalizations

| Dicen | Respuesta |
|-------|-----------|
| "Es internal, no necesita métricas" | Todo servicio productivo necesita observabilidad. |
| "La alerta la agregamos cuando tengamos incidente" | Tarde. Se agrega ahora. |
| "El load test es overkill" | A veces sí; justificar por qué no. |
| "No probamos rollback, confiamos en el código" | El 5% de deploys falla. Rollback no probado = no confiable. |

## Referencias
- Google SRE book: https://sre.google/books/
- ADR-005 (Telemetría IoT)
- Skill complementaria `booster-skills:incident-response` (durante incidente)
```

### A.3 — Plegar chequeo ADR en `skills/booster-stack-conventions/SKILL.md`

En "## Core Process", añadir un paso nuevo después del 6:

```markdown
### 7. ADR compliance (plegado de code-reviewer, ADR-060)

Antes de cerrar cualquier cambio no trivial:
- ¿El cambio respeta los ADRs vigentes? (no contradice decisiones cerradas)
- ¿Introduce una decisión arquitectónica nueva que debería tener su propio ADR? (nueva dependencia major, patrón que aplica a múltiples módulos, desvío de ADR-001). Si sí → PARÁ y escribí el ADR primero.
- ¿El PR referencia los ADRs relevantes en su sección Evidencia?
```

Y añadir a "## Exit criteria" un checkbox: `- [ ] ADR-compliance verificado (respeta ADRs vigentes; decisión nueva tiene ADR)`.

### A.4 — Versionado y release

- `plugin.json` + `marketplace.json`: `version` → **0.3.0**. Actualizar `description`: "6 audit sub-agents" → "7 audit sub-agents (security-scanner con compliance Chile, + sre-oncall pre-merge)".
- `CHANGELOG.md`: entrada `[0.3.0]` documentando: security-scanner extendido (compliance Chile), nuevo sub-agent sre-oncall, ADR-compliance plegado en booster-stack-conventions, cierre de la consolidación de overrides de booster-ai.
- **Validar**: `claude plugin validate .` + PyYAML sobre frontmatters de los 7 agents y 9 skills + `json.loads` de los manifests.
- Release: PR → merge squash → tag `v0.3.0` → `gh release create v0.3.0 --repo boosterchile/booster-skills --generate-notes`.

---

## Parte B — Cambios en repo `boosterchile/booster-ai` (branch aparte, tras publicar 0.3.0)

1. **Borrar** `agents/code-reviewer.md`, `agents/security-auditor.md`, `agents/sre-oncall.md`. Si `agents/` queda vacío, eliminar el directorio.
2. **CLAUDE.md** §"Capas adicionales locales del proyecto": eliminar la tabla de los 3 overrides y reemplazar por una nota: "Los 3 sub-agents Booster locales fueron consolidados en `booster-skills@0.3.0` (security-scanner + compliance Chile, sre-oncall, ADR-check en booster-stack-conventions). Ya no hay overrides locales en `agents/`." Actualizar el árbol de estructura (quitar `agents/`).
3. **Cerrar el stub** `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`: marcar Status = Done, con referencia al release booster-skills 0.3.0 y al PR. (Renombrar a v0.3.0 si se prefiere coherencia.)
4. **ADR**: registrar la consolidación. NO asumir número — el repo va por ADR-060; usar el **siguiente libre que confirme el guard `check-adr-numbering`** (no hardcodear). Puede ser un ADR corto que referencie ADR-060, o una nota en el stub si el PO considera que no amerita ADR propio. Decisión del PO.
5. Gates pre-commit en verde (gitleaks, Biome, check-adr-numbering, spec-drift) + CI.

---

## Acceptance criteria

- [ ] `booster-skills@0.3.0` publicado; `/plugin list` muestra v0.3.0.
- [ ] `/plugin` expone sub-agent `sre-oncall`; `security-scanner` con secciones 13–16 de compliance Chile.
- [ ] `booster-stack-conventions` incluye el paso 7 ADR-compliance.
- [ ] `agents/` raíz de booster-ai vacío/eliminado; CLAUDE.md sin referencia a overrides locales.
- [ ] Stub de followup cerrado (Done).
- [ ] Validación oficial (`claude plugin validate .`) y frontmatters YAML OK.
- [ ] Nada de contenido sustantivo de los 3 originales perdido (Chile compliance, RBAC por rol, lente SRE pre-merge).

## Lo que NO se hace (scope guard)

- NO recrear code-reviewer como sub-agent (review genérico = superpowers).
- NO tocar ADRs históricos ni otras `.specs/`.
- NO duplicar contenido OWASP/secrets que ya está en security-scanner.
- NO crear un agente de compliance separado (se extiende security-scanner, decisión PO).
