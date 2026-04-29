# Runbook: Migración DNS boosterchile.com de GoDaddy a Google Cloud DNS

**Fecha:** 2026-04-29
**Estado:** Pendiente. Riesgo crítico: si se hace mal, **email institucional
se cae**. Coordinar con Booster 2.0 (que también vive en este dominio).
**Owner:** dev@boosterchile.com (con coordinación de quien administra Booster
2.0 y/o el correo del workspace).

## Por qué migrar

- Cert managed de GCP (`booster-ai-managed-cert`) está en estado
  `FAILED_NOT_VISIBLE` para los 4 dominios (`api`, `app`, `www`,
  `boosterchile.com` apex). El cert no puede provisionarse sin que el dominio
  resuelva al LB IP `34.36.187.195`.
- Hoy `api.boosterchile.com` no resuelve, así que tenemos los Cloud Run
  services accesibles solo via URLs `*.run.app`. Eso funciona pero no es
  la URL pública que queremos para customers/integraciones.
- Tener DNS en Cloud DNS (gestionado via Terraform) elimina el dependency
  manual a GoDaddy. Single source of truth.

## Por qué es delicado

`boosterchile.com` aloja MUCHO MÁS que Booster AI:

1. **Email institucional** — Google Workspace MX records. Si no se preservan,
   nadie recibe correos a `*@boosterchile.com`.
2. **Booster 2.0** — landing y app legacy en AWS Global Accelerator (apex
   apunta a IPs `13.248.243.5` y `76.223.105.230`).
3. **App Booster 2.0** — `app.boosterchile.com` apunta a Firebase Hosting
   (`big-cabinet-482101-s3.web.app`).
4. **Verifications de servicios** — Google site verification, gws-recovery.
5. **DKIM** — selector "google" para autenticación de email saliente.

Todos los records DEBEN existir en Cloud DNS antes de cambiar nameservers
en GoDaddy. Si se cambian NS sin todo migrado, breakage inmediato.

## Estado actual de Cloud DNS

La zona `booster-ai-zone` ya existe en GCP (`infrastructure/networking.tf`)
con records que apuntan al LB de Booster AI:

- `boosterchile.com` A → 34.36.187.195
- `www.boosterchile.com` A → 34.36.187.195
- `api.boosterchile.com` A → 34.36.187.195
- `app.boosterchile.com` A → 34.36.187.195
- `telemetry.boosterchile.com` A → telemetry LB IP

Estos conflictan con Booster 2.0 (que usa apex/www/app).

## Plan de migración

### Fase 1 — Discovery (offline, sin tocar nada)

1. Inventariar TODOS los records DNS actuales en GoDaddy:

   ```sh
   for type in A AAAA CNAME MX TXT NS SRV; do
     echo "--- $type ---"
     dig @ns17.domaincontrol.com boosterchile.com $type +short
     dig @ns17.domaincontrol.com '*.boosterchile.com' $type +short
   done
   ```

   También loguear vía panel GoDaddy → DNS Records → screenshot todo.

2. Inventariar lo que tenemos en Cloud DNS:

   ```sh
   gcloud dns record-sets list --zone=booster-ai-zone --project=booster-ai-494222
   ```

3. Diff. Identificar:
   - Records que SOLO están en GoDaddy (Booster 2.0 + email).
   - Records que SOLO están en Cloud DNS (Booster AI).
   - Records con conflicto de destino (apex, www, app).

### Fase 2 — Decisión de ownership por subdominio

Quién es dueño de cada subdominio post-migración:

| Subdomain | Owner | Destino |
|---|---|---|
| `boosterchile.com` (apex) | Booster 2.0 | AWS Global Accelerator IPs |
| `www.boosterchile.com` | Booster 2.0 | `ghs.googlehosted.com` (Google Sites) |
| `app.boosterchile.com` | Booster 2.0 | `big-cabinet-482101-s3.web.app` (Firebase) |
| `demo.boosterchile.com` | Booster 2.0 | `ghs.googlehosted.com` |
| `api.boosterchile.com` | Booster AI | LB IP `34.36.187.195` |
| `telemetry.boosterchile.com` | Booster AI | telemetry LB IP |
| `marketing.boosterchile.com` | Booster AI (futuro) | LB IP |
| MX, SPF, DKIM, DMARC | Email (Workspace) | Google MX |

→ **Decisión clave:** los records actuales de Booster AI en Cloud DNS para
apex/www/app **se ELIMINAN** o se cambian para apuntar a Booster 2.0.
Booster AI sólo se queda con `api`, `telemetry`, eventualmente `marketing`.

### Fase 3 — Update Terraform de Cloud DNS

Editar `infrastructure/networking.tf`:

1. **Quitar** los records que ahora son responsabilidad de Booster 2.0:
   - `google_dns_record_set.apex` (lo retomamos pero apuntando a AWS GA)
   - `google_dns_record_set.www` (apuntar a ghs)
   - `google_dns_record_set.app` (apuntar a Firebase)

   **No simplemente borrar** — cambiar destino para preservar funcionalidad.

2. **Agregar** los records que faltan:
   - MX records de Google Workspace (5 records con prioridades 1, 5, 5, 10, 10).
   - SPF: `"v=spf1 include:_spf.google.com ~all"`.
   - DKIM: `google._domainkey` con el valor real (chunked).
   - DMARC: `_dmarc` con la política actual.
   - Google verifications: `google-site-verification=...`,
     `google-gws-recovery-domain-verification=...`.

3. **TTL bajo (300s = 5min)** durante la ventana de migración. Después de
   24-48h estable, subir a 3600s.

Ver propuesta del agente externo en `docs/notes/dns-migration-proposal.md`
(NO crear ni aplicar como zona separada — integrar en `booster-ai-zone`).

### Fase 4 — Apply + verificar antes de cambiar NS

```sh
cd infrastructure
terraform plan -out=tfplan
# Review obsesivamente: no debe haber DELETIONS de records que no esperás.
terraform apply tfplan
```

Verificar contra los nameservers de Cloud DNS DIRECTAMENTE (sin tocar
GoDaddy):

```sh
NS=ns-cloud-c1.googledomains.com
dig @$NS boosterchile.com A +short
dig @$NS boosterchile.com MX +short
dig @$NS boosterchile.com TXT +short
dig @$NS google._domainkey.boosterchile.com TXT +short
dig @$NS api.boosterchile.com A +short
dig @$NS app.boosterchile.com CNAME +short
```

**Comparar con la salida de Fase 1 paso 1.** Cualquier mismatch debe
resolverse ANTES de cambiar NS en GoDaddy.

### Fase 5 — Cambiar NS en GoDaddy (corte real)

1. Hacer backup completo del export de zona en GoDaddy (CSV/screenshots).
2. GoDaddy → My Products → boosterchile.com → DNS Settings → Nameservers
   → Change → Custom Nameservers.
3. Pegar los 4 NS de Google Cloud DNS:
   - `ns-cloud-c1.googledomains.com`
   - `ns-cloud-c2.googledomains.com`
   - `ns-cloud-c3.googledomains.com`
   - `ns-cloud-c4.googledomains.com`
4. Save.

**Propagación: 5-30 min para tu ISP, hasta 48h global.**

### Fase 6 — Monitoreo post-corte

Durante las primeras 24h:

1. Mandarse correos de prueba a `dev@boosterchile.com` desde Gmail
   externo y desde el propio `dev@`. Verificar que llegan.
2. `dig boosterchile.com NS +short @8.8.8.8` debe devolver los 4
   `ns-cloud-cX`.
3. `dig api.boosterchile.com +short @8.8.8.8` debe devolver `34.36.187.195`.
4. Cert managed: `gcloud compute ssl-certificates describe
   booster-ai-managed-cert --global --project=booster-ai-494222
   --format="value(managed.status)"` debe pasar de `PROVISIONING` a
   `ACTIVE` en 5-30 min después de propagación.
5. `curl https://api.boosterchile.com/health` debe responder (404 o lo
   que sea, sin error TLS).
6. Mail a Workspace: ir a `admin.google.com → Apps → Google Workspace →
   Gmail → Authenticate email` y verificar que SPF/DKIM/DMARC pasen
   "Status: Authenticated".
7. Booster 2.0: `curl https://app.boosterchile.com` debe seguir
   resolviendo a Firebase (200 si la app está up).

### Fase 7 — Cleanup post-confirmación (T+7 días)

1. TTL → 3600s (1h). Editar `infrastructure/networking.tf` y `terraform apply`.
2. Smoke test del cloudbuild apuntando ya a `api.boosterchile.com` en
   lugar de `*.run.app`:
   - Editar `cloudbuild.production.yaml` para usar la URL pública.
   - Cambiar `infrastructure/compute.tf` `local.cloud_run_api_url` →
     `"https://api.boosterchile.com"` (o agregar como audience secundario
     antes de switchear).
3. Cancelar cualquier alerta de "DNS resolution failed" si las hubiera.

## Rollback

Si email se cae o algún subdominio crítico no funciona post-corte:

1. **Inmediato:** GoDaddy → cambiar nameservers DE VUELTA a `ns17.domaincontrol.com`
   y `ns18.domaincontrol.com` (sus defaults). Propagación 5-30 min.
2. Asegurarse de que GoDaddy tenga los records originales (no se perdieron
   en su panel cuando se cambiaron NS — GoDaddy los preserva pero no los
   sirve cuando NS están custom).
3. Postmortem antes de reintentar.

## Quién hace qué

- **dev@boosterchile.com (Felipe):** ejecuta Fases 1-7 una vez tenga signoff.
- **Owner Booster 2.0:** confirma destinos de apex/www/app (Fase 2),
  participa en testing post-corte para Booster 2.0.
- **Workspace admin (contacto@boosterchile.com):** confirma DKIM/SPF/DMARC
  values actuales y participa en validación de email post-corte.

## Referencias

- Cloud DNS docs: <https://cloud.google.com/dns/docs>
- Google Workspace MX: <https://support.google.com/a/answer/140034>
- Managed SSL cert troubleshooting: <https://cloud.google.com/load-balancing/docs/ssl-certificates/troubleshooting>
- Propuesta del agente externo (no aplicar como zona separada):
  `docs/notes/dns-migration-proposal-external-agent.md`
