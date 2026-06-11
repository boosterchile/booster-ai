# Follow-up: referencias stale en CLAUDE.md (requiere aprobación del PO)

**Origen**: review devils-advocate ola 2 (2026-06-11). CLAUDE.md es archivo crítico — NO se toca sin aprobación explícita; este stub agenda la corrección.

## Referencias a corregir cuando el PO apruebe

1. §Deploy: "El `cloudbuild.staging.yaml` está inactivo" — el archivo se ELIMINÓ en chore/ci-tooling-higiene; la frase debe decir que ya no existe (backlog #STAGING-ENV sigue vigente).
2. §Estructura: el conteo "~21 packages" quedó corto tras `otel-bootstrap` (feat/otel-bootstrap).
3. Residual re-firmado pendiente: e2e nightly pega a PRODUCCIÓN (e2e-staging.yml) — deliberado mientras no exista staging; el PO debe re-firmarlo o priorizar #STAGING-ENV.

## Item técnico relacionado (sin tocar CLAUDE.md)

- Convergencia `booleanFlag`: `apps/api/src/config.ts` mantiene una copia local idéntica a `@booster-ai/config`. Migrar el api al import del package y borrar la copia (mecánico; tests de config del api deben seguir verdes). Nota del review: evaluar si "valor no reconocido → default silencioso" debería ser fail-closed (error Zod al startup) — decisión de contrato, requiere spec corta.

## Estado

Pendiente de aprobación del PO para los puntos 1-3; el punto técnico es ejecutable en cualquier ciclo.
