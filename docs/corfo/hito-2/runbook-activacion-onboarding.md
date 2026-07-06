# Runbook — Activación del alta de usuarios operativa (onboarding admin-provisioned)

> Última actualización: 2026-07-06 · W1.5
> Spec: [`.specs/onboarding-flow-redesign/spec.md`](../../../.specs/onboarding-flow-redesign/spec.md) §9 · Plan: [`.specs/onboarding-flow-redesign/plan.md`](../../../.specs/onboarding-flow-redesign/plan.md) "Cierre Fase 1 — flip de flags"
> ADR relacionados: [ADR-057](../../adr/057-google-signup-boundary-and-reaper-supersedes-054.md) (reaper de cuentas Google, mismo patrón dry-run/paused replicado acá)

## Contexto

Fase 1 de `onboarding-flow-redesign` reescribió el alta de usuarios operativos: un prospecto pide acceso (`/solicitar-acceso`), el admin aprueba y el sistema emite un **token one-shot firmado (HMAC-SHA256)** con TTL configurable (default 72h); el dueño completa el alta en `/onboarding-admin?token=...` y el token se consume atómicamente (un solo uso).

Todo el código de esta fase ya está en `main`/en esta rama **gateado por flags en `false`** — no cambia comportamiento hasta que este runbook se ejecute. Este documento es la única vía autorizada para activar el flujo en producción: **ningún paso de este runbook lo ejecuta el agente de desarrollo**, todos son responsabilidad del PO (`dev@boosterchile.com`) desde su propia máquina con credenciales `gcloud`/`gh` reales.

### Las 4 condiciones "ANTES del flip" (plan.md, Cierre Fase 1)

| # | Condición | Este PR la deja... |
|---|---|---|
| 1 | Reaper T1.7 desplegado con mecanismo de disparo (Cloud Scheduler) | Código + Terraform listos, job **pausado** — falta el primer tick manual (paso 6) |
| 2 | `ONBOARDING_TOKEN_SIGNING_SECRET` cableado en Secret Manager + Cloud Run | Secret shell + placeholder + mount listos — falta la **rotación real** (paso 3) |
| 3 | TTL (OQ1) ratificado | Default 72h funciona — falta el **acta firmada** (paso 4) |
| 4 | Sign-off del security-auditor sobre el modelo bearer-token | Sin artefacto — falta el **acta firmada** (paso 4) |

Ninguna de las 4 se puede completar sin acción humana fuera del repo (credenciales GCP, juicio de negocio, firma). Por eso este PR se detiene en "mergeable + inerte" y el resto queda en este runbook.

## Antes de empezar

- [ ] Sos el PO (`dev@boosterchile.com`) con `gcloud auth login` vigente (ver memoria `gcloud-cli-stale-auth-adc`: si el token está stale, `gcloud auth login` interactivo lo resuelve; no uses ADC de service account para pasos que requieren tu identidad humana).
- [ ] `gcloud config set project booster-ai-494222`.
- [ ] `gh auth switch --user boosterchile` (memoria: la cuenta activa de `gh` puede cambiar sola).
- [ ] Tenés 2 horas libres después del deploy de producción para el monitoreo del paso 8.

---

## Paso 1 — Merge del PR de esta rama

```bash
gh pr view feat/onboarding-usuarios-operativo   # confirmar que existe / crearlo si falta
gh pr checks <numero-pr>                        # CI debe estar verde
```

**Verificación**: todos los checks de `.github/workflows/ci.yml` y `security.yml` en verde antes de mergear. Squash merge a `main` (convención del repo).

No hay entorno staging (`#STAGING-ENV` pendiente) — el próximo paso opera directo contra el único ambiente real.

## Paso 2 — `terraform plan` → `apply`

Este PR agrega (todo con defaults seguros/inertes):

- `infrastructure/security.tf`: secret `onboarding-token-signing-secret` (shell + placeholder `ROTATE_ME_...`).
- `infrastructure/scheduling.tf`: Cloud Scheduler job `reap-orphan-onboarding-firebase`, diario 04:45 America/Santiago, **`paused = true`**.
- `infrastructure/compute.tf` + `variables.tf`: env var `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (default `false`) + mount del secret `ONBOARDING_TOKEN_SIGNING_SECRET` en `service_api`.

```bash
cd infrastructure
terraform plan -out=tfplan
```

**Verificación del plan — MUY IMPORTANTE (memoria: el plan trae drift conocido de PRs previos sin aplicar, ej. #520/#530/#535/#554 redis-auth)**:

- [ ] El plan debe mostrar SOLO: 1 `google_secret_manager_secret.secrets["onboarding-token-signing-secret"]` (create), 1 `google_secret_manager_secret_version.placeholder["onboarding-token-signing-secret"]` (create), 1 `google_cloud_scheduler_job.reap_orphan_onboarding_firebase` (create), y updates in-place de `module.service_api` (nueva env var + nuevo secret mount).
- [ ] **Si el plan muestra cambios NO relacionados a este PR** (ej. drift de `redis-auth`, cambios en IAM/Billing), DETENERSE — no son parte de este apply. Investigar el drift por separado (ver memoria `redis-auth-secret-double-version-520`) antes de continuar. NO aplicar un plan con drift mezclado sin entender cada cambio.
- [ ] `infrastructure/**` no está en `paths-ignore` de `release.yml` — un push a `main` con estos archivos SÍ dispara el pipeline normal (no hace falta nada especial para que CI lo vea).

```bash
terraform apply tfplan
```

Tras el apply: el secret existe con placeholder, el scheduler existe pausado, el mount existe en Cloud Run, pero **el flag sigue en `false`** — cero cambio de comportamiento visible para usuarios.

## Paso 3 — Rotar el secret de firma (valor real)

```bash
# Verificar que hoy es el placeholder (no debe faltar este chequeo)
gcloud secrets versions access latest --secret=onboarding-token-signing-secret
# Esperado: ROTATE_ME_ONBOARDING_TOKEN_SIGNING_SECRET_PLACEHOLDER

# Rotar a un valor real CSPRNG (48 bytes, muy por sobre el mínimo de 32)
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add onboarding-token-signing-secret --data-file=-

# Verificar que la rotación se aplicó
gcloud secrets versions access latest --secret=onboarding-token-signing-secret
# Esperado: NO debe imprimir "ROTATE_ME_..." — debe ser el string base64 recién generado
```

**Por qué esta verificación manual es obligatoria y no automatizable hoy**: el preflight `scripts/repo-checks/check-validated-secret-placeholders.mjs` (que bloquea `terraform apply` si un secret con formato validado por regex queda en placeholder) **NO cubre este secret** — su validación en `apps/api/src/config.ts` es `z.string().min(32)` (longitud, no un `.regex()` anclado), y el script solo detecta secrets con regex anclado (`content-sid-*`, `twilio-account-sid`). El placeholder Terraform mide 53 bytes (`ROTATE_ME_ONBOARDING_TOKEN_SIGNING_SECRET_PLACEHOLDER`), que **pasa** el `min(32)`.

Como defensa en profundidad adicional (no como sustituto de este paso), `assertStrongSecret` en `apps/api/src/services/onboarding-token.ts` rechaza explícitamente cualquier secreto que empiece con el prefijo `ROTATE_ME_` — así que si este paso se saltara, el endpoint de approve fallaría cerrado (503) en lugar de firmar tokens con un valor público visible en el HCL versionado. Aun así: **no confíes en ese fail-closed como sustituto de rotar** — rotá antes de avanzar al paso 5.

## Paso 4 — Ratificar TTL (OQ1) + sign-off del modelo bearer-token

El plan (`.specs/onboarding-flow-redesign/plan.md`, "Cierre Fase 1") exige 2 actas firmadas por el PO antes del flip. Completar y pegar acá abajo (o adjuntar como archivo en `docs/corfo/hito-2/evidencia/`):

```markdown
### Acta de ratificación — TTL del token de onboarding (OQ1)

- Fecha: __________
- TTL ratificado: 72 horas (default actual de `ONBOARDING_TOKEN_TTL_HOURS`)
- Firma (PO): __________
- Nota: un TTL más corto reduce la ventana de replay de un link interceptado;
  un TTL más largo mejora la UX si la aprobación tarda. 72h se mantiene como
  balance razonable para el volumen actual (aprobación manual, bajo volumen).
```

```markdown
### Acta de sign-off — modelo bearer-token (onboarding admin-provisioned)

- Fecha: __________
- Revisor: __________ (security-auditor / booster-skills:security-scanner)
- Modelo revisado: token HMAC-SHA256 one-shot entregado vía link de email/WhatsApp;
  el link en sí mismo es el trust anchor (quien lo posee, se autentica).
- Riesgo residual aceptado: link interceptado dentro del TTL (72h) permite
  onboarding no autorizado. Mitigación: TTL corto + un solo uso (consumo atómico)
  + reaper T1.7 limpia usuarios Firebase huérfanos de tokens expirados-no-consumidos.
- Veredicto: GO / NO-GO: __________
- Firma: __________
```

**Bloqueante**: no avanzar al paso 5 sin ambas actas firmadas.

## Paso 5 — Flip de flags + deploy

```bash
# En infrastructure/variables.tf (o vía -var en el apply), cambiar defaults:
#   admin_provisioned_onboarding_enabled = true
#   signup_request_flow_activated ya está en `true` (ADR-052, no requiere cambio)

cd infrastructure
terraform plan -out=tfplan-flip
# Verificar que el ÚNICO cambio in-place es la env var ADMIN_PROVISIONED_ONBOARDING_ENABLED
# (de "false" a "true") en module.service_api. Nada más.
terraform apply tfplan-flip
```

El `apply` de Terraform actualiza la config del servicio Cloud Run, pero el **deploy real de la imagen** sigue el flujo normal de `release.yml`:

```bash
git push origin main   # si el flip de tfvars viaja en un commit
```

- **Gate humano obligatorio**: `release.yml` requiere aprobación manual en el GitHub Environment `production` (`required_reviewers`) antes de que `cloudbuild.production.yaml` corra el canary (1% tráfico → 30 min → 100%).
- **Footgun de la lane** (memoria `ci-release-paths-ignore`): la lane de `release.yml` usa `cancel-in-progress:false` — un merge rápido subsiguiente NO cancela un deploy en curso, se encola. **No hagas rapid-fire de merges** mientras este flip está en tránsito. Si el run queda colgado, destrabar con `gh run cancel` + push fresco a `main` (no con `-f`).
- **Canary**: el paso `canary-verify` en `cloudbuild.production.yaml` es un placeholder (`exit 0`) — la promoción a 100% la observás y decidís vos, no un chequeo automático. Ver `.specs/adr-vs-prod-inventory/inventory.md` finding #1.
- Si el `apply` de Terraform con traffic split falla a mitad de camino (memoria `cloudbuild-prod-canary-timeout`), destrabar con `gcloud run services update-traffic booster-ai-api --to-latest --region=southamerica-west1`.

## Paso 6 — Primer tick MANUAL del reaper T1.7

El scheduler `reap-orphan-onboarding-firebase` quedó **pausado** en el paso 2 (mismo criterio que `reap-inert-idp-accounts`): un primer tick automático sin supervisión consume quota de Firebase Admin (`deleteUser`) + queries sobre el pool compartido del api sin que nadie haya visto el resultado.

```bash
# Correrlo una vez, observado
gcloud scheduler jobs run reap-orphan-onboarding-firebase --location=southamerica-east1

# Revisar el log de la corrida — buscar el evento
#   onboarding-orphan-reaper.run.summary
# en Cloud Logging (Cloud Run Logs Explorer, filtro por service=booster-ai-api).
# Confirmar destructive:false (dry-run) — con ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE
# sin cablear en Terraform, el modo real es dry-run SIEMPRE hasta un apply dedicado
# futuro que agregue esa env var (ver infrastructure/compute.tf, comentario W1.5).

# Si el summary se ve razonable (scanned/deleted acorde al volumen esperado, sin errors):
gcloud scheduler jobs resume reap-orphan-onboarding-firebase --location=southamerica-east1
```

**Nota**: hoy el reaper corre SIEMPRE en dry-run (solo cuenta/loguea), porque `ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE` no está cableado como env var de Cloud Run todavía (mismo patrón deliberado que `REAPER_DESTRUCTIVE` del reaper de cuentas IdP: el modo destructivo real es un apply posterior, gateado por revisar unos días de dry-run primero). Esto es aceptable para el cierre de Fase 1 — la condición 1 del plan pide el job **agendado y corriendo**, no necesariamente destructivo desde el día 1.

## Paso 7 — E2E de aceptación

Checklist manual contra producción (no hay staging):

1. [ ] `POST /api/v1/signup-request` (o UI `/solicitar-acceso`) — crear una solicitud de prueba con un email real accesible.
2. [ ] Admin aprueba desde `/admin/signup-requests` — la respuesta/UI muestra el `onboarding_link` copiable **una sola vez**.
   ⚠️ **Copiar el link INMEDIATAMENTE al aprobar.** El token viaja hasheado en BD (`token_hash`) — si el admin cierra el modal sin copiarlo, **no hay recuperación desde la UI**. El único rescate es rechazar la solicitud y pedir que se re-solicite acceso (vuelve al paso 1), o esperar Fase 2 (notificación por email real, mes 9 — ver `.specs/_followups/` de Fase 2).
3. [ ] Abrir el link → login con Google (si la sesión no existe, el flujo redirige a login y **preserva** `?token=` en la vuelta — confirmado para el flujo Google/Firebase estándar).
4. [ ] `/onboarding-admin?token=...` consume el token (header `x-onboarding-token`, nunca en la URL del request ni en el body) y completa el alta.
5. [ ] `GET /me` inmediatamente después: **sin** `needs_onboarding` — el usuario quedó provisionado.
6. [ ] Reintentar el MISMO link (segundo consumo) → **403** (el consumo es atómico, un solo uso).
7. [ ] `POST /empresas/onboarding` (el path viejo self-service) → **403** — `EMPRESA_SELF_ONBOARDING_ENABLED` se mantiene en `false` para siempre (SC3, SEC-001); este flip NO lo reenciende.

⚠️ **Advertencia sobre el flujo RUT+clave**: si en el futuro alguien activa `AUTH_UNIVERSAL_V1_ACTIVATED` (`LoginUniversal`, hoy OFF) ANTES de que Fase 2 resuelva el redirect, el login RUT+clave **NO preserva** `?redirect=` (stub `.specs/_followups/login-universal-redirect-param.md`) — un admin que reciba el link de onboarding y use ese flujo de login perdería el token en la vuelta. No es un bloqueante de ESTE flip (el flujo Google sí preserva el redirect), pero documentarlo acá evita que alguien encienda ese flag sin saberlo.

## Paso 8 — Monitoreo 2h post-deploy

Estándar `booster-deploy-cloud-run`:

- [ ] Error rate de `booster-ai-api` (Cloud Monitoring) sin spike tras el deploy.
- [ ] Latencia P95 de `/admin/signup-requests/:id/approve` y `/empresas/onboarding-admin` dentro de lo normal.
- [ ] Logs limpios: sin `onboarding-token` errors inesperados, sin `503 onboarding_misconfigured` (indicaría que `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` pero el secret sigue en placeholder — señal de que el paso 3 no se completó).
- [ ] `reaper.run.summary` / `onboarding-orphan-reaper.run.summary` del scheduler corriendo diario sin `errors > 0` sostenido.

### Qué revertir si algo falla

- **Kill-switch inmediato** (sin rollback de imagen): flip `admin_provisioned_onboarding_enabled` de vuelta a `false` + `terraform apply` + esperar el redeploy de la revision. El approve vuelve al comportamiento viejo (precrea sin token) — reversible en minutos, no requiere revertir el PR de código.
- Si el problema es el secret (placeholder detectado post-flip): rotar de inmediato (paso 3) y forzar un restart de revision (`gcloud run services update booster-ai-api --region=southamerica-west1`) — no hace falta esperar el kill-switch si la causa es solo el secret sin rotar.
- El reaper T1.7 (paso 6) es independiente del kill-switch: puede quedar corriendo en dry-run sin riesgo aunque el flag principal se revierta.

## Referencias

- Spec: [`.specs/onboarding-flow-redesign/spec.md`](../../../.specs/onboarding-flow-redesign/spec.md) §9
- Plan: [`.specs/onboarding-flow-redesign/plan.md`](../../../.specs/onboarding-flow-redesign/plan.md), sección "Cierre Fase 1 — flip de flags"
- Código del token: [`apps/api/src/services/onboarding-token.ts`](../../../apps/api/src/services/onboarding-token.ts)
- Reaper T1.7: [`apps/api/src/jobs/reap-orphan-onboarding-firebase.ts`](../../../apps/api/src/jobs/reap-orphan-onboarding-firebase.ts)
- Handler HTTP del reaper: [`apps/api/src/routes/admin-jobs.ts`](../../../apps/api/src/routes/admin-jobs.ts)
- Terraform: [`infrastructure/security.tf`](../../../infrastructure/security.tf), [`infrastructure/scheduling.tf`](../../../infrastructure/scheduling.tf), [`infrastructure/compute.tf`](../../../infrastructure/compute.tf), [`infrastructure/variables.tf`](../../../infrastructure/variables.tf)
- Precedente del mismo patrón (reaper de cuentas IdP): [`docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md`](../../adr/057-google-signup-boundary-and-reaper-supersedes-054.md)
- Follow-up pendiente (redirect RUT+clave): [`.specs/_followups/login-universal-redirect-param.md`](../../../.specs/_followups/login-universal-redirect-param.md)
