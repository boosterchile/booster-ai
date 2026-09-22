# Emisión de certificados: la SA del API no puede listar versiones de la clave KMS

**Estado**: aceptada (OK explícito del PO al binding, 2026-09-14) · **Slot**: 1 «Huella punta a punta», criterio de término (certificado emitido) · **Pedido por**: PO tras cerrar BOO-BKAXIK.

## 1. El problema (medido en producción)

Al confirmar la entrega de BOO-BKAXIK (17:01:57Z) la huella quedó `medida`, pero
`emitirCertificadoViaje` falló: `Permission 'cloudkms.cryptoKeyVersions.list' denied
on resource …/cryptoKeys/certificate-carbono-signing` (`IAM_PERMISSION_DENIED`,
code 7). Es la causa de que producción nunca haya emitido un certificado.

- La política real de la clave da a `booster-cloudrun-sa` solo `signerVerifier` y
  `publicKeyViewer` (leído con `getIamPolicy`).
- Ninguno de los dos incluye `cloudkms.cryptoKeyVersions.list`; `cloudkms.viewer`
  sí (leído con `iam.googleapis.com/v1/roles/*`).
- `firmar-kms.ts` lista las versiones para resolver la primaria y no fijar
  `/cryptoKeyVersions/1`, que rompería al rotar.

## 2. Cambio

`infrastructure/security.tf`: un tercer `google_kms_crypto_key_iam_member` con
`roles/cloudkms.viewer` para la SA runtime, **acotado a la clave**
`certificate-carbono-signing` (no al keyring ni al proyecto). Solo lectura: no da
firma ni cifrado adicionales.

## 3. Criterios de salida

- [x] `terraform fmt -check` y `terraform validate` en local (sin backend, sin estado).
- [ ] `terraform plan` del PO muestra exactamente **1 to add, 0 to change, 0 to destroy**.
- [ ] `terraform apply` (PO). — 2026-09-22, evidencia parcial: el binding `roles/cloudkms.viewer` → booster-cloudrun-sa existe (getIamPolicy), pero lo creó `gcloud kms keys add-iam-policy-binding` (audit SetIamPolicy 2026-09-14T17:07:35Z, dev@boosterchile.com), no Terraform: sigue fuera del state (drift run 35747885290: «will be created»).
- [ ] Backfill: `backfill-certificados.ts --dry-run` lista BOO-BKAXIK; sin `--dry-run`
      emite el PDF, y `metricas_viaje.certificado_emitido_en` queda poblado. — 2026-09-22, evidencia parcial: el resultado existe (certificado_emitido_en 2026-09-14 21:40:40.91Z, PDF en el bucket, /verify 200), pero no hay registro de que saliera de `backfill-certificados.ts` (#685 describe un script manual acotado a BKAXIK); el `--dry-run` no es verificable.
