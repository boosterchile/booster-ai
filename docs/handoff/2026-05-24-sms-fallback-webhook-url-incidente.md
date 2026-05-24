# Incidente — SMS Fallback Gateway WEBHOOK_PUBLIC_URL vacío

- **Fecha de descubrimiento**: 2026-05-24 ~21:00 UTC
- **Duración activa**: ~17 días (2026-05-07 → 2026-05-24)
- **Severidad**: CRITICAL (producción rechazando webhooks Twilio)
- **Detectado por**: Claude (agent) durante investigación T0b del SEC-001 cierre
- **Resuelto**: 2026-05-24 21:25 UTC vía `terraform apply -target`
- **Servicio afectado**: `booster-ai-sms-fallback-gateway` (Cloud Run, southamerica-west1)
- **Tracking task**: #19

## Resumen ejecutivo

Cloud Run `booster-ai-sms-fallback-gateway` tenía la variable de entorno `WEBHOOK_PUBLIC_URL=''` (string vacío) desde el apply Wave 2/3 del 2026-05-07 (commit `4c7ccc2`). El código en `apps/sms-fallback-gateway/src/main.ts:41-89` evalúa `signatureCheckEnabled = Boolean(TWILIO_AUTH_TOKEN && WEBHOOK_PUBLIC_URL)` y en producción con `signatureCheckEnabled=false` retorna `503 Service Unavailable` a TODOS los webhooks Twilio entrantes. Resultado: durante 17 días, cualquier panic SMS de un FMC150 sin GPRS que llegó vía Twilio fue rechazado por nuestro endpoint. Twilio reintenta 3× con exponential backoff antes de dar por perdido el mensaje — algunos mensajes podrían haberse perdido completamente.

## Timeline

| Fecha | Evento |
|---|---|
| 2026-05-07 | Commit `4c7ccc2` "fix(infra): hotfix errores apply Wave 2/3" — `terraform apply` desde Wave 2/3 setea `WEBHOOK_PUBLIC_URL=''` (probable: variable sin valor o tfvars stale en ese momento) |
| 2026-05-07 → 2026-05-24 | **Bug activo silencioso** — Cloud Run `booster-ai-sms-fallback-gateway` retorna 503 a cualquier webhook Twilio; logs CRITICAL en cada cold-start (`'TWILIO_AUTH_TOKEN o WEBHOOK_PUBLIC_URL faltante en producción — rechazando todos los webhooks'`) |
| 2026-05-24 ~21:00 UTC | Claude descubre durante investigación T0b (SEC-001 cierre) que el `terraform plan` mostraba env var change pendiente; investigación REST API confirma `WEBHOOK_PUBLIC_URL=''`; lectura código confirma el path 503; Cloud Logging confirma logs CRITICAL recientes (último 2026-05-24T20:18) |
| 2026-05-24 21:25 UTC | `terraform apply -target=module.service_sms_fallback_gateway... -var-file=terraform.tfvars.local` ejecutado |
| 2026-05-24 21:25 UTC | Cloud Run revision `00217-4ds` rollout — nueva revision con `WEBHOOK_PUBLIC_URL` set correctamente |
| 2026-05-24 21:25 UTC | Verificación: `curl POST /webhook` sin signature → 403 (signature check ACTIVE, antes era 503) |
| 2026-05-24 21:27+ | NO más logs CRITICAL — fix confirmado |

## Detección

**Cómo se descubrió**: NO por alerta — por accidente durante investigación de drift IaC del SEC-001 cierre T0b. El `terraform plan` mostraba un env var change en `module.service_sms_fallback_gateway.google_cloud_run_v2_service.service` con el value sensitive hidden. Investigación REST API contra Cloud Run reveló el state real: `WEBHOOK_PUBLIC_URL = ''`. Cross-reference con código (`apps/sms-fallback-gateway/src/main.ts:42-89`) confirmó que ese estado produce 503.

**Por qué NO se detectó antes** (lessons learned):

1. **Sin alerting sobre logs CRITICAL del servicio** — los logs estaban escupiendo CRITICAL en cada cold-start pero ninguna alerta Cloud Monitoring fire.
2. **Sin synthetic monitoring del endpoint** — un health probe periódico desde fuera del cluster habría detectado el 503.
3. **Bajo volumen del servicio** — `min_instances=0` per `infrastructure/compute.tf:407-408`; el servicio levanta solo cuando hay tráfico Twilio. Los CRITICAL solo salen en boot. Si el tráfico es bajo (~1 SMS/día), boots son raros, errores poco visibles.
4. **Twilio retries enmascaran el problema** — el sender (Twilio) reintenta 3× con backoff; sin alarma desde Twilio sobre webhook failures, Booster nunca recibió un signal.

## Root cause

El env var `WEBHOOK_PUBLIC_URL` se setea en `infrastructure/compute.tf:419`:
```hcl
WEBHOOK_PUBLIC_URL = var.sms_fallback_webhook_url
```

La variable `var.sms_fallback_webhook_url` se define en `infrastructure/variables.tf` (~línea con TODO checking). El valor real para producción está en `infrastructure/terraform.tfvars.local`:
```hcl
sms_fallback_webhook_url = "https://booster-ai-sms-fallback-gateway-wbfevjot4q-tl.a.run.app/webhook"
```

`terraform.tfvars.local` está gitignored (gitignore línea 94). Cuando el apply del 2026-05-07 ocurrió, probablemente fue ejecutado sin pasar `-var-file=terraform.tfvars.local` o desde una sesión sin esa configuración local. Resultado: terraform usó el default de la variable (probablemente `""` o sin set), prov isionando el Cloud Run con env var vacío.

Hasta 2026-05-24 no se había hecho un `terraform apply` desde local que incluyera el var-file con el valor correcto.

## Impact assessment

**Servicios impactados**: SMS fallback gateway exclusivamente.

**Función afectada**: recepción de SMS Panic de Teltonika FMC150 cuando el device pierde GPRS (último resort de connectivity). El flow normal es:
1. FMC150 sin GPRS detecta condición Panic
2. FMC150 envía SMS vía red GSM a número Twilio
3. Twilio recibe SMS y POST al webhook `booster-ai-sms-fallback-gateway/webhook`
4. Gateway parsea, publica a Pub/Sub `telemetry-events`
5. Downstream `telemetry-processor` ingiere

**Bug effect**: Paso 3 retornaba 503 → Twilio reintenta 3× → si todos los retries fail (probable con bug persistente), Twilio descarta el mensaje. Booster nunca recibe la señal Panic.

**Volumen de impacto estimado**: bajo. Per memoria `project_d1_d6_demo_features` y handoffs, los FMC150 en producción están en una etapa demo (Van Oosterwyk) con cobertura GPRS normal y bajísima incidencia de eventos Panic. **No hay reportes de panic SMS perdido durante la ventana del bug**, pero la ausencia de reportes ≠ ausencia de eventos perdidos (no hay monitoring del lado Twilio).

**Compliance/Legal**: Si la pérdida de SMS Panic resultó en un evento real no notificado, podría haber implicaciones operativas/contractuales con el cliente. Acción separada: cross-check con Van Oosterwyk si reportaron incidentes en la ventana.

## Resolución

### Acción aplicada

```bash
cd infrastructure
terraform apply \
  -target=module.service_sms_fallback_gateway.google_cloud_run_v2_service.service \
  -var-file=terraform.tfvars.local \
  -auto-approve
```

Plan output: `Plan: 0 to add, 1 to change, 0 to destroy.` El único cambio: env var `WEBHOOK_PUBLIC_URL` removed (empty) + readded (real URL).

Cloud Run rollout: nueva revision `booster-ai-sms-fallback-gateway-00217-4ds` creada y promoted to serving traffic. Old revision terminada.

### Verificación post-fix

| Check | Pre-fix | Post-fix | Resultado |
|---|---|---|---|
| State real (REST API) | `WEBHOOK_PUBLIC_URL=''` | `WEBHOOK_PUBLIC_URL='https://booster-ai-sms-fallback-gateway-wbfevjot4q-tl.a.run.app/webhook'` | ✅ |
| `curl POST /webhook` (sin Twilio sig) | 503 Service Unavailable | 403 Forbidden (signature check ACTIVE rejecting invalid) | ✅ |
| Logs CRITICAL post 21:26 | (esperaba ya no) | 0 entries | ✅ |
| terraform plan -target re-run | (esperaba clean) | "No changes. Your infrastructure matches the configuration." | ✅ |

## Follow-ups / lessons learned

1. **Add Cloud Monitoring alert sobre CRITICAL logs por servicio** — alerta cuando `severity=CRITICAL` en cualquier Cloud Run service, ventana 10min, threshold ≥1. Hoy esos logs son silenciosos.

2. **Add synthetic monitor sobre `/webhook` endpoint** — health probe periódico (15min) que POST a un endpoint dedicado o GET `/health` y alerta si non-200. Esto habría detectado el bug en horas, no en 17 días.

3. **Document terraform apply runbook** — `docs/runbooks/terraform-apply.md` debe incluir warning explícito sobre incluir SIEMPRE `-var-file=terraform.tfvars.local` para applies de producción. La ausencia de este file durante un apply silencia variables críticas a defaults vacíos.

4. **Audit otros env vars con defaults vacíos** — `grep -nE 'default\s*=\s*""' infrastructure/variables.tf` revisar si hay otros vars con default empty que dependen de tfvars.local. Producir lista de "criticidad-tfvars" que deben SIEMPRE ser provided.

5. **Cross-check con Van Oosterwyk** — confirmar si reportaron algún evento Panic no notificado en la ventana 2026-05-07 → 2026-05-24. Acción: PO.

6. **Considerar contratar/setup Cloud Logging → PagerDuty/Slack** (o similar) para CRITICAL logs en servicios productivos. Hoy se confía en revisiones manuales esporádicas.

## Trazabilidad

- Incidente descubierto durante: `.specs/sec-001-cierre/sprint-1-evidence/t0-strict-gate-failure.md`
- Logs CRITICAL captured: Cloud Logging filter `resource.type="cloud_run_revision" AND resource.labels.service_name="booster-ai-sms-fallback-gateway" AND severity>=CRITICAL`
- Code path: `apps/sms-fallback-gateway/src/main.ts:41-89`
- IaC source: `infrastructure/compute.tf:412-420` + `infrastructure/terraform.tfvars.local:2`
- Fix commit: pending PR (este documento) — terraform apply ejecutado desde local; state remoto refleja el fix
- Ledger session: `.claude/ledger/2026-05-24_6f2f4fcd-da5a-46e9-9ea8-f22edbb59dde.jsonl` (events `incident_response_start`, `pre_action_articulation`, verification entries)
