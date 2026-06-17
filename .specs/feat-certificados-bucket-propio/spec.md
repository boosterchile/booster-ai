# Spec: feat-certificados-bucket-propio

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Addendum `.specs/sec-h3-dte-retention-lock/spec.md §14.1` — decisión PO 2026-06-11: opción (b) "bucket propio". Auditoría 2026-06-09 riesgo medio "re-emisión incompatible con retention policy".

## 1. Objective

Separar los certificados de huella de carbono del bucket `documents` (retención SII 6 años) a un bucket propio sin retention policy: (1) la re-emisión de certificados sobrescribe su path y hoy choca con la retención (403 dentro de la ventana, lock o no); (2) los certificados NO son DTEs — su inmutabilidad la da la firma KMS verificable offline, no el bucket; (3) `documents` queda 100% mandato legal puro, destrabando el Retention Lock (decisión final del PO en frío, sec-h3 §plan revisado).

## 2. Why now

Es EL prerequisito del lock SII (sec-h3 §14.3 paso 1) y cierra de paso el bug de re-emisión. Decisión del PO ya tomada.

## 3. Success criteria

- [ ] Bucket `{project}-certificates-{env}` en Terraform: CMEK operacional, versioning, uniform access, public_access_prevention, access logs, SIN retention policy, lifecycle NEARLINE a 1 año.
- [ ] `CERTIFICATES_BUCKET` del servicio api apunta al bucket nuevo.
- [ ] Runbook de migración con orden seguro (apply targeted → copiar objetos → apply completo) — sin ventana en que /verify pierda objetos.
- [ ] sec-h3 actualizado: prerequisito 14.1 RESUELTO con (b); documents listo para SC-4 + lock.

## 4. User-visible behaviour

Ninguno si la migración sigue el orden del runbook (los paths internos del package no cambian; solo el bucket). La re-emisión de certificados deja de fallar con 403.

## 5. Out of scope

- Aplicar `terraform apply` (lo ejecuta el PO; este ciclo entrega el PR).
- El lock de documents (`is_locked=true`) — decisión separada del PO con validación SC-4 (sec-h3).
- Borrar los objetos viejos de documents/certificates/ (imposible: retención vigente; quedan como residuo inerte documentado).
- Mecanismo de revocación/versionado lógico de certificados (la re-emisión sobrescribe por diseño actual).

## 6. Constraints

1. El SA runtime ya tiene `roles/storage.objectUser` a nivel proyecto (iam.tf:58) — sin IAM nuevo por bucket.
2. CMEK: key `storage_operational` (los certificados no son documentos legales SII; la key `documents` queda para el bucket legal).
3. El cambio de env y la creación del bucket viven en el MISMO apply → el runbook impone apply en dos pasos para copiar objetos antes del flip.

## 7. Approach

`infrastructure/storage.tf`: recurso `google_storage_bucket.certificates` (espejo de documents sin retention, CMEK operacional, log_object_prefix propio). `infrastructure/compute.tf`: `CERTIFICATES_BUCKET = google_storage_bucket.certificates.name`. Runbook `docs/runbooks/migracion-bucket-certificados.md`. Update sec-h3 decision log.

## 8. Alternatives considered

- **A. Versionar paths en documents (14.1.a)** — Rechazada por el PO: los certificados quedarían atrapados 6 años en la retención SII y el bucket legal se contamina con objetos re-emitibles.
- **B. CMEK con la key documents** — Rechazada: mezcla el propósito de las keys (separación por audit trail es el patrón del repo, security.tf).

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Apply completo sin copiar objetos → /verify 404 para certs viejos | M | M | Runbook con apply -target + copia + apply final; verificación con un tracking code real |
| Objetos viejos quedan duplicados en documents | — | L | Inevitable (retención); inertes; documentado en runbook |
| prevent_destroy ausente permite borrar el bucket nuevo | L | M | Se incluye prevent_destroy = true (mismo patrón documents) |

## 10. Test list

- T1: `terraform validate` + `terraform plan` sin errores (plan lo corre el PO; validate local si hay binario).
- T2: runbook revisado contra los nombres reales de recursos.
- T3: grep confirma que ningún otro consumidor asume certificates dentro de documents (código usa solo la env var).

## 11. Rollout

- Migración operativa (PO): `docs/runbooks/migracion-bucket-certificados.md` — apply -target bucket → `gcloud storage cp -r` de `certificates/` y `certs/` → apply completo → smoke de /verify con un tracking existente → siguiente paso sec-h3 (SC-4 + lock de documents).
- Rollback: revertir env var a documents (objetos viejos siguen ahí); el bucket nuevo queda vacío sin daño.
- Monitoring: log de emisión del próximo certificado + verify 200.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + decisión PO opción (b) vía AskUserQuestion.
