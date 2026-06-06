# Verify — `ci-release-skip-docs-only`

**Fecha**: 2026-06-06

## V1 — YAML válido

`js-yaml@4.1.1` strict load de `.github/workflows/release.yml`:
- `on.push.branches = ["main"]`
- `on.push.paths-ignore = ["docs/**", ".specs/**", "references/**", "playbooks/**", "*.md"]`
- `jobs = version-or-publish, deploy-production` (intactos)
- ✓ parsea sin error.

## V2 + V3 — Matriz de matching (SC-1/2/3)

Simulación de la semántica GitHub (`**` cruza `/`, `*` no cruza `/`; el push se omite solo si **todos** los archivos matchean):

| Archivo del push | Resultado | SC |
|---|---|---|
| `.changeset/cool-cats.md` | **DISPARA release** | SC-3 ✓ |
| `.changeset/config.json` | DISPARA release | SC-3 ✓ |
| `docs/handoff/CURRENT.md` | ignorado (`docs/**`) | SC-1 ✓ |
| `.specs/x/spec.md` | ignorado (`.specs/**`) | SC-1 ✓ |
| `README.md`, `CLAUDE.md` | ignorado (`*.md` root-only) | SC-1 ✓ |
| `apps/api/src/index.ts` | DISPARA release | SC-2 ✓ |
| `package.json`, `pnpm-lock.yaml` | DISPARA release | SC-2 ✓ |
| `infrastructure/iam.tf` | DISPARA release | SC-2 ✓ |
| **Changesets fase B** — merge del PR `chore(release): version packages` (toca `package.json` + `CHANGELOG.md`) | **DISPARA release** → `pnpm changeset publish` corre | SC-3 ✓ |

Clave (R1): `.changeset/*.md` **NO** matchea `*.md` (tiene un directorio) → el release de versiones se preserva.

**Changesets opera en dos fases (DA P1-2):**
- **Fase A** — un push con un `.changeset/*.md` nuevo → no ignorado → corre `version-or-publish` (crea/actualiza el PR "Version Packages").
- **Fase B** — el merge de ese PR `chore(release): version packages` toca `package.json` (+ `CHANGELOG.md`), **no** rutas ignoradas → dispara release → `pnpm changeset publish`. Es el camino real de publicación y queda cubierto. (`.changeset/config.json` tiene `"commit": false` → ese PR se mergea manual por squash, tocando `package.json`.)

## V4 — Observacional (post-merge)

Pendiente tras merge: el primer PR docs-only no debe crear run de `release.yml`; el primer PR con código sí. Se observa en Actions, no se ejecuta aquí.

## Veredicto

V1–V3 PASS. SC-1, SC-2, SC-3, SC-4 cubiertos por razonamiento + simulación. V4 queda como verificación observacional post-merge.
