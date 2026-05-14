# ADR-033 — Identity Platform self-signup OFF: decisión manual + monitor por gap del provider Terraform

- Status: Draft (será Accepted al cierre de T5a + T5b)
- Date: 2026-05-14
- Author: Felipe Vicencio
- Related: `.specs/security-blocking-hotfixes-2026-05-14/spec.md` §3 H1.2, plan.md T5a + T5b, OOB-10

## Context

El hotfix H1.2 del ciclo `security-blocking-hotfixes-2026-05-14` requiere apagar el toggle "Allow new accounts to sign up" en el tenant Identity Platform `booster-ai-494222` (Firebase Console → Authentication → Settings → User actions). El objetivo: a partir de ese punto, solo el Admin SDK con service account autorizada puede crear cuentas; el auto-signup desde la PWA queda apagado.

**El principio rector CLAUDE.md §1** dice "Sin infra manual. Todo en Terraform, incluyendo IAM humana." Por tanto, la decisión natural sería implementar este toggle vía Terraform.

**Pre-flight PF-2 ejecutado 2026-05-14T20:30Z** validó esta hipótesis contra la versión actual del provider:

```bash
# terraform plan output (resumido):
+ resource "google_identity_platform_config" "test" {
    + autodelete_anonymous_users = false
    + sign_in {
        + allow_duplicate_emails = false
        + email {
            + enabled           = true
            + password_required = true
          }
      }
    + ... (mfa, sms_region_config, client, hash_config, monitoring)
  }
Plan: 1 to add, 0 to change, 0 to destroy.
```

**Provider Terraform `hashicorp/google v6.50.0` NO expone ningún campo equivalente** a "disable sign-up" / "allow new accounts" en el resource `google_identity_platform_config`. Los campos disponibles dentro de `sign_in` son únicamente:
- `allow_duplicate_emails` (boolean)
- `email.enabled` (boolean, controla si email/password auth está activado en absoluto)
- `email.password_required` (boolean, controla si requiere password vs sign-in link)
- bloques anidados de hash config, mfa, sms region, client, monitoring

La toggle "Allow new accounts to sign up" del Firebase Console mapea internamente al campo `signIn.signUp.allowNewAccounts` de la Identity Platform Admin API REST, **pero ese campo NO está expuesto en el Terraform provider** en la versión actual.

Verificación independiente vía REST API (ejecutada como parte de PF-2 follow-up):

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: booster-ai-494222" \
  https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config \
  | jq '.signIn | keys'
# Confirma que el path existe en la API pero el campo del toggle
# no aparece en el schema del Terraform resource.
```

## Decision

**Approach manual + monitor**:

1. **T5a (manual)**: el toggle se aplica vía Firebase Console → Authentication → Settings → "User actions" → toggle "Enable create (sign-up)" OFF. Captura de pantalla + comando de verificación REST documentado en `docs/qa/demo-accounts.md` sección "Identity Platform self-signup state".

2. **T5b (drift monitor)**: log-based alert en Cloud Monitoring que filtra audit logs por:
   ```
   protoPayload.serviceName="identitytoolkit.googleapis.com"
   AND protoPayload.methodName=~"projects.config.update.*"
   AND protoPayload.request.signIn
   ```
   Cualquier UPDATE del Identity Platform config en el tenant dispara la alerta SEV-2 al canal SRE. Esto cierra el gap operativo: si alguien re-activa el toggle desde Console (intencional o accidentalmente), recibimos notificación inmediata.

3. **OOB-10 (filed issue)**: github issue en `hashicorp/terraform-provider-google` solicitando exposición del campo `signUp.allow_new_accounts` (o equivalente) en el resource `google_identity_platform_config`. El issue queda como tracker para migración futura a IaC.

4. **Trigger de migración a IaC**: cuando una versión futura del provider exponga el campo, abrir PR que:
   - Importe el estado del setting actual con `terraform import google_identity_platform_config.default projects/booster-ai-494222/config`.
   - Setee el campo nuevo en `infrastructure/identity-platform.tf` (`disable_sign_up = true` o el nombre exacto que adopte el provider).
   - Cierre este ADR como **Superseded** apuntando al ADR siguiente que registre la migración.
   - Mantenga T5b (drift alert) activo como defensa en profundidad incluso post-IaC.

## Alternatives considered

### Alternativa A — Esperar a que el provider exponga el campo

- **Descripción**: no apagar el toggle hasta tener IaC viable.
- **Costo**: el toggle queda ON indefinidamente; cualquier persona con email válido puede crear una cuenta en el tenant. Risk de "demo squatting" (cuenta `demo-fake@boosterchile.com` creada por atacante para hacerse pasar por flow demo legítimo).
- **Rechazada**: el principio CLAUDE.md §7 ("seguridad por defecto") prevalece sobre §1 ("sin infra manual"). La inversión es: postura de seguridad correcta ahora + IaC cuando el provider lo soporte, NO esperar a IaC con postura insegura.

### Alternativa B — Implementar custom Terraform provider o wrapper REST

- **Descripción**: usar `null_resource` con `local-exec` invocando `curl` contra la Admin API REST para setear el campo.
- **Costo**: alto. Difícil de testear, statefulness frágil (no se refleja en `terraform state`), drift detection deficiente, mantenimiento adicional.
- **Rechazada**: el costo de mantener un workaround custom supera el costo de la decisión manual + alert. Cuando el provider expone el campo, el cambio a IaC será 1 commit limpio.

### Alternativa C — Eliminar Identity Platform y usar otra solución (Firebase Auth legacy, Auth0, etc.)

- **Descripción**: migrar el auth stack para evitar el gap.
- **Costo**: catastrófico. Identity Platform es el core del producto; migrar implicaría rewrite del backend, frontend, integración con WhatsApp bot, etc.
- **Rechazada**: fuera de scope por orders of magnitude.

## Consequences

### Positivas

- Postura de seguridad correcta entregada en horas (no días esperando provider update).
- T5b alert provee defense-in-depth incluso post-migración futura a IaC.
- OOB-10 abre canal de feedback con el provider; potencialmente otros consumidores piden lo mismo.
- ADR explícito previene que un futuro contributor "vea el toggle manual y asuma deuda técnica" — la deuda está acotada y documentada.

### Negativas

- Violación documentada del principio CLAUDE.md §1 "Sin infra manual". Aceptada como gap del provider, no como sloppy practice.
- El procedimiento manual depende de Felipe (o operador con consola access). NO es reproducible vía `terraform apply` hasta que el provider lo soporte.
- Si Felipe gira el toggle a ON por error (UI Console no tiene "are you sure?"), T5b dispara pero el setting queda mal hasta que se re-toggle. Mitigación: T5b alert dispara en segundos.

### Operativas

- T5a + T5b en plan v3.1 implementan ambas piezas.
- OOB-10 commitea el issue del provider con link al issue de GitHub (URL exacta en el ADR cuando se cree).
- ADR queda revisitable: si el provider expone el campo en v7.x, este ADR se supersede.

## Cross-references

- `.specs/security-blocking-hotfixes-2026-05-14/spec.md` §3 H1.2 — criterio operacional.
- `.specs/security-blocking-hotfixes-2026-05-14/plan.md` T5a, T5b, OOB-10 — implementación.
- `.specs/security-blocking-hotfixes-2026-05-14/spec.md` §13 — decision log con fecha y autor.
- Provider docs: https://registry.terraform.io/providers/hashicorp/google/6.50.0/docs/resources/identity_platform_config (verificar versión futura).
- Firebase Console path (al momento de escritura): https://console.firebase.google.com/project/booster-ai-494222/authentication/settings → "User actions" → "Enable create (sign-up)".

## Closure conditions

Este ADR se cierra (status: Accepted → Superseded) cuando:
1. Provider `hashicorp/google` expone el campo equivalente a `disable_sign_up`.
2. Migración a IaC ejecutada con `terraform import` + `terraform plan` muestra el campo correctamente.
3. T5b (drift alert) sigue activo post-migración como defense-in-depth (NO se desactiva por la migración).
4. Nuevo ADR documenta la migración y este ADR se marca Superseded por él.
