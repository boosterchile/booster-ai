# Spec: fix-firma-kms-crc32c

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-10
- Status: Approved
- Linked: Auditoría arquitectónica 2026-06-09, riesgo alto #1 (verificado independientemente)

## 1. Objective

Corregir la integración con Cloud KMS en `packages/certificate-generator/src/firmar-kms.ts` para que la firma de certificados de carbono funcione contra KMS real: hoy el request a `asymmetricSign` no envía `digestCrc32c`, pero el código lanza error cuando `response.verifiedDigestCrc32c === false` — que es exactamente lo que KMS responde cuando el request no incluyó el CRC. Resultado probable: **toda firma real lanza error**, y como la emisión es fire-and-forget, falla en silencio.

## 2. Why now

Los certificados de huella de carbono son el diferenciador comercial de Booster (GLEC v3.0, ADR-015/021). La auditoría 2026-06-09 verificó que los tests pasan solo porque mockean `verifiedDigestCrc32c: true`. Cada viaje entregado en prod probablemente está fallando la emisión sin alerta.

## 3. Success criteria

- [ ] El request a `asymmetricSign` incluye `digestCrc32c` con el CRC32C (Castagnoli) correcto del digest SHA-256.
- [ ] La respuesta se valida en 3 puntos según la doc de KMS: `verifiedDigestCrc32c === true`, `name === version solicitada`, y `signatureCrc32c` coincide con el CRC32C calculado localmente sobre la firma recibida.
- [ ] Util `crc32c()` pura (cero deps nuevas) validada contra vector conocido (`crc32c("123456789") === 0xE3069283`).
- [ ] Tests existentes actualizados al nuevo contrato; cobertura del package se mantiene ≥80%.

## 4. User-visible behaviour

Ninguna UI cambia. Los certificados de carbono vuelven a emitirse (o se emiten por primera vez de forma confiable) al pasar un viaje a `entregado`. El endpoint público `/certificates/:tracking/verify` sirve firmas válidas.

## 5. Out of scope

- Corrección del drift documental PSS vs PKCS#1 v1.5 más allá de los comentarios del propio archivo tocado.
- Mecanismo de re-emisión vs retention policy del bucket (cubierto en `.specs/sec-h3-dte-retention-lock`).
- Backfill de certificados fallidos (existe `jobs/backfill-certificados.ts`; se corre post-deploy).

## 6. Constraints

1. Cero dependencias nuevas (regla del package: deps mínimas; CRC32C son ~25 líneas).
2. `digestCrc32c` viaja como Int64Value wrapper `{ value: string }` per protobuf JSON mapping del SDK.
3. Compatibilidad con el mock-shape de los tests existentes (clase mockeada de `@google-cloud/kms`).

## 7. Approach

Nuevo `src/crc32c.ts` con CRC32C Castagnoli table-based (unsigned 32-bit). En `firmarConKms`: calcular `crc32c(digest)`, enviarlo en el request; al recibir, validar `verifiedDigestCrc32c === true` (ahora correcto porque SÍ enviamos el CRC), validar `response.name` y comparar `crc32c(signature)` contra `Number(response.signatureCrc32c.value)`. Corregir comentarios PSS→PKCS#1 v1.5 (drift ya reconocido por ADR-015).

## 8. Alternatives considered

- **A. Dependencia `fast-crc32c`/`crc32c` de npm** — Rechazada: agregar una dep nativa/JS por 25 líneas de tabla CRC; el package es deliberadamente liviano y la regla del repo exige justificar deps nuevas.
- **B. Eliminar el check `verifiedDigestCrc32c`** — Rechazada: "arregla" el síntoma perdiendo la verificación de integridad end-to-end que el comentario original quería; un bit-flip produciría un PDF firmado-inválido.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CRC32C mal implementado rompe TODA firma | L | H | Vectores de test conocidos (RFC 3720); test del valor exacto enviado en el request |
| El SDK espera number en vez de Int64Value | L | M | `{ value: String(n) }` es el mapping documentado de protobufjs; test del shape |
| KMS real difiere del mock (no verificable sin GCP) | M | M | Validación manual post-merge: emitir certificado en prod y verificar con OpenSSL (paso del runbook en §11) |

## 10. Test list

- T1: `crc32c()` retorna 0xE3069283 para "123456789" y valores correctos para vectores adicionales (vacío, 32 bytes).
- T2: `firmarConKms` envía `digestCrc32c.value` igual al CRC32C del digest sha256.
- T3: throw si `verifiedDigestCrc32c` es `false` o `undefined` (server no confirmó integridad).
- T4: throw si `signatureCrc32c` de la respuesta no coincide con el CRC local de la firma.
- T5: throw si `response.name` difiere de la versión solicitada.
- T6: happy path completo con mocks consistentes (firma, versión, CRCs).

## 11. Rollout

- Feature-flagged? No — es corrección de integración; el comportamiento correcto es el especificado.
- Migration needed? No.
- Rollback plan: revert del commit; la emisión vuelve al estado actual (fallo silencioso), no peor.
- Monitoring: post-deploy, confirmar log `certificado emitido` en el siguiente viaje entregado (o correr `jobs/backfill-certificados.ts`) y verificar el PDF con el hint OpenSSL del endpoint `/verify`.

## 12. Open questions

None as of 2026-06-10 (la verificación contra KMS real queda como paso manual post-deploy documentado en §11).

## 13. Decision log

- 2026-06-10 — Draft + aprobación del PO vía instrucción "ejecutar lo propuesto en el punto 6" (registrada en ledger).
