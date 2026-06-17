# Plan: fix-firma-kms-crc32c

- Spec: .specs/fix-firma-kms-crc32c/spec.md
- Created: 2026-06-10
- Status: Active

## Tasks

### T1: Util crc32c + tests (RED→GREEN)
- Files: packages/certificate-generator/src/crc32c.ts, packages/certificate-generator/src/crc32c.test.ts
- LOC estimate: ~55
- Depends on: none
- Acceptance: spec §10 T1 verde.
- Rollback: borrar archivos nuevos.

### T2: firmarConKms envía digestCrc32c y valida respuesta (3 checks) + tests actualizados
- Files: packages/certificate-generator/src/firmar-kms.ts, packages/certificate-generator/src/firmar-kms.test.ts
- LOC estimate: ~60
- Depends on: T1
- Acceptance: spec §10 T2–T6 verdes; suite del package completa verde.
- Rollback: revert del commit.

## Out-of-band tasks

- Post-merge: correr backfill-certificados y verificación OpenSSL contra KMS real (§11).
