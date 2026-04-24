# Security Checklist

Checklist de referencia para `security-auditor` agent.

## Identidad y acceso

- [ ] Firebase Auth para end-users, no JWT custom
- [ ] Service Accounts con mínimo privilegio (solo roles necesarios)
- [ ] IAM humana via Terraform, no consola
- [ ] Workload Identity Federation para CI (sin SA keys descargadas)
- [ ] MFA requerido para admin humans

## Validación de input

- [ ] Zod schema en cada boundary externo (HTTP, webhook, Pub/Sub, queue)
- [ ] `.strict()` en objetos Zod para rechazar campos no esperados
- [ ] Límites de tamaño (body, query, headers)
- [ ] Rate limiting configurado (Redis-based)

## Secrets

- [ ] 0 secrets en código (gitleaks en pre-commit + CI)
- [ ] 0 secrets en `.env` committed (solo `.env.example` en repo)
- [ ] Secretos productivos en Secret Manager
- [ ] Secretos rotables tienen procedimiento documentado
- [ ] Service Account keys eliminadas de dev local post-migración

## Data at rest

- [ ] Cloud SQL con encryption at rest (default GCP)
- [ ] Cloud Storage con CMEK para datos sensibles (documentos SII)
- [ ] Retention Lock para docs legales (6 años Chile)
- [ ] Backups encriptados

## Data in transit

- [ ] TLS 1.2+ en todos los endpoints
- [ ] HSTS habilitado en apps/web
- [ ] Certificados managed por GCP (Cloud Run default)
- [ ] Webhooks verifican signature HMAC

## Logging y auditoría

- [ ] Cloud Audit Logs habilitados en el proyecto
- [ ] PII redactada en logs aplicativos (Pino serializers)
- [ ] `stakeholder_access_log` captura consultas de Sustainability Stakeholders
- [ ] No se loguean passwords, tokens, private keys, CVVs

## Compliance Chile

- [ ] Ley 19.628: consent explícito + derecho al olvido + retention policy
- [ ] SII: DTE con retention 6 años + firma digital + hash
- [ ] Ley 18.290: Carta de Porte electrónica generada y archivada
- [ ] Superintendencia del Medio Ambiente: datos ESG verificables si aplica

## Dependencias

- [ ] `npm audit` sin HIGH/CRITICAL
- [ ] Dependabot habilitado
- [ ] CodeQL scans en CI
- [ ] Supply chain: dependencies nuevas revisadas (mantenedor, CVEs, tamaño)

## Response a incidentes

- [ ] Runbook de respuesta en `docs/runbooks/security-incident.md`
- [ ] Procedimiento de rotación de cada credencial documentado
- [ ] Notificación 72h Ley 19.628 si aplica
- [ ] Post-mortem obligatorio para SEV-1 y SEV-2

## WhatsApp (ADR-006)

- [ ] Webhook Meta valida signature HMAC SHA-256
- [ ] Access token Meta en Secret Manager
- [ ] Rate limiting por phone number
- [ ] Contenido sensible enmascarado en logs
- [ ] Opt-out (comando STOP) funcional

## Sustainability Stakeholder (ADR-004)

- [ ] Consent explícito granted_by_user_id
- [ ] Scope respetado en cada consulta
- [ ] Audit trail de accesos
- [ ] Revocación efectiva en <60s
