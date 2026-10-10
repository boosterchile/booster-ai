# Runbook — Drill de rollback de microservicios extraídos

- **Estado**: Vigente
- **Origen**: [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md) §2 y `.specs/microservicios-t10-21/spec.md`, criterio de salida por servicio: "falla provocada, flag apagado y monitoreo retomado en menos de 5 min con datos consistentes".
- **Dónde corre**: staging (`booster-ai-stg-494222`, ver [`staging.md`](staging.md)). En prod no se provocan fallas.
- **Quién**: el operador, con credenciales de staging. El agente prepara el drill; no tiene credenciales GCP.

Cada servicio tiene su sección. Las secciones de `notification-service` y `matching-engine` se agregan con su extracción, porque su rollback es por flag (`<SERVICIO>_VIA_MICROSERVICE=false`) y no por revisión.

---

## document-service (worker TED)

**Rollback = volver a la revisión anterior.** El api nunca decodificó TED inline, así que no hay flag que devuelva la lógica al monolito. Mientras el worker está caído, los documentos esperan sin pérdida:

- en la subscription `document-uploaded-processor-sub`, con retención de 7 días y DLQ tras 5 nacks;
- en la tabla, como `pendiente` o `fallido`, que el claim condicional vuelve a tomar.

### Criterios de éxito

| # | Criterio | Cómo se mide |
|---|---|---|
| D1 | La falla se detecta | Los logs `severity>=ERROR` de la revisión rota muestran `error procesando document.uploaded, nack para reintento` |
| D2 | Rollback en < 5 min | Desde el comando `update-traffic` hasta el primer `document.uploaded procesado` de la revisión sana (timestamps de los logs) |
| D3 | Datos consistentes | El documento de prueba termina en `decodificado` (o `fallido` por dato, no por infraestructura). No queda ninguna fila en `procesando` más de 30 min (el cron `documentos-pendientes` la liberaría) |
| D4 | La revisión rota deja de consumir | Ningún log de la revisión rota pasa 5 min después del rollback. Un consumer pull no recibe tráfico HTTP, así que hay que verificar que Cloud Run baja sus instancias al quedar sin tráfico. Si no las baja, hay que borrar la revisión rota y el runbook debe decirlo |
| D5 | Config igual a Terraform | Un `terraform plan` de staging posterior al drill da cero cambios en `module.service_document` |

### Pasos

```bash
PROJECT=booster-ai-stg-494222 ; REGION=southamerica-west1 ; SVC=booster-ai-document-service
BUCKET=$(gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(spec.template.spec.containers[0].env[?name=="DOCUMENTS_BUCKET"].value)')

# 0. Línea base: anotar la revisión sana.
SANA=$(gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.latestReadyRevisionName)'); echo "SANA=$SANA"

# 1. Falla provocada: revisión nueva con un bucket inexistente. Arranca bien,
#    pero cada descarga GCS falla, así que hay nack, reintento y DLQ.
date -u +%FT%TZ   # T_FALLA
gcloud run services update $SVC --region=$REGION --project=$PROJECT \
  --update-env-vars=DOCUMENTS_BUCKET=drill-bucket-inexistente

# 2. Carga: subir un PDF de prueba a una orden de staging desde la PWA
#    (https://app.staging.boosterchile.com) y anotar su documentId.

# 3. D1: confirmar la detección.
gcloud logging read "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"$SVC\" severity>=ERROR" \
  --project=$PROJECT --limit=10 --freshness=10m --format='value(timestamp,resource.labels.revision_name,jsonPayload.message)'

# 4. Rollback, cronometrado (D2).
date -u +%FT%TZ   # T_ROLLBACK
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT --to-revisions=$SANA=100

# 5. D2/D4: primer procesamiento de la revisión sana y silencio de la rota.
gcloud logging read "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"$SVC\" jsonPayload.message=\"document.uploaded procesado\"" \
  --project=$PROJECT --limit=5 --freshness=15m --format='value(timestamp,resource.labels.revision_name)'

# 6. D3: estado del documento de prueba (Cloud SQL Studio o psql por el proxy).
#    SELECT id, extraction_status, actualizado_en FROM documentos_transporte WHERE id = '<documentId>';

# 7. Limpieza (D5): devolver la env real y verificar contra Terraform.
gcloud run services update $SVC --region=$REGION --project=$PROJECT \
  --update-env-vars=DOCUMENTS_BUCKET=$BUCKET --to-latest
cd infrastructure && terraform plan -var-file=environments/staging/terraform.tfvars \
  -target=module.service_document   # esperado: No changes (salvo la imagen, que Terraform ignora)
```

### Registro

Pegar en el PR o en `docs/handoff/` (snapshot fechado):

- `SANA`, `T_FALLA`, `T_ROLLBACK`, timestamp del primer `procesado` de `SANA` → D2 = diferencia.
- El estado final del documento de prueba (D3) y la salida del `terraform plan` (D5).
- Si D4 falla (la revisión rota sigue consumiendo), agregar a este runbook el paso para borrarla: `gcloud run revisions delete <rota>`.
