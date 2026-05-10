# ADR-015 — KMS RSA PKCS#1 v1.5 4096-SHA256 para certificados de huella de carbono

- **Estado**: Accepted
- **Fecha**: 2026-04-29 (decisión); 2026-05-03 (ADR escrito retroactivo)
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

Booster AI emite certificados firmados de huella de carbono cuando un viaje pasa a `entregado`. El certificado es un **PDF firmado digitalmente** con metadata GLEC v3.0 (factor de emisión, distancia, masa transportada, tCO₂eq calculadas, factor de carga). El archivo lo guarda Cloud Storage y queda accesible públicamente para que cualquier auditor externo (stakeholder ESG, comprador con compromiso scope 3, regulador) pueda **validar la firma criptográficamente sin depender de Booster AI**.

Esto exige tres propiedades simultáneas:

1. **No-repudiable**: la firma debe ser verificable contra una public key pública, sin revelar el material privado.
2. **Auditable a 10 años mínimo**: una vez emitido el certificado, las firmas deben seguir verificables aunque rote la key. Los algoritmos elegidos deben mantenerse como standards reconocidos por NIST/ISO durante esa ventana.
3. **Interoperabilidad universal**: el auditor externo abre el PDF en Adobe Reader / valida con OpenSSL en CLI / corre verificación con Java JCE en su pipeline ESG / usa node-forge / usa Bouncy Castle. Todos deben poder validar sin parámetros extra.

El espacio de decisión tenía dos ejes:

- **Padding scheme**: PSS (PKCS#1 v2.1) vs PKCS#1 v1.5
- **Curve / key size**: RSA 4096 vs RSA 2048 vs ECDSA P-256 vs ECDSA P-384 vs Ed25519

## Decisión

Usar **RSA con padding PKCS#1 v1.5, 4096 bits, SHA-256** para firmar los certificados de carbono. La key es una `google_kms_crypto_key` con `purpose = "ASYMMETRIC_SIGN"` y `algorithm = "RSA_SIGN_PKCS1_4096_SHA256"` (`infrastructure/security.tf:68-81`).

Características concretas:

- **Padding PKCS#1 v1.5** (no PSS).
- **4096 bits** (no 2048).
- **SHA-256** como hash subyacente.
- **Determinístico**: misma firma para mismo input — propiedad útil para auditores que reverifican meses después.
- **Key dedicada**: separada de `document_signing` (que firma actas de entrega y DTEs con SHA-512). Cada propósito su key, audit trail limpio.
- **IAM least-privilege**: solo el SA `cloud_run_runtime` tiene `roles/cloudkms.signerVerifier` y `roles/cloudkms.publicKeyViewer` sobre esta key específica (`security.tf:87-100`). Sin signing global sobre el keyring.
- **Public key pública**: el endpoint `GET /certificates/:tracking_code/verify` (Hono, server.ts:251-262) sirve la public key PEM + metadata sin auth. Mismo patrón que `webfinger`/`jwks` para que cualquier auditor externo pueda validar con `openssl dgst -sha256 -verify pubkey.pem -signature sig.bin certificado.pdf`.

## Alternativas consideradas y rechazadas

### A. RSA-PSS 4096 SHA-256 (PKCS#1 v2.1)

Propuesta inicial — modernidad criptográfica.

- **Ventajas**: PSS es probabilistic, ofrece reducción de seguridad demostrable, recomendado por RFC 8017 §8.
- **Por qué se rechazó**: PSS exige especificar `hashAlgorithm + maskGenAlgorithm + saltLength` en el `AlgorithmIdentifier` del cert X.509 y del `SignerInfo` PKCS#7 que encapsula la firma del PDF. Validadores PAdES viejos (Adobe Reader 11, OpenSSL <1.1.1, Java <8u121, node-forge <1.0) no soportan `id-RSASSA-PSS` y rechazan la firma. Para certificados que viven 10+ años en archivos de auditores, romper la verificación con Reader 11 es inaceptable. PKCS#1 v1.5 es **interoperable universalmente** sin parámetros ASN.1 extras.
- **Nota**: Hay un drift documental — `packages/certificate-generator/src/firmar-kms.ts:24` dice "RSA-PSS 4096 SHA-256 → 512 bytes" en un comentario, pero el algoritmo real declarado en TF es `RSA_SIGN_PKCS1_4096_SHA256`. El comentario quedó del diseño inicial PSS y no se actualizó al pivote a PKCS#1. Tarea follow-up: alinear el comentario con la realidad TF.

### B. RSA 2048 con cualquier padding

- **Por qué se rechazó**: NIST SP 800-131A clasifica 2048 como "secure until 2030". Los certificados de carbono deben verificar a 10 años (hasta 2036+). El upgrade pre-emptivo a 4096 evita re-firmar certificados históricos cuando 2048 entre en deprecation.

### C. ECDSA P-256 / P-384

- **Por qué se rechazó**: ECDSA es **no-determinístico** por naturaleza (cada firma usa un nonce aleatorio). Si la implementación tiene un bug en el RNG (caso histórico: Sony PS3, varias wallets crypto), la key privada queda extraíble. RSA con PKCS#1 v1.5 es determinístico y elimina esa clase entera de vulnerabilidades. El trade-off (firmas de 512 bytes vs ~71 bytes para P-256) es aceptable: un PDF de 200KB con 512 bytes extras es un overhead irrelevante.

### D. Ed25519

- **Por qué se rechazó**: Ed25519 es excelente criptografía pero la interoperabilidad con Adobe PDF es **limitada**. El estándar PAdES (ETSI EN 319 142) no incluye Ed25519 en su lista de algoritmos obligatorios para validadores. Adobe Reader no valida Ed25519 nativamente. Mismo razonamiento que (A): la interoperabilidad gana sobre la elegancia.

### E. Self-signed cert + key local en archivo

- **Por qué se rechazó**: requiere proteger el material privado en algún lado (KMS, HSM, archivo cifrado). KMS es la opción de menor fricción operativa con audit log nativo (`cloudkms.googleapis.com/cryptokey.use`) y rotación gestionada por Google.

## Consecuencias

### Positivas

- **Verificación universal**: cualquier auditor con OpenSSL CLI puede correr `openssl dgst -sha256 -verify pubkey.pem -signature sig.bin payload.bin` sin parámetros extras. Adobe Reader valida la firma del PDF embebido sin warning de "algoritmo no soportado".
- **Audit trail nativo**: cada llamada a `asymmetricSign` queda en Cloud Audit Logs con timestamp + caller SA + key version. Reconstruible per-certificado.
- **Rotation friendly**: KMS soporta rotación de versiones manteniendo las viejas como `state=ENABLED` para verificar firmas pasadas. La función `resolverVersionPrimaria` (`firmar-kms.ts:133`) usa la última `ENABLED` para nuevas firmas; las anteriores siguen disponibles para `getPublicKey` con la versión específica.
- **Performance aceptable**: KMS asymmetric sign tarda ~50ms por firma RSA 4096. Para emitir certificados al final de un viaje (no path crítico de UX), es invisible.
- **Determinismo**: dos firmas del mismo bytes-input dan exactamente la misma firma — útil para tests E2E que comparan output, y para auditores que reverifican semanas después.

### Negativas

- **Tamaño de firma**: 512 bytes vs 71 bytes (ECDSA P-256). Trivial en un PDF.
- **PKCS#1 v1.5 es "viejo"**: no es la moda criptográfica actual. Algunos auditores ESG sofisticados pueden objetar "¿por qué no PSS?". Se responde con este ADR — la decisión es deliberada por interop.
- **CRC32C del transporte**: KMS retorna CRC32C del digest enviado. La librería valida (`firmar-kms.ts:78-80`) — sin esto, un bit-flip en red produciría un PDF "firmado" pero inválido al verificar. Costo: 1 línea de código defensivo.

### Riesgos abiertos

- **Quantum-resistant**: RSA 4096 cae con Shor's algorithm cuando exista una computadora cuántica con miles de qubits lógicos. Estimaciones actuales: 10-20 años. Si el horizonte de auditoría se extiende (ej. carbon credits con vida 30 años), evaluar migrar a NIST PQC (Dilithium / Falcon) cuando estén estandarizados en KMS. Tarea de revisión: 2030.
- **PDF/A-3 compliance**: certificados archivables a largo plazo requieren PDF/A. La firma PAdES sobre PDF/A-3 es soportada por la stack actual (`packages/certificate-generator/src/firmar-pades.ts` + `@signpdf/signpdf`). Verificar en E2E al menos una vez que un PDF emitido pasa `verapdf` validation.

## Implementación (estado actual)

| # | Ítem | Archivo | Estado |
|---|------|---------|--------|
| 1 | KMS keyring + key | `infrastructure/security.tf:9-81` | ✅ aplicado |
| 2 | IAM bindings (signerVerifier + publicKeyViewer) sobre la key específica | `infrastructure/security.tf:87-100` | ✅ aplicado |
| 3 | Env var `CERTIFICATE_SIGNING_KEY_ID` en Cloud Run api | `infrastructure/compute.tf:111` | ✅ aplicado |
| 4 | Wrapper de KMS sign con CRC32C check + version resolution | `packages/certificate-generator/src/firmar-kms.ts` | ✅ commiteado |
| 5 | Endpoint público `GET /certificates/:tracking_code/verify` | `apps/api/src/server.ts:251-262` | ✅ commiteado |
| 6 | Service `emitirCertificadoViaje` (idempotente) | `apps/api/src/services/emitir-certificado-viaje.ts` | ✅ commiteado |
| 7 | Job de backfill para certificados históricos | `apps/api/src/jobs/backfill-certificados.ts` | ✅ commiteado |
| 8 | **Drift documental — alinear comentario `firmar-kms.ts:24`** ("RSA-PSS" → "PKCS#1 v1.5") | `packages/certificate-generator/src/firmar-kms.ts` | ⏳ follow-up |
| 9 | Validar PDF/A-3 + PAdES con `verapdf` en CI | tooling | 📅 backlog |

## Referencias

- `infrastructure/security.tf:49-67` — comentario inline que motiva la decisión
- `packages/certificate-generator/src/firmar-kms.ts` — implementación
- `packages/certificate-generator/src/firmar-pades.ts` — capa PAdES sobre la firma KMS
- `packages/certificate-generator/src/ca-self-signed.ts` — generación del cert X.509 con la public key KMS
- NIST SP 800-131A — [Transitioning Cryptographic Algorithms and Key Lengths](https://csrc.nist.gov/publications/detail/sp/800-131a/rev-2/final)
- RFC 8017 — [PKCS #1 v2.2 (RSA Cryptography Specifications)](https://datatracker.ietf.org/doc/html/rfc8017)
- ETSI EN 319 142 — [PAdES baseline profile](https://www.etsi.org/deliver/etsi_en/319100_319199/319142/)
- GLEC Framework v3.0 — métodos de cálculo emisiones logísticas
