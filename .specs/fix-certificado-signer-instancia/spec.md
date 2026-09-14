# Firma PAdES: `Signer implementation expected` (bug latente desde el primer certificado)

**Estado**: aceptada · **Fecha**: 2026-09-14 · **Slot**: 1 «Huella punta a punta», criterio de término (certificado emitido) · **Origen**: emisión manual del certificado de BOO-BKAXIK tras corregir IAM (#684).

## 1. El problema

Con el permiso de KMS ya resuelto, `emitirCertificadoViaje` falló en la firma:
`SignPdfError: Signer implementation expected.` `firmar-pades.ts` entrega a
`@signpdf/signpdf` un objeto plano `{ sign() }`; la versión instalada (3.3.0, en el
lockfile desde que se creó el paquete) exige `signer instanceof Signer`
(`@signpdf/utils`). `firmar-pades.test.ts` simula `@signpdf/signpdf` por completo, así
que el rojo nunca apareció. Producción nunca había llegado a este paso (IAM fallaba antes).

## 2. Cambio

- `firmar-pades.ts`: el signer pasa a ser una clase `KmsPadesSigner extends Signer`
  (`@signpdf/utils`, ya dependencia directa) con el mismo `sign(pdfToSign)`.
- Test nuevo `firmar-pades.signpdf-real.test.ts`: `@signpdf/signpdf` REAL sobre un PDF
  real con placeholder (`generarPdfBase`), solo KMS mockeado. Reproduce el error de prod
  en rojo y queda como guardia contra el mock.

## 3. Criterios de salida

- [x] Rojo exhibido con la librería real (`Error: Signer implementation expected.`); verde tras el cambio (11 archivos / 102 tests del paquete).
- [ ] Suite de `packages/certificate-generator` + `apps/api`, typecheck, biome.
- [ ] En prod (tras deploy o vía el script manual): `certificado_emitido_en` de BOO-BKAXIK
      poblado, PDF en el bucket, `GET /certificates/BOO-BKAXIK/verify` 200.
