# IAM Owner drift — análisis y decisión (issue #410, tarea relacionada)

**Fecha:** 2026-06-06 · **Para:** Owner actual del proyecto (miembro de `group:admins@boosterchile.com`).
**Decisión requerida:** humana. Este doc NO aplica nada — deja el análisis + plan para que lo manejes.

## TL;DR — recomendación

**NO apliques el swap de Owner.** El "drift" es un **fantasma de un `terraform.tfvars` local**, no un cambio deseado. El código committeado ya tiene lo correcto (`group:admins@boosterchile.com`). La acción correcta es **corregir el tfvars local**, no mutar prod.

## El drift observado

Un `terraform plan` completo muestra, en IAM:

```
google_project_iam_member.human_owners["group:admins@boosterchile.com"]   will be destroyed
google_project_iam_member.human_owners["user:dev@boosterchile.com"]        will be created
google_project_iam_member.compute_default_storage_viewer                   will be destroyed
google_project_iam_member.github_deployer_bindings["roles/cloudfunctions.viewer"]  will be destroyed
Plan: 1 to add, 0 to change, 3 to destroy.
```

## Causa raíz del swap de Owner — phantom de tfvars local

| Fuente | Valor de `human_owners` |
|---|---|
| `infrastructure/variables.tf` (default committeado) | `["group:admins@boosterchile.com"]` ← **= estado real de prod** |
| `infrastructure/terraform.tfvars` (LOCAL, gitignored) | `["user:dev@boosterchile.com"]` ← origen del swap |
| Prod (`gcloud projects get-iam-policy`, `roles/owner`) | `group:admins@boosterchile.com` |

El default committeado **ya coincide con prod** → sin el override local NO habría cambio. El swap solo aparece porque la máquina que corrió el plan tiene `user:dev@` en su tfvars.

## Por qué NO aplicar el swap

1. **Regresa Trivy AVD-GCP-0008**: el comentario en `variables.tf:122` lo dice — el default usa `group:` justamente para cerrar el finding "IAM granted directly to user". Pasar a `user:dev@` reintroduce el hallazgo.
2. **Single-owner orphan risk**: deja a `user:dev@boosterchile.com` como **único** `roles/owner` del proyecto. Si esa cuenta se pierde/suspende, el proyecto queda sin Owner. El grupo `admins@` es resiliente (membresía gestionada).
3. **Contradice el código**: el repo declara group como intención. Aplicar user sería divergir del IaC committeado.

## Resolución recomendada (sin mutar prod)

Corregir el `terraform.tfvars` local para que use el default (o el grupo explícito):

```hcl
# terraform.tfvars (local, gitignored)
human_owners = ["group:admins@boosterchile.com"]   # = default; elimina el phantom
```

Tras esto, `terraform plan` no mostrará el swap de Owner. **No se toca prod** (ya está en group).

> Si por una razón de negocio SÍ se quisiera `user:dev@` como Owner (no recomendado): debe decidirlo un Owner actual del grupo, documentarse (ADR), y commitearse en `variables.tf` (no solo tfvars local). Aun así, lo correcto sería **añadir** el user al grupo, no reemplazar el grupo por el user.

## Los otros 2 bindings IAM (no-Owner) — restos del decomiso, seguros

- `compute_default_storage_viewer` (`roles/storage.objectViewer` al compute default SA) y
- `github_deployer_bindings["roles/cloudfunctions.viewer"]`

Son perms que el código removió junto al decomiso de la blocking function (issue #410, ya reconciliado). Quedaron porque la reconciliación de #410 se hizo con `-target` excluyendo IAM. **Son seguros de aplicar** (quitan permisos de lectura sobre recursos ya borrados). Se pueden aplicar acotados:

```bash
cd infrastructure
terraform plan \
  -target=google_project_iam_member.compute_default_storage_viewer \
  -target='google_project_iam_member.github_deployer_bindings["roles/cloudfunctions.viewer"]' \
  -out=/tmp/iam-cleanup.plan
# REVISAR: solo esos 2 destroy, sin human_owners. Luego apply.
terraform apply /tmp/iam-cleanup.plan
```

(Con el tfvars local corregido a group, este plan NO arrastrará el swap de Owner.)

## Runbook si decides aplicar algo (humano/Owner)

1. Corrige `terraform.tfvars` local → `human_owners = ["group:admins@boosterchile.com"]`.
2. `terraform plan -target=google_project_iam_member.human_owners` → debe dar **No changes** (confirma que el phantom se fue).
3. (Opcional) aplica el cleanup de los 2 bindings no-Owner con el bloque de arriba.
4. NUNCA apliques un plan que destruya `human_owners["group:admins@..."]` sin crear primero un Owner alternativo resiliente.

## Referencias
- Issue #410 · `post-ship-drift-investigation.md` · `variables.tf:121-127` · Trivy AVD-GCP-0008
