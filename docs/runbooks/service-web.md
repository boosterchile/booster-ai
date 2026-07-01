# Runbook — Servicio `apps/web` (PWA multi-rol, nginx en Cloud Run)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-web` · región `southamerica-west1` · project `booster-ai-494222`
- **URL pública**: `https://app.boosterchile.com` (vía GCLB; `ingress = INTERNAL_LOAD_BALANCER`, ADR-062). El marketing/landing (`www.boosterchile.com`) tiene su propio uptime check.
- **Naturaleza**: **bundle estático** (Vite + React + TanStack Router + vite-plugin-pwa) servido por **nginx unprivileged** (no Node). Puerto 8080. Dockerfile multi-stage `apps/web/Dockerfile`; config nginx en `apps/web/nginx.conf.template` (procesada con `envsubst` al arrancar para resolver `$PORT`).

> **Toda la config del frontend es build-time**: `VITE_API_URL`, las claves Firebase web, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_RECAPTCHA_SITE_KEY` se sustituyen textualmente en el bundle al compilar (`cloudbuild.production.yaml`, build-args). **No hay runtime injection** → cambiar cualquiera de esas variables exige **rebuild + redeploy**, no basta tocar el env del servicio Cloud Run.

---

## Health endpoints

| Endpoint | Qué es |
|---|---|
| `GET /healthz` | nginx devuelve `200 text/plain "ok"` (liveness Cloud Run). |
| `GET /` | sirve `index.html` (200). Cualquier ruta no-asset cae acá por el SPA fallback `try_files $uri $uri/ /index.html`. |

```bash
curl -fsS https://app.boosterchile.com/healthz ; echo
curl -fsS -o /dev/null -w '%{http_code}\n' https://app.boosterchile.com/
```

Caching servido por nginx (relevante para incidentes de "versión vieja"):
- `*.js` / `*.css` (con hash de Vite) → `Cache-Control: 1y, immutable`.
- `/sw.js` y `index.html` → `Cache-Control: no-cache` (deben revalidarse en cada deploy para que el `autoUpdate` del service worker entregue la versión nueva).

---

## Síntomas / alertas que disparan este runbook

| Señal | Significado |
|---|---|
| `Uptime check failing` con host `app.boosterchile.com` (`monitoring.tf:168`, agrupado por `resource.host`) | la PWA no responde 200 |
| Usuarios reportan **pantalla en blanco / app no carga** | bundle roto, nginx mal desplegado, o `index.html` ausente |
| Usuarios reportan **"versión vieja" / UI desincronizada con el backend** | service worker sirviendo bundle stale (caching) |
| Errores 4xx/5xx del **api** desde la web | el problema es del backend, no de la web → `service-api.md` |

> La web es estática y de bajo tráfico (`min_instances=0`, cold start 5–10 s tolerado). Un primer request lento tras escalar a cero es normal, no incidente.

---

## Diagnóstico

```bash
SVC=booster-ai-web ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# 1. ¿Qué revisión/imagen sirve y desde qué commit?
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, spec.template.spec.containers[0].image)'
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT \
  --format='table(metadata.name, metadata.creationTimestamp, status.conditions[0].status)' --limit=5

# 2. Logs de nginx (errores de arranque del container, p.ej. envsubst/template roto)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-web" severity>=WARNING' \
  --project=$PROJECT --limit=40 --freshness=1h

# 3. ¿El bundle responde y trae la versión esperada?
curl -fsS https://app.boosterchile.com/ -o /tmp/index.html && \
  grep -o 'assets/[^"]*\.js' /tmp/index.html | head   # los nombres llevan el hash de build
curl -fsS -D - -o /dev/null https://app.boosterchile.com/sw.js | grep -i cache-control
```

---

## Pantalla en blanco / la app no carga

1. **¿Es la web o el api?** Abrí devtools → Network. Si `index.html` y los `assets/*.js` cargan 200 pero la app muere por requests al api que fallan → es el **backend**, ir a `service-api.md`. Si los propios assets dan 404/5xx → es la web.
2. **¿La revisión arranca?** Si las revisiones recientes están `Failed`, casi siempre es el container nginx: template mal sustituido o `dist/` vacío (build roto). Mirar los logs (paso 2). El Dockerfile hace sanity-checks (lista `index.html` y verifica los templates) — un fallo ahí rompe el build, no el deploy.
3. **Mitigación inmediata = rollback** a la última revisión sana:
   ```bash
   gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
   gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
     --to-revisions=<REVISION_SANA>=100
   ```
4. **Config build-time mal inyectada**: si la app carga pero falla auth (Firebase), mapas (Google Maps) o App Check (reCAPTCHA), sospechar una `VITE_*` incorrecta en el build. Eso **no se arregla tocando el env del servicio** — requiere corregir el build-arg en `cloudbuild.production.yaml` y **rebuild + redeploy**.

---

## "Versión vieja" / UI stale (service worker)

La PWA usa `autoUpdate` (vite-plugin-pwa). El mecanismo que garantiza que el usuario reciba la versión nueva es que **`/sw.js` e `index.html` se sirvan con `no-cache`** (los assets hasheados sí son immutables 1y).

1. **Verificar headers de nginx**:
   ```bash
   curl -fsS -D - -o /dev/null https://app.boosterchile.com/sw.js     | grep -i cache-control  # debe decir no-cache
   curl -fsS -D - -o /dev/null https://app.boosterchile.com/index.html | grep -i cache-control  # debe decir no-cache
   ```
   Si `/sw.js` NO viene `no-cache` → el `nginx.conf.template` no aplicó bien en la revisión desplegada. Re-deploy con la config correcta; mientras tanto los usuarios pueden quedar con bundle viejo.
2. **Lado usuario** (soporte): forzar update es recargar con el SW desregistrado (hard reload / "Update on reload" en devtools → Application → Service Workers). No es acción de servidor.
3. Confirmar que el deploy efectivamente publicó assets nuevos (los nombres `assets/*.js` cambian con cada build; paso 3 de diagnóstico).

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal de alerta: email (`monitoring.tf`).
- Si no se resuelve en **30 min**, registrar en `docs/handoff/CURRENT.md`.
- La web es **bajo riesgo** (estática, sin estado, deploy directo sin canary): el rollback de revisión casi siempre la restaura. Si el rollback no la arregla, el problema suele estar **aguas arriba** (GCLB/Cloud Armor/DNS/cert) o ser en realidad del **api** → escalar a `service-api.md`.

## Refs

- Deploy: skill `booster-deploy-cloud-run`; `cloudbuild.production.yaml` (build-args `_VITE_*`).
- Rotación de la Maps API key (referrer-restricted): `rotacion-maps-api-key.md`.
- Ingress sólo-GCLB: ADR-062.
- Config frontend: `apps/web/src/lib/api-url.ts`, `apps/web/nginx.conf.template`, `apps/web/Dockerfile`.
