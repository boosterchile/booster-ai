# Ship — provisión externa del canal de activación

Sesión de ops 2026-08-03 (agente, browser sobre sesión del PO). Checklist original:
(1) cargar `activacion_conductor_v1` en el Content Editor de Twilio, categoría
Authentication; (2) con el HX aprobado, cargar el secreto y flipear
`content_sid_ready`; (3) Resend: cuenta + dominio + `RESEND_API_KEY`.

## 1. Template Twilio — creado y sometido; RECHAZADO por Meta

**Ejecutado en Twilio Console** (la cuenta Twilio del proyecto — SID en
Secret Manager `twilio-account-sid`):

- `activacion_conductor_v1` · Spanish (ES) · tipo **call-to-action** ·
  **SID `HX99bcd1331ff417782e0c4d279cd13309`** · creado 2026-08-03 17:39 GMT-4.
- Body y botón según el contrato de variables de la spec (§3.5); samples sintéticos
  (sin datos reales). Detalle completo en
  [`docs/runbooks/load-content-sids.md`](../../docs/runbooks/load-content-sids.md).
- Sometido a WhatsApp review como **Utility** — y acá la primera desviación
  observada de la spec: **la categoría Authentication no existe para esta forma**.
  El diálogo de submit de un template call-to-action solo ofrece Marketing y
  Utility; Authentication es un content-type aparte de formato fijo de Meta
  (solo código OTP + botón copy-code, sin variables custom ni botón URL), que
  rompería el contrato `{{1}}..{{4}}` que el código ya envía.
- **Resultado: `rejected` en ~10 segundos** (auto-clasificador). Content API:
  `rejection_reason: "Unknown rejection reason"`, `category: UTILITY`,
  `allow_category_change: true`.

**Diagnóstico** (por diferencia con precedentes de la casa): `tracking_link_v1`
tiene la misma forma exacta —CTA, variables, botón URL a `app.boosterchile.com`—
sin código de un solo uso, y fue aprobado. El delta único es la línea
«Tu PIN de activación es {{3}}»: la política de Meta manda los OTP a la categoría
Authentication, y Authentication no admite este diseño. **El §3.5 de la spec
(PIN + nombre/empresa + enlace en un solo template) es irrealizable en WhatsApp.**

### → DECISIÓN PO PENDIENTE (bloquea el resto del ítem 2)

- **A (recomendada)**: `activacion_conductor_v2` Utility **sin PIN** — el WhatsApp
  lleva quién lo registró + botón con el RUT embebido; el PIN viaja por correo y
  por «Copiar enlace + PIN» del alta. Requiere renumerar variables en
  `conductor-activacion-whatsapp.ts` (3 vars) ANTES de activar — si no, el {{3}}
  del template nuevo pondría el PIN dentro de la URL.
- **B**: dos templates (Authentication fijo para el PIN + Utility para el enlace).
- **C**: eludir el clasificador con otro wording — descartado (riesgo WABA).

## 2. Secreto + `content_sid_ready` — preparado, NO ejecutado (condición no cumplida)

La instrucción era «con el HX aprobado» — no hay HX aprobado. Además:

- El secret `content-sid-activacion-conductor` **no existe en GCP** (verificado
  vía REST: 404) — el TF de esta rama no se ha aplicado. `terraform apply` y
  `gcloud secrets versions add` son del owner (runbook `terraform-apply.md`;
  gcloud CLI del agente sin token válido, verificado en sesión).
- `content_sid_ready` NO se flipeó a `true`: el runbook exige valor real cargado
  ANTES del flag (INC-2026-06-19), y no hay valor que cargar.

**Handoff owner — cuando exista template aprobado `HX<nuevo>`:**

```bash
cd infrastructure
# 1. Shell + placeholder (apply acotado; NO arrastra el drift pendiente de tfplan-review.txt):
terraform apply \
  -target='google_secret_manager_secret.secrets["content-sid-activacion-conductor"]' \
  -target='google_secret_manager_secret_version.placeholder["content-sid-activacion-conductor"]'
# 2. Valor real ANTES de montar:
printf '%s' 'HX<nuevo>' | gcloud secrets versions add content-sid-activacion-conductor \
  --data-file=- --project=booster-ai-494222
# 3. Flip en variables.tf → default de content_sid_ready:
#      "content-sid-activacion-conductor" = true
#    y luego plan → preflight (check-validated-secret-placeholders.mjs) → apply.
```

## 3. Resend — bloqueado en la cuenta (acción PO); DNS listo para ejecutar

- **No hay sesión Resend en el browser** (redirige a login) y crear cuentas /
  autenticar está fuera del perímetro del agente. Pasos PO:
  1. Crear cuenta en resend.com (con `dev@boosterchile.com`).
  2. Domains → Add domain → `boosterchile.com` (region da lo mismo para DNS).
  3. Avisar al agente O agregar los registros que Resend muestre (DKIM
     `resend._domainkey` TXT + SPF/MX de `send.`) en la zona Cloud DNS.
- **La zona DNS es nuestra**: `booster-ai-zone` (`boosterchile.com.`) vive en
  Cloud DNS del proyecto `booster-ai-494222` y es la autoritativa (NS
  `ns-cloud-c*.googledomains.com` verificados). No está en Terraform (clickops)
  → los registros de Resend se agregan por consola/API sin pelear con el estado.
  Verificado: `resend._domainkey.boosterchile.com` hoy no existe.
- `RESEND_API_KEY`: crearla en Resend (scope "Sending access", dominio
  `boosterchile.com`) y cargarla el owner en Secret Manager. El secret **tampoco
  está declarado aún en `security.tf`** — agregarlo a `local.secret_names` +
  mount en el api es trabajo TF pendiente (spec §4 lo fija como territorio PO).
  `config.ts` ya la espera (`RESEND_API_KEY` `.min(8).optional()`, sin regex →
  no aplica el gate de placeholders validados) y el remitente default es
  `EMAIL_FROM = 'Booster <no-reply@boosterchile.com>'`.

## Estado neto

| Ítem | Estado |
|---|---|
| 1. Template en Content Editor | Creado y sometido (`HX99bc…3309`); **rechazado por Meta**; categoría Authentication demostrada imposible para el diseño → decisión PO A/B |
| 2. Secreto + `content_sid_ready=true` | No ejecutable aún (sin HX aprobado; secret sin crear en GCP). Handoff exacto arriba |
| 3. Resend | Cuenta = PO (perímetro del agente). DNS en Cloud DNS nuestro, listo para agregar registros. TF del secret pendiente |
