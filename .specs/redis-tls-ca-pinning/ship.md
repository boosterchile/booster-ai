# Ship — Redis TLS CA pinning

**Estado**: listo para deploy (pendiente go del PO + gate de aprobación `production`).
**Rama**: `fix/redis-tls-ca-pinning` — commits `38572f5`, `46205ed` (+ enmienda spec).

## Evidencia

- Tests: config 6, api 111, whatsapp-bot 42 — verdes.
- typecheck (config + api + whatsapp-bot), biome, `terraform validate` — limpios.
- REVIEW: devils-advocate (2 P0 resueltos) + security-auditor (0 bloqueantes). Ver `review.md`.
- Diagnóstico prod (read-only): signup-request 503 `Retry-After:30`; logs
  `rate-limit-pin: Redis error — unable to verify the first certificate`.

## Secuencia de deploy (ORDEN OBLIGATORIO — ver spec R2)

El guard `requireCa` hace que el código nuevo lance al startup en prod si falta la env.
Por eso **Terraform va primero**:

1. **`terraform apply`** (solo el cambio de `REDIS_CA_CERT` en `local.common_env_vars`).
   Añade la env a los servicios; el código viejo en prod la ignora → inocuo.
   - Validar `terraform plan` antes: debe mostrar solo cambios de env `REDIS_CA_CERT`
     (api + matching-engine + telemetry-processor + notification-service + whatsapp-bot + …),
     **sin** otros recursos. Si aparece algo más = drift, parar.
2. **Merge del PR a `main`** → `release.yml` → **aprobar gate** GitHub Environment `production`
   (`required_reviewers`) → canary 1% → 100%.
3. **Verificación funcional post-deploy** (SC-2/SC-3):
   - `curl -i -X POST https://api.boosterchile.com/api/v1/signup-request -H 'content-type: application/json' -d '{"email":"x@example.com","nombreCompleto":"x"}'` → **202** (o 422), **no 503**.
   - Cloud Logging: cero `rate-limit-pin: Redis error` / `unable to verify the first certificate`
     en la revisión nueva.

## Rollback

Revertir el código primero (el código viejo ignora `REDIS_CA_CERT`); la env puede quedarse.

## Checklist

- [x] `terraform plan` revisado (solo REDIS_CA_CERT — 7 services in-place, 0 add/destroy)
- [x] `terraform apply` (plan post-apply = No changes)
- [x] PR mergeado + gate `production` aprobado
- [x] canary observado → 100% (rev `00374-loh`)
- [x] SC-2 verificado (signup-request → 202)
- [x] SC-3 verificado (0 cert errors post-deploy; rate-limit → 429, no fail-closed)
- [x] spec.md Status → Shipped

## Resultado del deploy (2026-06-07)

- **Orden ejecutado**: `terraform apply` (env en 7 services) → merge #420 → gate `production`
  aprobado por el PO → `deploy-production` canary → 100%.
- **Nota de cola**: el run `release.yml` (27100872770, commit `d504811`) quedó ~15 min
  `pending` con 0 jobs por el lock de concurrency que retenía un run viejo parado en SU gate;
  el PO lo rechazó (Failure, sin desplegar) y eso liberó la cola. El run avanzó y el
  `deploy-production` figura `cancelled` en GitHub (artefacto del patrón canary), pero prod
  quedó **100% en `00374-loh`** con el fix — verificado por estado real, no por el status de GH.
- **Verificación prod**: `signup-request` → 202; 0 `unable to verify the first certificate`;
  rate-limit restaurado (429 tras 5/ventana, no 503).
