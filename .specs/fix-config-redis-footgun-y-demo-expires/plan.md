# Plan: fix-config-redis-footgun-y-demo-expires

- Spec: .specs/fix-config-redis-footgun-y-demo-expires/spec.md
- Created: 2026-06-11
- Status: Complete

## Tasks

### T1: booleanFlag compartido + redis schema + tests [DONE 2026-06-11]
- Files: packages/config/src/booleanFlag.ts (+test), schemas/redis.ts (+test), index.ts
- Acceptance: spec §10 T1–T2.

### T2: skipPublicVerify helper + demoExpires en /certificates + tests [DONE 2026-06-11]
- Files: apps/api/src/middleware/skip-public-verify.ts (+test), apps/api/src/server.ts
- Acceptance: spec §10 T3–T4 (vía helper testeado + gates check-route-default-deny/wire-completeness OK).
