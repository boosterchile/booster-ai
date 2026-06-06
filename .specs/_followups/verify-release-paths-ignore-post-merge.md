# Follow-up — Verificar `release.yml paths-ignore` post-merge (V4)

**Origen**: `.specs/ci-release-skip-docs-only/` (DA P2-4)
**Prioridad**: P2 (verificación observacional, no bloqueante)
**Owner**: PO (Felipe)
**Creado**: 2026-06-06

## Qué verificar

Tras mergear el cambio de `paths-ignore` en `release.yml` (PR de la rama `ci/release-skip-docs-only`), confirmar empíricamente en GitHub Actions:

1. **SC-1**: el **primer PR docs-only** mergeado a `main` después de este cambio **NO** crea un run de `Release + Deploy`. (Candidato natural: el próximo `docs(handoff): CURRENT.md ...`.)
2. **SC-2**: el **primer PR con código** mergeado después **SÍ** crea el run y despliega normal.

## Cómo

```bash
# tras un merge docs-only:
gh run list --workflow=release.yml --limit 3 --json headSha,event,createdAt,displayTitle
# esperado: NO aparece un run nuevo para el commit docs-only
```

## Condición de cierre

Ambas observaciones confirmadas (1 docs-only sin run + 1 con-código con run). Anotar en este archivo y cerrar.

## Disparador de escalación

Si un PR **con código** NO dispara release (SC-2 roto) → P0: revertir el `paths-ignore` de inmediato (`git revert`), un deploy real se estaría omitiendo silenciosamente.
