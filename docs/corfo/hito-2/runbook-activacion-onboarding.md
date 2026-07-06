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

## Paso 0 — PRE-merge (obligatorio)

**Hallazgo R1 (fix round final-review, 2026-07-06), confirmado contra prod vía Cloud Run REST**: el servicio vivo `booster-ai-api` (revisión `booster-ai-api-00426-bes`, `updateTime` 2026-07-02T22:21Z, proyecto `booster-ai-494222`, `southamerica-west1`) corría `SIGNUP_REQUEST_FLOW_ACTIVATED=true` — el default `true` de `variables.tf` (histórico, flip 2026-05-29 post ADR-052) estaba aplicado, y `ADMIN_PROVISIONED_ONBOARDING_ENABLED`/`EMPRESA_SELF_ONBOARDING_ENABLED` seguían en `false` (defaults). Es decir: la cola de solicitudes **no estaba congelada** — un approve real habría tomado el modo legacy silencioso (precrea fila `users`, sin token ni link one-shot; ver `apps/api/src/routes/admin-signup-requests.ts` líneas 182-188).

**Corrección sobre `infrastructure/terraform.tfvars`**: NO está trackeado en git (`*.tfvars` en `.gitignore:97`; `git ls-files infrastructure/terraform.tfvars` no devuelve nada) — es un archivo local que cada operador mantiene reflejando el estado real aplicado en prod (ver su propio comentario de cabecera). El override explícito `signup_request_flow_activated = false` que agrega este PR en ese archivo es un cambio **local a esta máquina/checkout**, no algo que viaje por git — protege este checkout puntual pero NO reemplaza el default `false` de `variables.tf` (ese sí es el control real, versionado, que aplica a cualquier apply desde cualquier checkout). Si operás desde otra máquina, confirma que tu `terraform.tfvars` local no tenga `signup_request_flow_activated = true` colgado de un cambio manual anterior.

Esta rama ya revirtió `signup_request_flow_activated` a `false` (código: `infrastructure/variables.tf` default + `infrastructure/terraform.tfvars` override explícito), pero eso solo toma efecto en prod cuando se aplique el Terraform de esta rama (paso 2). Hasta entonces, prod sigue corriendo con el flag `true` de la revisión actual. Antes de mergear:

- [ ] **(a) El PO fuerza el flag en prod de inmediato** (no espera al merge + apply de esta rama):
  ```bash
  gcloud run services update booster-ai-api \
    --region=southamerica-west1 \
    --project=booster-ai-494222 \
    --update-env-vars=SIGNUP_REQUEST_FLOW_ACTIVATED=false
  ```
  Esto crea una revisión nueva con la misma imagen (solo cambia la env var). Verificación posterior vía REST contra Cloud Run (`revision.spec.containers[].env`) antes de continuar.
- [ ] **(b) Auditar si ya hubo approves en modo legacy** mientras el flag estuvo en `true` (2026-07-02 en adelante como cota inferior conocida — el flip real puede ser anterior, confirmar con el historial de revisiones). Query contra `solicitudes_registro` (ajustar nombres de columna si difieren del schema vivo en `packages/shared-schemas`):
  ```sql
  -- Solicitudes aprobadas en modo legacy: fila en `usuarios` ya creada
  -- (aprobación silenciosa sin token) y SIN `token_hash` asociado.
  SELECT sr.id, sr.email, sr.nombre_completo, sr.estado, sr.aprobado_en
  FROM solicitudes_registro sr
  WHERE sr.estado = 'aprobado'
    AND sr.token_hash IS NULL
    AND sr.aprobado_en >= '2026-07-02'
  ORDER BY sr.aprobado_en DESC;
  ```
  Si hay filas: esos usuarios quedaron provisionados por el path legacy (sin token, ver `signup-request.ts`) — no es un incidente de seguridad (el legacy precrea igual que siempre lo hizo, ADR-052), pero documentar el conteo acá para que el paso 6 (reaper T1.7, que solo limpia huérfanos del modo NUEVO con token) no los toque por error ni se asuman "perdidos".
- [ ] **(c) La advertencia original se mantiene**: no aprobar solicitudes reales antes del paso 5 (flip) de este runbook — con el flag admin-provisioned OFF, el approve toma silenciosamente el modo legacy (precrea fila `users`, sin token ni link). Esto aplica incluso después de (a): forzar `signup_request_flow_activated=false` cierra la puerta pública de solicitudes nuevas, pero cualquier solicitud YA pendiente en la cola seguiría siendo aprobable en modo legacy si alguien reabre el flag manualmente antes de tiempo.

**Estado real de los flags verificado** (2026-07-06, antes de este PR):
- `signup_request_flow_activated`: `infrastructure/variables.tf:394-398` (default `true` histórico, ahora revertido a `false` por este PR) — sin override en `infrastructure/terraform.tfvars` (ahora sí lo tiene, explícito).
- `admin_provisioned_onboarding_enabled`: `infrastructure/variables.tf:421-425` (default `false`, sin cambios — esta es la condición que el paso 5 de este runbook flipea).

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

**Actualizado (fix round final-review, 2026-07-06, hallazgo R1)**: hasta este PR, `signup_request_flow_activated` no requería cambio en este paso porque ya estaba en `true` desde 2026-05-29 (ADR-052). Este PR lo revirtió a `false` (default en `variables.tf` + override explícito en `terraform.tfvars`) — ver Paso 0. Ese `false` viaja al aplicar el Terraform de esta rama en el paso 2. **Este paso 5 ahora debe flipear AMBOS flags**, no solo uno:

```bash
# En infrastructure/terraform.tfvars, editar (o vía -var en el apply):
#   signup_request_flow_activated        = true   # reabre la cola pública de solicitudes
#   admin_provisioned_onboarding_enabled  = true   # activa el modo admin-provisioned (token one-shot)
# Ambos deben quedar en `true` a la vez — reabrir la cola SIN el modo
# admin-provisioned recrea exactamente el hallazgo R1 (approve legacy silencioso).

cd infrastructure
terraform plan -out=tfplan-flip
# Verificar que el ÚNICO cambio in-place son las env vars SIGNUP_REQUEST_FLOW_ACTIVATED
# y ADMIN_PROVISIONED_ONBOARDING_ENABLED (ambas de "false" a "true") en
# module.service_api. Nada más.
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
3. [ ] Abrir el link → login con Google o email/password (si la sesión no existe, el flujo redirige a login y **preserva** `?token=` en la vuelta). **Corregido en el fix round del review final W1 (2026-07-06, B1)**: hasta ese fix, `navigate()`/`<Navigate>` en `login.tsx` perdían el `?redirect=` en dos puntos — el `<Navigate to="/app" />` incondicional de una sesión ya activa (línea 83) y los `navigate({ to: postLoginTarget })` post-login (líneas 128/169/176) cuando `postLoginTarget` traía un `?query` embebido; ambos se cambiaron a la forma `href` de TanStack Router. Antes de ese fix la afirmación "preserva `?token=`" de este paso era falsa en el peor caso (el listener `onAuthStateChanged` de Firebase ganándole la carrera al `navigate()` manual). Cubierto por `apps/web/src/routes/login-post-login-redirect.test.tsx` (router real, sin mocks de navegación).
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
