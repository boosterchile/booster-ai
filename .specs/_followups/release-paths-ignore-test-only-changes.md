# Follow-up: release.yml no debe desplegar en cambios test-only

**Origen**: sesión 2026-06-07 (incidente Redis TLS). El merge de #422 (un único spec
e2e bajo `apps/web/e2e/`) disparó un deploy de producción no-op (run `27103863227`,
quedó `waiting` en el gate → hubo que rechazarlo para no wedgear la lane).
**Prioridad**: P2 (higiene de pipeline; recurrente — 2ª vez en la sesión que un cambio
no-desplegable encola la lane de release).

## Problema

El `paths-ignore` de `release.yml` (introducido en #415, denylist falla-seguro) solo
excluye: `docs/**`, `.specs/**`, `references/**`, `playbooks/**`, `*.md`. Cualquier otra
ruta despliega — incluido **código de test que no va en ningún bundle**:
`apps/**/e2e/**`, `**/*.spec.ts`, `**/*.test.ts`.

Consecuencia: un push test-only dispara `release.yml` → `version-or-publish` →
`deploy-production` queda `waiting` en el gate. Como `concurrency` usa
`cancel-in-progress: false`, un run colgado en su gate **retiene el lock** y bloquea el
próximo deploy real (ver el episodio del run #438 esta misma sesión).

## Acción propuesta

Agregar al `paths-ignore` de `release.yml` los paths de test-only:

```yaml
paths-ignore:
  - 'docs/**'
  - '.specs/**'
  - 'references/**'
  - 'playbooks/**'
  - '*.md'
  - '**/*.test.ts'      # unit tests al lado del código
  - '**/*.test.tsx'
  - 'apps/**/e2e/**'     # specs Playwright e2e
```

## Cuidados (heredados de #415)

- **`paths-ignore` skipea solo si TODOS los archivos del push matchean** algún glob. Un
  commit que mezcla código productivo + tests **igual despliega** (correcto: hay código).
  Solo se saltea cuando el push es 100% test/docs.
- **NO usar `**/*.spec.ts` de forma que matchee cosas no-test** ni patrones que crucen a
  archivos productivos. Validar que no haya specs fuera de e2e que sí deban gatear algo.
- Verificar que ningún archivo de test sea consumido por el build de runtime (no debería).
- Tocar `release.yml` es un quality gate (CLAUDE.md §"archivos que NUNCA toco sin
  permiso"): requiere justificación y ciclo DEFINE→SHIP como #415.
- Validar end-to-end igual que #415: SC-1 (push test-only → 0 runs de release), SC-2
  (push con código → sí dispara).

## Estado
✅ **RESUELTO (2026-06-22)**. Agregados `**/*.test.ts`, `**/*.test.tsx`, `apps/**/e2e/**`
al `paths-ignore` de `release.yml`. Verificado que NO hay `.spec.ts` fuera de `e2e/`
(grep), así que `apps/**/e2e/**` cubre los Playwright sin tocar productivo; los tests
no se consumen en ningún bundle de runtime. YAML válido (parse OK, jobs intactos).
**Validación end-to-end igual que #415 (post-merge)**: SC-1 (push test-only → 0 runs)
+ SC-2 (push con código → dispara). Relacionado: [[ci-release-paths-ignore-2026-06]].
