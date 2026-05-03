# @booster-ai/certificate-generator

Genera y firma digitalmente certificados de huella de carbono según GLEC v3.0.

## Diseño

Cada certificado pasa por 3 etapas:

1. **Generar PDF base** (`generar-pdf-base.ts`) — Plantilla con `pdf-lib`:
   header Booster, código de tracking, ruta origen→destino, kg CO₂e con
   desglose WTW/TTW/WTT, factor SEC Chile 2024 usado, versión GLEC v3.0,
   fecha de emisión. Reserva un placeholder de firma (`/Sig` dictionary
   con `/Contents <00...>` de tamaño fijo) para que el embed PAdES no
   reflowee el PDF después.

2. **Firmar PAdES con KMS** (`firmar-pades.ts`):
   - Calcula el hash SHA-256 del PDF excluyendo los bytes del placeholder.
   - Llama a Cloud KMS `asymmetricSign` (RSA-PSS 4096 SHA-256) — la
     private key NUNCA sale de KMS.
   - Envuelve la firma en un container PKCS7/CMS SignedData con
     `node-forge`, incluyendo el certificado X.509 self-signed que se
     emitió sobre la public key de KMS (ver `ca-self-signed.ts`).
   - Inserta el PKCS7 hex en el placeholder. Resultado: PDF con firma
     PAdES-B-B válida que Adobe Reader muestra como "Signed".

3. **Subir a GCS** (`storage.ts`) — 3 objetos por certificado:
   - `certificates/{empresa_id}/{tracking_code}.pdf` — PDF firmado embed.
   - `certificates/{empresa_id}/{tracking_code}.pdf.sig` — sidecar con la
     firma raw + metadata JSON (para auditores que validan con OpenSSL).
   - `certs/kms-key-version-{version}.pem` — cert X.509 self-signed que
     respalda esta key version. Reusado entre certificados de la misma
     key version.

## Cert X.509 self-signed sobre KMS public key

Cloud KMS no emite certificados X.509 — solo expone public keys raw en
PEM. Para que Adobe Reader / herramientas legales muestren "firma
válida", la firma PAdES debe incluir un cert X.509 que ate la public key
a una identidad (CN, O, OU).

Solución (`ca-self-signed.ts`):

1. Lee la public key de KMS (`getPublicKey`).
2. Construye un TBSCertificate (To-Be-Signed) con `node-forge`:
   `CN=Booster Carbono CL, O=Booster Chile SpA, OU=Sustentabilidad`.
3. Calcula SHA-256 del TBSCertificate DER.
4. Llama a KMS `asymmetricSign` sobre ese hash → firma raw.
5. Ensambla el cert X.509 final con `tbsCertificate + signatureAlgorithm
   + signatureValue`.
6. Cachea el cert PEM en GCS (`certs/kms-key-version-{version}.pem`)
   reusable entre certificados.

El cert es self-signed (no hay CA externa) — el modelo de confianza es
"validar contra la public key publicada por Booster en
api.boosterchile.com/.well-known/carbono-public-key.pem".

## Endpoint de validación pública

`GET /certificates/:tracking_code/verify` (en apps/api) devuelve:

```json
{
  "valid": true,
  "tracking_code": "BOO-XYZ123",
  "signed_at": "2026-05-03T18:02:11Z",
  "kms_key_version": "1",
  "sha256_pdf": "8a3...",
  "signature_b64": "...",
  "public_key_pem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

El validador externo verifica con `openssl dgst -sha256 -verify pubkey.pem
-signature signature.bin certificado.pdf`.
