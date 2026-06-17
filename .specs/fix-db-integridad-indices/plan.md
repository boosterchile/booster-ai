# Plan: fix-db-integridad-indices

- Spec: .specs/fix-db-integridad-indices/spec.md
- Created: 2026-06-11
- Status: Complete

### T1: Migración 0040 (FK + unique parcial + DROP índices) + journal [DONE 2026-06-11]
### T2: schema.ts alineado (references + decls de índices removidas + comentarios) [DONE 2026-06-11]

Verificación local: typecheck OK, suite unit api completa verde; T1/T2/T3/T4 de spec §10 se ejercitan en CI (integration con Postgres real — docker no disponible local).
