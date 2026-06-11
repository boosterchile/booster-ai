# Runbook — Migración de certificados a bucket propio

- **Estado**: Vigente (ejecutar UNA vez al aplicar el PR del bucket propio)
- **Creado**: 2026-06-11
- **Contexto**: `.specs/feat-certificados-bucket-propio/spec.md` + sec-h3 §14.1.b. Los certificados de carbono salen del bucket `documents` (retención SII 6 años) al bucket propio `{project}-certificates-{env}`. El orden importa: el MISMO apply que crea el bucket cambia `CERTIFICATES_BUCKET` del api — aplicar de una deja una ventana donde `/verify` no encuentra los PDFs históricos.

## Procedimiento (orden estricto)

```bash
PROJECT=booster-ai-494222
ENV=prod
OLD=gs://${PROJECT}-documents-${ENV}
NEW=gs://${PROJECT}-certificates-${ENV}

# 1. Crear SOLO el bucket nuevo (sin tocar el env del api todavía)
cd infrastructure
terraform apply -target=google_storage_bucket.certificates

# 2. Copiar los objetos existentes (PDFs + sidecars + certs X.509 cacheados).
#    Los originales NO se pueden borrar (retención vigente en documents):
#    quedan como residuo inerte — esperado y documentado.
gcloud storage cp -r "${OLD}/certificates/*" "${NEW}/certificates/" 2>/dev/null || echo "(sin certificados previos)"
gcloud storage cp -r "${OLD}/certs/*" "${NEW}/certs/" 2>/dev/null || echo "(sin certs X.509 cacheados)"

# 3. Verificar paridad de conteo
gcloud storage ls -r "${OLD}/certificates/**" | wc -l
gcloud storage ls -r "${NEW}/certificates/**" | wc -l

# 4. Apply completo (flip de CERTIFICATES_BUCKET en el servicio api)
terraform apply

# 5. Smoke: con un tracking code REAL existente
#    GET https://api.boosterchile.com/certificates/<tracking>/verify → 200
#    y descargar el PDF de un certificado listado (signed URL) → 200.
```

## Post-migración

- La re-emisión de certificados vuelve a funcionar (el bucket nuevo no tiene retention policy; sobrescribir el path ya no da 403).
- `documents` queda 100% DTE/SII → continuar con sec-h3 §14.3: validación SC-4 (48h) y la decisión del lock (`is_locked=true`) en sesión dedicada del PO.

## Rollback

Revertir el PR (env var vuelve a documents — los objetos originales siguen ahí) y dejar el bucket nuevo vacío (prevent_destroy lo protege; eliminarlo requiere quitar el guard a propósito).
