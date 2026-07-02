# Identity Platform config — SEC-001 Sprint 2b H1.2 T11

> SEC-001 Sprint 2b (`.specs/sec-001-cierre/plan-sprint-2b.md` T11) · 2026-05-26
> SC-1.2.2 amendment A3 v3.4 (email/password leg MET, Google leg TRACKED_RESIDUAL).
> Terraform: `infrastructure/identity-platform.tf`.
> ADR: [`052-signup-migration-admin-sdk-gate.md`](../adr/052-signup-migration-admin-sdk-gate.md).

## 1. Estado final tras T11

| Propiedad | Valor | Efecto |
|---|---|---|
| `sign_in.email.enabled` | `true` | Sign-IN email/password sigue habilitado (users existing pueden hacer login). |
| `sign_in.email.password_required` | `true` | No magic-link / no email-only signin. |
| `sign_in.allow_duplicate_emails` | `false` | Un email no puede coexistir bajo 2 providers distintos. |
| `client.permissions.disabled_user_signup` | **`true`** ★ | **Self-signup client-side OFF (la knob principal de T11).** Cualquier `createUserWithEmailAndPassword` desde Firebase SDK retorna `auth/operation-not-allowed`. |
| `client.permissions.disabled_user_deletion` | `false` | Users pueden borrar sus propias cuentas (UX OK). |

**Scope crítico**: `disabled_user_signup` aplica a **client SDKs solamente**. Admin SDK `auth.createUser` (invocado desde backend con service account auth) **NO se ve afectado**. Esto es deliberado — el flow `signup-request` post-T10 ejecuta `auth.createUser` desde el service, que sigue funcionando.

## 2. Residual: Google sign-in (TRACKED_RESIDUAL Sprint 2c)

Aunque `disabled_user_signup=true` técnicamente aplica a **todos los providers** (email, Google, Anonymous, Phone), Identity Platform tiene una limitación documentada con federated identity providers (Google OAuth, Apple, etc.):

- Cuando un user hace `signInWithPopup(googleProvider)` por primera vez con cuenta Google nueva, Firebase **crea implícitamente** un user de Identity Platform como parte del flow OAuth, **antes** de que `disabled_user_signup` pueda intervenir.
- El comportamiento es inherente al diseño de federated identity: el provider Google es la "fuente de verdad" del identity proofing; Identity Platform actúa como un mirror.

**Resultado**: a 2026-05-26 (post-T11 apply), Google self-signup **queda OPEN** entre Sprint 2b ship y Sprint 2c ship. Mitigación documentada:

- **Risk surface acotado**: una cuenta Google nueva crea un Firebase User SIN role en `users` table de Booster. Sin role, el user no consume endpoints útiles (todos requieren membership downstream).
- **Tracked en spec §3 SC-1.2.2 amendment A3** + `R-DA-GOOGLE-OPEN` riesgo residual en ADR-052.
- **Sprint 2c spec** (`.specs/_followups/sprint-2c-google-blocking-function.md`): Firebase Auth Blocking Function `beforeCreate` que rechaza first sign-in Google si no hay `solicitudes_registro.estado=aprobado` matching email.
- **Monitoring**: alerta Cloud Monitoring sobre Identity Platform audit log con `signup.create` provider=`google.com` sin matching `solicitudes_registro.estado=aprobado` (configurable post-Sprint-2b).

## 3. Apply del cambio Terraform

### 3.1. Pre-flight check — config existe?

Identity Platform crea un config implícito al habilitar `identitytoolkit.googleapis.com` (ver `infrastructure/project.tf:120`). El primer `terraform plan` post-T11 puede mostrar:

- **Create** del recurso `google_identity_platform_config.default` (si Terraform no encuentra el config en state).
- **Update** del recurso (si ya fue importado).

Si plan dice **create** y el config implícito YA existe, hay que importar primero:

```bash
cd infrastructure
terraform import google_identity_platform_config.default booster-ai-494222
```

### 3.2. Plan + apply

```bash
cd infrastructure
terraform plan -out=tfplan-t11
# Revisar el diff. Esperado:
#   - sign_in.email.enabled: (no-op, ya era true)
#   - sign_in.email.password_required: (no-op si ya era true)
#   - sign_in.allow_duplicate_emails: (puede ser true → false)
#   - client.permissions.disabled_user_signup: (false → true) ★ el cambio clave
terraform apply tfplan-t11
```

**Pre-apply checklist** (per spec §7.4 categórica):
- [ ] `terraform plan` muestra 0 diffs inesperados en `google_iam_*`, `google_secret_manager_*`, `google_storage_bucket*`, `google_cloud_run_v2_service*`.
- [ ] Cambio focused solo en `google_identity_platform_config.default`.
- [ ] Branch protection OK + reviewer humano en PR (CLAUDE.md "infrastructure/* requiere PR revisado").

### 3.3. Verificación post-apply

Comando oficial spec SC-1.2.2 (idéntico al spec):

```bash
curl -s -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
     -H "x-goog-user-project: booster-ai-494222" \
     "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" \
     | jq '.signIn.email, .client.permissions'
```

**Esperado**:

```json
{
  "enabled": true,
  "passwordRequired": true
}
{
  "disabledUserSignup": true,
  "disabledUserDeletion": false
}
```

### 3.4. Smoke E2E manual

Después del apply, probar **manual** con la web app (en staging primero):

1. Abrir `https://app.boosterchile.com/login` (staging) en modo incognito.
2. Hacer click "Crear cuenta" → ingresar email nuevo + password.
3. **Expected**: error `auth/operation-not-allowed` (o equivalente) → UI muestra "No pudimos completar la operación".
4. Probar también con email YA existente en `users` table → mismo error (anti-enumeration por design en T8 `submitSignupRequest`).
5. **Negative**: el endpoint `POST /api/v1/signup-request` debe seguir aceptando solicitudes (202) — verificar con `curl`:
   ```bash
   curl -s -X POST https://api-staging.boosterchile.com/api/v1/signup-request \
        -H "content-type: application/json" \
        -d '{"email":"test@example.cl","nombreCompleto":"Test"}'
   # Expected: HTTP 202 + {"ok":true}
   ```
6. Confirmar row insertado en `solicitudes_registro` (staging DB).

## 4. Rollback path

Si T11 apply provoca regresión inesperada (e.g., Admin SDK `auth.createUser` empezó a fallar — contraintuitivo pero plan §7.5 lo contempla):

```bash
cd infrastructure
# Revertir el commit que introdujo T11:
git revert <T11-commit-sha>
terraform plan -out=tfplan-rollback
# Verificar que el diff revierte client.permissions.disabled_user_signup a false.
terraform apply tfplan-rollback
```

**Rollback impact**: vuelve a abrir self-signup email/password. Los users existing siguen igual. **NO** abre el Google leg (Google ya está OPEN como residual — el rollback no afecta el estado Google).

Per spec §7.5, rollback de T11 NO requiere flip del feature flag `SIGNUP_REQUEST_FLOW_ACTIVATED` (admin UI sigue funcional via Admin SDK).

## 5. Tracking de drift

`security-hotfixes-2026-05-14.tf:45` ya menciona `identity_platform_config drift` como una de las alertas SRE configuradas. Post-T11, configurar Cloud Monitoring log-based alert sobre cambios manuales al config (audit log `SetProjectConfig` operations sin matching `terraform apply` event). Tracked como follow-up T13+ una vez Cloud Build canary success.

## 6. Referencias

- Spec: `.specs/sec-001-cierre/spec.md` §3 H1.2 SC-1.2.2.
- Plan: `.specs/sec-001-cierre/plan-sprint-2b.md` T11.
- ADR: `docs/adr/052-signup-migration-admin-sdk-gate.md` (Proposed).
- Audit inventory: `docs/qa/signup-paths-audit.md` (T6).
- Cascade doc: `docs/qa/rate-limit-cascade.md` §signup-request layer.
- Followup: `.specs/_followups/sprint-2c-google-blocking-function.md` (Google leg).
- Terraform: `infrastructure/identity-platform.tf`.
- Identity Platform API: <https://cloud.google.com/identity-platform/docs/reference/rest/v2/Config>
- Terraform provider resource: <https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/identity_platform_config>
