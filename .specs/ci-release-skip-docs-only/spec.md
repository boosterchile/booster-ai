# Spec — `release.yml` no dispara en pushes docs-only

**Feature slug**: `ci-release-skip-docs-only`
**Estado**: Draft
**Fecha**: 2026-06-06
**Autor**: Claude (agente) + Felipe Vicencio (PO)
**Tipo**: cambio de CI/CD (archivo sensible `.github/workflows/release.yml` — requiere justificación per CLAUDE.md §"Qué archivos NUNCA toco sin permiso explícito")

---

## 1. Objetivo

Evitar que un push a `main` que **solo** toca documentación dispare el workflow `Release + Deploy` (`release.yml`), que ejecuta el deploy de producción a GCP.

## 2. Por qué ahora

`release.yml` corre en **todo** push a `main` (`on.push.branches: [main]`, sin filtro de paths). El merge de PRs docs-only — por ejemplo el handoff `docs/handoff/CURRENT.md` (#414) o el análisis de drift (#410/#411) — dispara un run de release/deploy que:

- Es un **no-op**: no hay imagen nueva ni código; el deploy redeploya la misma imagen.
- Frecuentemente queda **`pending` con 0 jobs** por cola de runners / incidentes de GitHub Actions (observado empíricamente en runs `27073359900` del #413 y `27075451377` del #414, ambos docs-only).
- Ensucia la **lane de concurrency** (`concurrency.cancel-in-progress: false` → los runs se encolan): un run docs-only colgado puede bloquear el siguiente deploy **real**.
- No es accionable por el agente (cancelar da HTTP 403; requiere intervención humana en la UI).

Evidencia de frecuencia: de los últimos 5 runs de `release.yml` (2026-06-06), **4 fueron de commits docs-only o infra-doc** (`docs(...)`, `ci(infra)`), todos no-op respecto al binario desplegado.

## 3. Criterios de éxito

- **SC-1**: Un push a `main` cuyo diff toca **exclusivamente** rutas de documentación NO dispara `release.yml` (0 runs creados).
- **SC-2**: Un push a `main` que toca **cualquier** archivo fuera de las rutas de documentación SÍ dispara `release.yml` (comportamiento actual preservado).
- **SC-3**: Un push que toca un archivo de Changesets (`.changeset/*.md`) SÍ dispara `release.yml`, aunque sea `.md` y aunque venga junto a docs (el release de versiones no se rompe).
- **SC-4**: El cambio no altera ningún **required status check** de la branch protection de `main` (`release.yml` no es required; los gates de merge — `CI Success` de `ci.yml` — quedan intactos).

## 4. Comportamiento visible

Cambio en `release.yml`:

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - 'docs/**'
      - '.specs/**'
      - 'references/**'
      - 'playbooks/**'
      - '*.md'            # markdown de root (README, CLAUDE, AGENTS) — un solo '*' NO matchea .changeset/*.md
```

Semántica de GitHub Actions: el workflow se **omite** únicamente si **todos** los archivos del push matchean algún patrón de `paths-ignore`. Si **cualquier** archivo queda fuera (código, infra, `.changeset/**`, `package.json`, lockfiles…), el workflow corre normal.

## 5. Boundaries técnicos

- Se usa `paths-ignore` (denylist), **no** `paths` (allowlist). Razón: una allowlist obligaría a enumerar **todo** lo deployable (apps/**, packages/**, infrastructure/**, cloudbuild*.yaml, Dockerfiles, lockfiles…) y un olvido produciría el fallo peligroso (deploy real omitido). La denylist falla del lado seguro: lo no enumerado **siempre** despliega.

### 5.1 Alternativa considerada: filtro job-level (`if:` + changed-files)

`paths-ignore` opera a **nivel `on.push`** (mata el workflow completo para pushes docs-only, incluido el job `version-or-publish` de Changesets). La alternativa real **no** es "paths-ignore a nivel job" (no existe), sino un condicional `if:` sobre el job `deploy-production`, alimentado por una action de detección de cambios (`dorny/paths-filter`). Esa opción **preservaría** dos cosas que `paths-ignore` sacrifica:

- (a) el run **sigue apareciendo** en Actions aun para docs-only → traza "cada merge a main tiene un run de release" (relevante para compliance TRL 10);
- (b) `version-or-publish` (Changesets) **corre incondicionalmente**.

**Por qué se elige igual el `paths-ignore` workflow-level:**

1. **Cero dependencias de terceros.** El job-level requiere una action externa de detección de cambios → superficie supply-chain adicional en el camino de deploy de producción (no aceptable sin ADR; `tj-actions/changed-files` sufrió un compromiso de supply-chain en 2025). `paths-ignore` es sintaxis nativa de GitHub.
2. **Simplicidad y reversibilidad.** 6 líneas declarativas vs. un job condicional + checkout + step de detección.
3. **La traza no se pierde de verdad.** "Cada merge a main" queda en `git log main` y en el PR mismo; el run de release no es la única fuente. El heartbeat de prod (smoke test) se obtiene del deploy check programado/cron, no de re-desplegar imágenes idénticas.
4. **El job Changesets para docs-only es no-op por diseño esperado** (un cambio docs no genera `.changeset/*.md`); no perder ese run no tiene costo operativo.

Trade-off aceptado por el PO en este spec: ver §7 riesgos residuales. Si el PO prioriza la traza de compliance sobre la simplicidad, el enfoque job-level queda documentado acá como pivote disponible (requeriría su propio ADR por la dependencia de terceros).

## 6. Fuera de alcance

- Cambiar `concurrency` o la política `cancel-in-progress` de `release.yml`.
- Filtrar `ci.yml`, `security.yml` u otros workflows (este spec es solo `release.yml`).
- Tocar el gate de aprobación del Environment `production`.
- Resolver el run `27075451377` ya colgado (decisión humana, fuera de este cambio).

## 7. Riesgos y mitigaciones

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | Un glob `**/*.md` ingenuo ignoraría `.changeset/*.md` → un release de versiones legítimo no correría | **Alto** | **NO se usa `**/*.md`.** Se enumeran directorios de docs + `*.md` (un solo `*`, solo root). `.changeset/` nunca está en la lista → SC-3. |
| R2 | Un futuro archivo deployable cae bajo una ruta ignorada (p.ej. un `.md` en root que el build consume) | Bajo | Denylist conservadora; ningún paso de build consume `docs/**`, `.specs/**`, `references/**`, `playbooks/**` ni markdown de root. Si algo cambia, el default (no listado) despliega. |
| R3 | Un PR mezcla docs + código pero el merge squash "parece" docs | **Bajo (asume squash-PR)** | GitHub evalúa **todos** los archivos del push; basta un archivo de código para disparar. Squash merge = 1 commit con el diff completo. **Caveat (DA P2-3)**: el `git log` de main muestra **commits directos sin PR** (p.ej. `b6132d4 chore(ci): bump release NODE_VERSION`). Un push directo docs-only a main tampoco generará run — esperado, pero no es "nulo": depende de la disciplina squash-PR. |
| R4 | Alguien asume que docs-only "se desplegó" | Bajo | Es exactamente lo deseado: docs no se despliegan. Documentado en comentario inline del workflow. |
| R5 | Pérdida de traza "cada merge a main → run de release" (compliance TRL 10) | **Residual aceptado** | La traza vive en `git log main` + el PR. Si el PO la requiere como run de Actions, pivotar al enfoque job-level (§5.1, requiere ADR). |
| R6 | Pérdida del "heartbeat" accidental de prod (los merges docs-only hoy reejecutan canary + smoke test) | **Residual aceptado** | El smoke/health de prod debe venir de un check programado, no de re-desplegar imágenes idénticas. Fuera de alcance de este spec. |

## 8. Lista de tests / verificación

No hay test unitario para YAML de workflow. Verificación:

- **V1 (sintaxis)**: el YAML parsea sin error (`python3 -c yaml.safe_load` o `actionlint` si está disponible).
- **V2 (SC-3 razonado)**: confirmar que `.changeset/` no matchea ninguno de los patrones (`*.md` es root-only; los demás son directorios `docs/.specs/references/playbooks`).
- **V3 (SC-1/SC-2 razonado)**: matriz de casos documentada en `verify.md` (docs-only → skip; código → run; mixto → run; changeset → run).
- **V4 (post-merge, observacional)**: el primer PR docs-only tras el merge de este cambio NO crea un run de `release.yml`. El primer PR con código SÍ. (Se observa, no se ejecuta acá.)

## 9. Decisiones abiertas

Ninguna bloqueante. Lista de rutas en §4 propuesta como conservadora; el PO puede ampliar/reducir en review.
