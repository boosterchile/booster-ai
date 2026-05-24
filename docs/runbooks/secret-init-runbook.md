# Runbook — Inicialización de Secret Manager secrets (run-once setup)

> Última actualización: 2026-05-24 · T7.5 SEC-001
> Spec: [`.specs/sec-001-cierre/spec.md`](../../.specs/sec-001-cierre/spec.md) §3 H1.4 · [Plan T7.5](../../.specs/sec-001-cierre/plan.md)

## Contexto

Varios secrets en GCP Secret Manager se crean inicialmente con un placeholder (`REPLACE_ME_BEFORE_DEPLOY`) porque sus valores reales no pueden vivir en Terraform (credenciales rotadas, passwords compromise-replace, etc.). La rotación a valor real ocurre **una sola vez** post-`terraform apply`, ejecutada manualmente por el Product Owner desde su máquina.

Este runbook aplica al secret `demo-seed-password` (T7.5). El mismo patrón se reutiliza para futuros secrets con placeholder (ver `infrastructure/security-hotfixes-2026-05-14.tf`).

## Cuándo correr el script

| Trigger | Acción |
|---|---|
| Tras mergear T7 (`feat(infra): T7 SEC-001 — mount DEMO_SEED_PASSWORD…`) | Correr una vez |
| Tras un `terraform destroy` accidental del secret | Correr una vez |
| Antes del primer merge de T8 (`feat(api): T8 SEC-001 — seed-demo lee DEMO_SEED_PASSWORD`) | Verificar primero con `check-secret-version-exists.sh`; si pasa, no correr |
| Rotación programada (Sprint 3 H1.6 cutover, o post-incident) | NO — usar `gcloud secrets versions add` directo + revocar versions previas (no es flujo init) |

## Prerequisitos

- [ ] `gcloud auth login` con la cuenta del PO (`dev@boosterchile.com`).
- [ ] `gcloud config set project booster-ai-494222`.
- [ ] El secret `demo-seed-password` existe en Secret Manager (verificar con `gcloud secrets describe demo-seed-password`).
- [ ] Rol IAM: `secretmanager.admin` sobre el secret (declarado en `security-hotfixes-2026-05-14.tf:138-145`).

## Procedimiento

### 1. Verificar estado previo

```bash
# ¿El secret existe?
gcloud secrets describe demo-seed-password --project=booster-ai-494222

# ¿Cuántas versions tiene? (debería tener al menos 1 placeholder)
gcloud secrets versions list demo-seed-password --project=booster-ai-494222

# ¿La latest es placeholder? (idempotency check del script)
gcloud secrets versions access latest --secret=demo-seed-password --project=booster-ai-494222
# Esperado pre-init: REPLACE_ME_BEFORE_DEPLOY
```

### 2. Ejecutar el script idempotente

```bash
cd <repo-root>
bash infrastructure/scripts/init-demo-seed-password.sh
```

Comportamiento:

- Si la latest version NO es `REPLACE_ME_BEFORE_DEPLOY`, el script skipea con `Skip (idempotente)` y exit 0.
- Si lo es, genera `openssl rand -base64 32` (32 bytes, ~43 caracteres base64) y agrega una nueva version.

Output esperado en éxito:

```
→ Checking current latest version of 'demo-seed-password' in project 'booster-ai-494222'...
→ Generando password random 32 bytes base64...
→ Agregando nueva version a 'demo-seed-password'...
Created version [2] of the secret [demo-seed-password].
✓ Nueva version del secret 'demo-seed-password' creada.

Próximos pasos:
  1. Restart Cloud Run revision del api para que mountee la nueva version: ...
  2. T8 PR puede mergearse (CI gate validará version count >= 1).
  3. Anotar en .specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md.
```

### 3. Verificar post-init

```bash
# Debe haber al menos 2 versions ahora (placeholder + real)
gcloud secrets versions list demo-seed-password --project=booster-ai-494222

# La latest debe ser != placeholder
gcloud secrets versions access latest --secret=demo-seed-password --project=booster-ai-494222
# Esperado: ~43 caracteres base64 (no `REPLACE_ME_BEFORE_DEPLOY`)
```

### 4. Restart Cloud Run api revision

Cloud Run mountea la version `latest` al startup. Para tomar la nueva version sin esperar al próximo deploy:

```bash
gcloud run services update booster-ai-api \
  --region=us-central1 \
  --project=booster-ai-494222
```

(Un `update` sin args fuerza un revision rollout que vuelve a leer secrets.)

### 5. Anotar evidencia

Crear `.specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md` con:

- Timestamp de ejecución del script.
- Output del script.
- Output de `gcloud secrets versions list demo-seed-password` post-init.
- Confirmación de revision rollout (`gcloud run revisions list --service=booster-ai-api`).

## Verificación del CI gate

El gate `check-secret-version-exists` corre en GitHub Actions (`.github/workflows/security.yml`) en PRs que toquen:

- `apps/api/src/services/seed-demo*.ts`
- `infrastructure/scripts/check-secret-version-exists.sh`
- `infrastructure/scripts/init-demo-seed-password.sh`
- `infrastructure/security-hotfixes-2026-05-14.tf`
- `.github/workflows/security.yml`

Auth via Workload Identity Federation (mismo SA `github-deployer` que `release.yml`). Si el SA no tiene `roles/secretmanager.viewer` sobre `demo-seed-password`, el job falla con error explícito (apuntando a esta sección del runbook).

## Rotación futura (NO usar este script para rotación)

Para rotar el password (`secretAccessor` paths breach, sospecha de compromise, política periodica):

```bash
# 1. Agregar nueva version con valor nuevo
openssl rand -base64 32 | gcloud secrets versions add demo-seed-password \
  --project=booster-ai-494222 --data-file=-

# 2. Restart Cloud Run para que tome la nueva latest
gcloud run services update booster-ai-api --region=us-central1 --project=booster-ai-494222

# 3. Verificar que el nuevo cold-start funciona, luego deshabilitar la version anterior
gcloud secrets versions disable <previous-version-number> \
  --secret=demo-seed-password --project=booster-ai-494222

# 4. Documentar rotación en docs/security/rotations.md (template TBD).
```

## Troubleshooting

### Error `Permission denied` al ejecutar el script

```
ERROR: (gcloud.secrets.versions.access) PERMISSION_DENIED: ...
```

Causa: cuenta `gcloud auth list` activa NO tiene `secretmanager.admin` sobre `demo-seed-password`.

Fix:
1. `gcloud auth list` — verifica la cuenta activa.
2. `gcloud auth login dev@boosterchile.com` si es otra cuenta.
3. Si la cuenta correcta no tiene el rol, ver `infrastructure/security-hotfixes-2026-05-14.tf:138-145` — el binding existe en HCL, así que un `terraform apply` reciente debe haberlo aplicado.

### Error en CI gate `Failed to list versions of 'demo-seed-password'`

```
::error::Failed to list versions of 'demo-seed-password' in project 'booster-ai-494222'.
ERROR: (gcloud.secrets.versions.list) PERMISSION_DENIED: ...
```

Causa: el SA `github-deployer` (impersonated via WIF) no tiene `roles/secretmanager.viewer`.

Fix:
1. Verifica el grant T7.5.1 en `security-hotfixes-2026-05-14.tf` (resource `demo_seed_password_github_deployer_viewer`).
2. Confirma con `gcloud secrets get-iam-policy demo-seed-password --project=booster-ai-494222` — debe listar el SA.
3. Si falta, corre `terraform apply` desde main (chequear strict gate per T0).

### Error `Secret 'demo-seed-password' tiene 0 versions`

Causa: el secret existe pero nunca recibió ni siquiera el placeholder.

Fix: ejecuta el procedimiento desde el paso 2. El script generará la primera version real (no placeholder).

## Referencias

- Spec original: [`.specs/security-blocking-hotfixes-2026-05-14/spec.md`](../../.specs/security-blocking-hotfixes-2026-05-14/spec.md) §3 H1.4
- Plan T7.5: [`.specs/sec-001-cierre/plan.md`](../../.specs/sec-001-cierre/plan.md) T7.5 acceptance
- HCL del secret + IAM: [`infrastructure/security-hotfixes-2026-05-14.tf`](../../infrastructure/security-hotfixes-2026-05-14.tf)
- Pattern WIF auth: [`.github/workflows/release.yml`](../../.github/workflows/release.yml) líneas 75-83
- ADR-032 git history password compromise: [`docs/adr/032-git-history-password-compromise-opcion-c.md`](../adr/032-git-history-password-compromise-opcion-c.md)
- Incidente histórico SEC-2026-04-01 (regresión silent fail-open a evitar): este runbook explícitamente prohíbe el patrón fail-open en el gate.
