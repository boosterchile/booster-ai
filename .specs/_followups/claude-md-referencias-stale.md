# Follow-up: referencias stale en CLAUDE.md (requiere aprobación del PO)

**Origen**: review devils-advocate ola 2 (2026-06-11). CLAUDE.md es archivo crítico — NO se toca sin aprobación explícita; este stub agenda la corrección.

## Referencias a corregir cuando el PO apruebe

1. §Deploy: "El `cloudbuild.staging.yaml` está inactivo" — el archivo se ELIMINÓ en chore/ci-tooling-higiene; la frase debe decir que ya no existe (backlog #STAGING-ENV sigue vigente).
2. §Estructura: el conteo "~21 packages" quedó corto tras `otel-bootstrap` (feat/otel-bootstrap).
3. Residual re-firmado pendiente: e2e nightly pega a PRODUCCIÓN (e2e-staging.yml) — deliberado mientras no exista staging; el PO debe re-firmarlo o priorizar #STAGING-ENV.

## Item técnico relacionado (sin tocar CLAUDE.md)

- Convergencia `booleanFlag`: `apps/api/src/config.ts` mantiene una copia local idéntica a `@booster-ai/config`. Migrar el api al import del package y borrar la copia (mecánico; tests de config del api deben seguir verdes). Nota del review: evaluar si "valor no reconocido → default silencioso" debería ser fail-closed (error Zod al startup) — decisión de contrato, requiere spec corta.

## Estado

- **Puntos 1-3 RESUELTOS 2026-06-14** (PR `docs/followups-stale-refs-y-retention-gate`, aprobación PO explícita en sesión): §Deploy corregida (cloudbuild.staging.yaml eliminado en #445; e2e nightly pega a PRODUCCIÓN documentado); §Estructura packages 21 exacto + lista al día; comentario de `e2e-staging.yml` corregido. **Sub-decisión abierta del punto 3**: la re-firma del PO de "e2e nightly contra producción" vs priorizar `#STAGING-ENV` sigue siendo decisión del PO (ahora documentada en CLAUDE.md, no resuelta).
- **Ítem técnico (`booleanFlag` en `apps/api/src/config.ts`)**: PENDIENTE — ejecutable en cualquier ciclo (sin tocar CLAUDE.md). Incluye la decisión de contrato fail-closed (error Zod al startup) vs default silencioso.
