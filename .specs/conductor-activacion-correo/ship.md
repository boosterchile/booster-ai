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

### → Resolución (mismo día): el PO eligió la opción A, ejecutada

1. **Código primero, con rojo exhibido** (el contrato de variables cambió antes
   de crear el template — al revés, el `{{3}}` del template nuevo habría
   recibido el PIN dentro de la URL):
   - `conductor-activacion-whatsapp.ts` renumerado a 3 variables
     (`{{1}}` nombre · `{{2}}` empresa · `{{3}}` RUT); el parámetro `pin`
     eliminado de la firma — la función ya ni lo recibe.
   - `conductores.ts` (call-site) deja de pasarle el PIN; el correo
     (`enviarCorreoActivacionConductor`) lo conserva — ese es el canal del PIN.
   - Test «el PIN nunca se loguea» retirado: la garantía subió de nivel (sin
     PIN en la firma no hay valor que filtrar). Evidencia en §4.
2. **`activacion_conductor_v2`** creado en el Content Editor y submitted como
   **Utility**: SID **`HX2e4ce36f96943b455ef09c6fbdc8991d`** (2026-08-03 18:24
   GMT-4). A diferencia de la v1 (rechazo automático en ~10s), quedó
   **`pending`** — pasó el clasificador; en cola de revisión de Meta.
   Body/botón/samples en el runbook.

Descartadas: B (dos envíos por alta, más código y costo) y C (riesgo WABA).

## 2. Secreto + `content_sid_ready` — preparado, NO ejecutado (condición no cumplida)

La instrucción era «con el HX aprobado» — no hay HX aprobado. Además:

- El secret `content-sid-activacion-conductor` **no existe en GCP** (verificado
  vía REST: 404) — el TF de esta rama no se ha aplicado. `terraform apply` y
  `gcloud secrets versions add` son del owner (runbook `terraform-apply.md`;
  gcloud CLI del agente sin token válido, verificado en sesión).
- `content_sid_ready` NO se flipeó a `true`: el runbook exige valor real cargado
  ANTES del flag (INC-2026-06-19), y no hay valor que cargar.

**Handoff owner — cuando `activacion_conductor_v2` pase a `approved`** (estado
al cierre de esta sesión: `pending`; consulta con el curl del runbook):

```bash
cd infrastructure
# 1. Shell + placeholder (apply acotado; NO arrastra el drift pendiente de tfplan-review.txt):
terraform apply \
  -target='google_secret_manager_secret.secrets["content-sid-activacion-conductor"]' \
  -target='google_secret_manager_secret_version.placeholder["content-sid-activacion-conductor"]'
# 2. Valor real ANTES de montar:
printf '%s' 'HX2e4ce36f96943b455ef09c6fbdc8991d' | gcloud secrets versions add content-sid-activacion-conductor \
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

## 4. Opción A — evidencia del cambio de código (2026-08-03, Node 24.11.1)

```
ROJO (contrato 3 vars contra impl de 4):
  - "3": "5864136-7",
  + "3": undefined,
  + "4": "5864136-7",
  Tests  1 failed | 5 passed (6)

VERDE tras renumerar:
  conductor-activacion-whatsapp.test.ts   6 passed (6)
  test/unit/conductores.test.ts          18 passed (18)
  suite completa apps/api    Test Files 162 passed · Tests 1960 passed
  tsc --noEmit → exit 0 · biome 3 archivos tocados: 0 errores
```

## Estado neto

| Ítem | Estado |
|---|---|
| 1. Template en Content Editor | v1 (`HX99bc…3309`, con PIN) **rechazada**; **opción A ejecutada**: código a 3 variables + `activacion_conductor_v2` (`HX2e4ce36f96943b455ef09c6fbdc8991d`) submitted **Utility**, **`pending`** al cierre |
| 2. Secreto + `content_sid_ready=true` | Bloqueado solo en la aprobación de Meta; secret sin crear en GCP (TF sin aplicar). Handoff arriba ya trae el HX real |
| 3. Resend | Cuenta = PO (perímetro del agente). DNS en Cloud DNS nuestro, listo para agregar registros. TF del secret pendiente |
