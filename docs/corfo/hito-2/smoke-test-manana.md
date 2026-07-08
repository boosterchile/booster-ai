# Smoke test matinal — cierre hito 2 CORFO (2026-07-07 AM)

> Continúa el cierre de la sesión del 2026-07-06 que paró a las 04:06 por regla de parada.
> Estado al parar: activación W1 **flip aplicado y verificado** (revisión `booster-ai-api-00375-wkx`, ambos flags `true`, secret v2, imagen batch `43a5af0` al 100%). Faltan: tick del reaper (paso 6) y E2E del alta + cadena demo (paso 7).
> Región Cloud Run: `southamerica-west1`. Región Cloud Scheduler: `southamerica-east1`. Proyecto: `booster-ai-494222`. Servicio: `booster-ai-api`. API pública: `https://api.boosterchile.com`. Web: `https://app.boosterchile.com`.
> Cuenta gh activa debe ser `boosterchile` (`gh auth switch --user boosterchile` si no).

---

## Paso 0 — Sanity de que el flip sigue vivo (1 min)

```bash
gcloud run services describe booster-ai-api --region=southamerica-west1 --project=booster-ai-494222 \
  --format="value(spec.template.spec.containers[0].env)" | tr ',' '\n' | grep -E "SIGNUP_REQUEST_FLOW_ACTIVATED|ADMIN_PROVISIONED_ONBOARDING_ENABLED|EMPRESA_SELF_ONBOARDING"
```
**Esperado**: `SIGNUP_REQUEST_FLOW_ACTIVATED=true`, `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true`, `EMPRESA_SELF_ONBOARDING` ausente. Health: `curl -s -o /dev/null -w "%{http_code}" https://api.boosterchile.com/health/signup-flow` → `200`.

---

## Paso 6 — Tick manual del reaper (higiene, dry-run, no bloqueante)

El job arranca `PAUSED` por diseño. Secuencia resume → run → observar → re-pause:
```bash
gcloud scheduler jobs resume reap-orphan-onboarding-firebase --location=southamerica-east1 --project=booster-ai-494222
gcloud scheduler jobs run    reap-orphan-onboarding-firebase --location=southamerica-east1 --project=booster-ai-494222
sleep 30
gcloud scheduler jobs pause  reap-orphan-onboarding-firebase --location=southamerica-east1 --project=booster-ai-494222
```
**Evidencia a capturar**: los logs del job (el `reaper.run.summary` estructurado — debe reportar dry-run, conteo de huérfanos candidatos, `destructive=false`):
```bash
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="booster-ai-api" (jsonPayload.msg:"reaper" OR httpRequest.requestUrl:"reap-orphan-onboarding")' \
  --project=booster-ai-494222 --limit=15 --freshness=10m --format="table(timestamp,jsonPayload.msg,httpRequest.status)"
```
**Criterio**: HTTP 200 del `/admin/jobs/reap-orphan-onboarding-firebase` + summary sin errores. Si dispara alerta → revisar antes de seguir. Dejar el job en `PAUSED` al terminar (lo confirma el tercer comando).

---

## Paso 7a — E2E del alta de usuarios (flujo crítico, multi-tap)

Requiere un email de prueba real que puedas revisar (o descartar — el link se copia del panel, no llega por correo: Fase 2 no existe). Sea `EMAIL_PRUEBA`.

1. **Solicitud pública** (anti-enumeración, 202 siempre):
   ```bash
   curl -s -X POST https://api.boosterchile.com/api/v1/signup-request \
     -H "Content-Type: application/json" \
     -d '{"email":"EMAIL_PRUEBA","nombreCompleto":"Piloto Smoke Test"}' -w "\nHTTP %{http_code}\n"
   ```
   **Esperado**: `202 {"ok":true}`. (Alternativa UI: abrir `https://app.boosterchile.com/solicitar-acceso`, llenar y enviar → mensaje neutro de éxito.)

2. **Aprobar en el panel** (`https://app.boosterchile.com` → login como platform admin → panel de solicitudes de registro): aprobar la solicitud de `EMAIL_PRUEBA`. **Copiar el enlace de onboarding que aparece UNA sola vez** ("cópialo ahora, no se volverá a mostrar"). Sea `LINK_ONBOARDING` (formato `https://app.boosterchile.com/onboarding-admin?token=...`).
   - **Evidencia**: screenshot del panel con el link copiable visible (tapar el token si el screenshot va a un anexo público) + el `firebase_uid`/`user_id` de la respuesta del approve.

3. **Consumir el token** (abre `LINK_ONBOARDING` en un navegador sin sesión previa): loguearse cuando lo pida (el `?token=` sobrevive el round-trip por login — fix B1) → completar `OnboardingForm` (datos de empresa + rol dueño) → enviar.
   - **Esperado**: alta 201, redirección a `/app`, `/me` sin `needs_onboarding`.
   - **Evidencia**: `GET /me` autenticado como el nuevo usuario → capturar el JSON con `needs_onboarding:false` + la empresa y membership creadas.

4. **Verificaciones negativas** (postura anti-oráculo SEC-001):
   - Reabrir `LINK_ONBOARDING` (segundo consumo) → **403** genérico (`onboarding_token_invalid`), no 409.
   - `POST /empresas/onboarding` (path viejo self-service) → **403** (SC3, sigue muerto).

5. **Trace en BD** (para pegar en el informe/matriz):
   ```bash
   scripts/db/agent-query.sh -c "SELECT id, email, estado, aprobado_en, (token_hash IS NOT NULL) AS con_token, consumido_en FROM solicitudes_registro WHERE email='EMAIL_PRUEBA'"
   ```
   **Esperado**: `estado=aprobado`, `con_token=t`, `consumido_en` no nulo. Este es el **trace E2E real** que reemplaza el placeholder `[PENDIENTE — smoke AM]` en `informe-hito-2.md` y `evidencia/meta-1-crud-auth.md`.

---

## Paso 7b — Cadena demo: IMEI self-service → telemetría → temperatura

Demuestra Meta 2 (2 sensores por envío) end-to-end con el usuario recién creado (o el piloto existente).

1. **Configurar IMEI en la UI** (como dueño de la empresa, detalle de un vehículo → sección "Dispositivo Teltonika"): ingresar un IMEI de 15 dígitos reservado para demo (que NO colisione con el device real del piloto — verificar con `scripts/db/agent-query.sh -c "SELECT patente, teltonika_imei FROM vehiculos WHERE teltonika_imei IS NOT NULL"`). Guardar.
   - **Evidencia**: screenshot del vehículo con el IMEI asociado.

2. **Correr el simulador W3** contra prod (envía GPS ruta La Serena↔Coquimbo + temperatura Dallas):
   ```bash
   export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
   cd apps/... # raíz del repo
   pnpm --filter @booster-ai/demo-scripts exec tsx scripts/demo/simulate-envio-telemetry.ts \
     --imei <IMEI_DEMO_15_DIGITOS> --host 34.176.126.66 --port 5027 --interval-s 10 --temp-profile frio
   # Ctrl+C tras ~2-3 min (deja llegar varios puntos). Precauciones: IMEI reservado, intervalo ≥10s.
   ```
   - **Evidencia**: que el simulador reporte handshake OK + ACKs del gateway.

3. **Verificar en BD que llegó posición + temperatura**:
   ```bash
   scripts/db/agent-query.sh -c "SELECT timestamp_device, latitude, longitude, io_data->>'72' AS raw_temp72 FROM telemetria_puntos tp JOIN vehiculos v ON v.id=tp.vehiculo_id WHERE v.teltonika_imei='<IMEI_DEMO>' ORDER BY timestamp_device DESC LIMIT 5"
   ```
   **Esperado**: filas con lat/lng de la ruta y `raw_temp72` presente (uint16 crudo; el endpoint lo interpreta a °C con signo).

4. **Screenshot en vehiculo-live** (`https://app.boosterchile.com/app/vehiculos/<id>/live`): mapa con la posición + stat **Temperatura** mostrando `X.X °C` + antigüedad.
   - **Evidencia**: screenshot → `docs/corfo/hito-2/evidencia/w3-vehiculo-live-temperatura.png` (el `.gitignore` ya permite `docs/corfo/**/*.png`).

---

## Paso 8 — Llenado de placeholders + cierre del informe

1. Reemplazar en `docs/corfo/hito-2/informe-hito-2.md` y `docs/corfo/hito-2/evidencia/meta-1-crud-auth.md` el `[PENDIENTE — smoke AM]` del trace E2E por el resultado real del paso 7a.5 (id de solicitud, estado, consumido_en) — sin PII innecesaria.
2. Agregar el screenshot de la cadena demo (7b.4) como anexo referenciado.
3. Commit `docs(corfo): completa trace E2E y evidencia de cadena demo (smoke AM)` en la rama `chore/hito-2-cierre` + push.
4. Monitoreo 2h post-deploy (runbook paso 8): error_rate/P95/logs del servicio `booster-ai-api` — confirmar sin anomalías tras la activación real de usuarios.

---

## Notas de seguridad para el smoke

- Todo comando `gcloud`/`gh` mutante y toda query con `-y` (bypass del guard DML de agent-query) son del **PO** — las deny rules de `.claude/settings.local.json` (D5) las bloquean para el agente a propósito.
- El agente puede: verificar por REST (read-only), correr `agent-query.sh` sin `-y` (SELECT), redactar y capturar evidencia.
