# Follow-up: mover REDIS_PASSWORD (auth_string) a Secret Manager

**Origen**: REVIEW de `redis-tls-ca-pinning` (security-auditor QUESTION), 2026-06-07.
**Prioridad**: P1 (compliance CLAUDE.md §Seguridad).

## Problema

`infrastructure/compute.tf:19` → `REDIS_PASSWORD = google_redis_instance.main.auth_string`
vive en `local.common_env_vars` (env plaintext de Cloud Run), **no** en Secret Manager.
Predates este fix (introducido en `b59ffe5`).

El `auth_string` de Memorystore SÍ es un secreto. CLAUDE.md §"Seguridad por defecto" dice:
"Secretos: Google Secret Manager, nunca en variables de entorno hardcoded". Como env var queda
visible en `gcloud run services describe`, en la consola, y para cualquier principal con
`run.services.get`.

> Nota: `REDIS_CA_CERT` (este fix) NO aplica — el server CA cert es público por naturaleza.

## Acción propuesta

Mover `auth_string` a Secret Manager y montarlo vía `common_secrets` (igual que `DATABASE_URL`
en `compute.tf:29`). Aplica a todos los services que usan Redis (api, whatsapp-bot, …).

## Estado
Pendiente de priorizar.
