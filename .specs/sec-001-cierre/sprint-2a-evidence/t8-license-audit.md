# T8 SEC-001 — License audit @testcontainers/redis

- **Sprint**: 2a
- **Plan**: `.specs/sec-001-cierre/plan-sprint-2a.md` §T8 acceptance ("License verification `@testcontainers/redis` MIT/Apache + capturado en `sprint-2a-evidence/t8-license-audit.md`").
- **Auditado por**: dev@boosterchile.com con apoyo Claude
- **Fecha**: 2026-05-25
- **Justificación**: Sprint 2a T8 requiere validar que devDep instalado para integration test Redis fail-closed no introduce dependencias con licencias restrictivas (GPL, AGPL, Server Side, etc.) que pudieran contaminar el monorepo aun siendo devDep.

## Direct dependency

| Package | Version | License | Source |
|---|---|---|---|
| `@testcontainers/redis` | 12.0.0 | **MIT** | `npm view @testcontainers/redis license` |

## Top-level transitive (added via @testcontainers/redis)

| Package | Version | License | Notes |
|---|---|---|---|
| `testcontainers` | 12.0.0 | **MIT** | Parent runtime — module wrappers como `@testcontainers/redis` lo declaran dependency |
| `dockerode` | 5.0.0 | **Apache-2.0** | Docker daemon client; usado por testcontainers para start/stop containers |

## Resultado

✅ Sólo MIT + Apache-2.0 en las top-level transitive deps añadidas. Compatibles con el repo Booster AI (proprietary).

✅ Sin GPL, LGPL, AGPL, SSPL, BSL ni licencias copyleft en la nueva surface.

✅ Cero deps `peer` requiriendo runtime config crítica.

## Comandos para reproducir

```bash
npm view @testcontainers/redis license version
npm view testcontainers license version
npm view dockerode license version
```

## Justificación de la elección de wrapper

`@testcontainers/redis` ergonomic wrapper (`RedisContainer`) vs `testcontainers` (`GenericContainer`) puro:

- **Pro wrapper**: Tipo `StartedRedisContainer` con `getConnectionUrl()` listo; menos boilerplate; plan §T8 lo nombra explícitamente.
- **Contra wrapper**: Una capa más a auditar; +1 transitive dep semánticamente (aunque misma autoría: testcontainers-org).

Decisión: usar wrapper. La capa extra es trivial (~20 LOC en su source) y mantenida por el mismo grupo que mantiene `testcontainers`.

## Follow-up

- **Sprint 2b / post**: Si surgen más usos de testcontainers (DB Postgres, Pub/Sub emulador), considerar consolidar en helper `packages/test-helpers/`. Tracked como [`_followups/sprint-2b-testcontainers-helpers.md`](../../_followups/sprint-2b-testcontainers-helpers.md) si materializa.

## Referencias

- `apps/api/test/integration/redis-fail-closed-real.integration.test.ts` — único consumidor actual.
- `apps/api/package.json` — devDep entry.
- Plan: [`.specs/sec-001-cierre/plan-sprint-2a.md`](../../plan-sprint-2a.md) §T8.
- SC trace: spec.md §3 SC-1.1.2c "real Redis fail-closed" + SC-H2.1b.
