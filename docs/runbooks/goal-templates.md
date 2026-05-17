# `/goal` — Plantillas para Booster AI (v2)

**Fecha**: 2026-05-16
**Origen**: refinamiento de los 5 planes iniciales tras la sesión de ejecución real (`#166` + `#226` + `#227` mergeados con `/goal` + intervención).
**Audiencia**: Felipe Vicencio (solo dev), agentes Claude operando bajo `agent-rigor`.

`/goal` es ideal cuando la condición de cierre es **objetivamente verificable desde la transcripción** y el trabajo NO requiere decisiones de producto. Estas plantillas asumen que `.claude/settings.json` (local) ya tiene la allowlist amplia aplicada — sin eso, cada `/goal` se atasca en prompts de autorización.

---

## Preamble común — aplica a TODA invocación

Estos requisitos están implícitos en cada plantilla; cada `/goal` los incluye en su condición de cierre o los hereda del entorno.

### Sanity check zero — ANTES de cualquier acción (anti-Stop-hook-loop)

El Stop hook de `/goal` re-invoca al agente cada turno mientras la condición de cierre no se cumpla. Si la condición es **estructuralmente insatisfacible**, el agente entra en bucle infinito y la única salida es que el PO tipee `/goal clear`. Para evitarlo, el agente DEBE validar antes del pre-flight:

1. **Placeholders sin sustituir**: si el texto del goal contiene `<[A-Z]+>` (ej. `<PR>`, `<feature>`, `<from>`, `<to>`), reportar al chat *"Goal no satisfacible: placeholder `<X>` sin sustituir. Reformular con valor concreto."* y terminar SIN llamar hooks ni invocar el pre-flight ledger.
2. **Recursos requeridos ausentes**: si la condición depende de un recurso que no existe (ej. plantilla "cerrar PR" pero `gh pr list --state open --json number --jq length` retorna 0; plantilla BUILD pero `.specs/<feature>/plan.md` no existe), reportar y terminar.
3. **Cancelación explícita del PO**: si el PO ya respondió "cancelar" a una pregunta del agente, NO seguir re-evaluando — terminar y dejar mensaje *"Esperando /goal clear del PO."* una sola vez.

**Terse post-abort**: el harness de `/goal` no entiende "abort permanent" como estado terminal — sigue re-invocando al agente en cada Stop hook hasta que el PO tipee `/goal clear`. En esas re-invocaciones, el agente DEBE responder solo con `.` (un punto) sin re-explicar el abort. Razón: la primera declaración de abort ya contiene el diagnóstico completo; repetirlo en cada re-invocación desperdicia ~2k tokens por turno (observado: ~16k tokens en 8 re-invocaciones tras un abort, todos diciendo lo mismo). El PO ve el `.` en chat y sabe que está esperando su `/goal clear`.

Lección observada el 2026-05-16: un `/goal Cerrar PR #<PR>` (placeholder literal, 0 PRs abiertos) consumió 10+ turnos del Stop hook pidiendo `/goal clear` repetidamente antes de que el PO interviniera. Costo evitable. El sanity check zero previno todos los efectos secundarios (no ledger writes, no branches, no PRs falsos) pero el harness siguió bucleando — la regla "terse post-abort" reduce el costo de ese bucle de ~16k tokens a ~4k tokens.

### Pre-flight obligatorio (primer turno del agente, post-sanity check)

1. Leer `/Users/fvicencio/.claude/plugins/cache/agent-rigor/agent-rigor/0.2.0/CLAUDE.md` y escribir `skill_read` al ledger antes de cualquier `Write`/`Edit`. Sin esto, el primer `Write` se bloquea por `PreToolUse`.
2. Declarar `phase_enter` (con feature slug) **o** `skip-cycle` con justificación, también al ledger.
3. Verificar la premisa antes de actuar (lección hoy: el `/goal` inicial afirmó "colisión ADR-033 entre #164 y #166" sin abrir los archivos; era falso). Usar `gh pr view --json files` + leer el contenido real, no inferir de títulos/body.

### Patrones operativos canónicos

- **Esperar CI**: siempre `gh pr checks <n> --watch --interval 15`. No reinventar polling (mi `awk $2=="pending"` falló hoy con multi-word check names).
- **Merge**: nunca asumir `gh pr merge --auto` disponible (la repo lo deshabilitó mid-sesión hoy). Patrón seguro: `gh pr checks <n> --watch && gh pr merge <n> --squash --delete-branch`.
- **Push a feature branch**: `git push github <branch> --force-with-lease` (nunca `--force` directo, y nunca a `main`).
- **Commit messages**: subject ≤72 chars, body wrap a 95 chars, footer ≤100 chars (commitlint lo bloquea). Templates al final de cada plantilla.
- **Remote canónico**: siempre `github`, nunca `origin` (gitlab es mirror semi-roto).

### Abort triggers universales

El agente DEBE abortar `/goal` y reportar en chat si:

- Cualquier Edit que pida tocar `CLAUDE.md`, `docs/adr/**`, `infrastructure/**`, `.github/workflows/**` (denied por config — caída en bucle).
- Un test falla **2 reintentos consecutivos** sin diagnóstico nuevo entre intentos.
- Vocabulario drift (las palabras listadas en agent-rigor `CLAUDE.md` §4, e.g. <quote>MVP</quote>, <quote>for now</quote>, <quote>quick fix</quote>) aparece en código generado.
- La condición de cierre requiere una decisión de producto que solo el PO puede tomar (numeración ADR, breaking change, schema BD).
- Placeholder literal sin sustituir en el goal (`<PR>`, `<feature>`, `<from>`, `<to>`) — ver "Sanity check zero" arriba.
- Recurso requerido ausente (PR inexistente, `plan.md` inexistente, branch inexistente) — ver "Sanity check zero" arriba.

---

## Plan 1 — Sincronizar `docs/handoff/CURRENT.md`

**Cuándo usar**: tras cualquier merge significativo (PR mayor, deploy, blocker resuelto/nuevo). CURRENT.md es documento vivo — se actualiza, no se reemplaza.

**Pre-conditions**:
- Worktree limpio (`git status` sin cambios uncommitted).
- Estás en un branch tracking `github/main` o vas a crear uno nuevo.

**`/goal`**:

```
Actualizar docs/handoff/CURRENT.md para reflejar el estado real de main hoy.

Pre-flight: leer /Users/fvicencio/.claude/plugins/cache/agent-rigor/agent-rigor/0.2.0/CLAUDE.md y escribir skill_read al ledger. Declarar skip-cycle (snapshot documental sin código de producción).

Steps:
1. `git fetch github main` y crear branch `chore/current-md-update-YYYY-MM-DD` desde github/main.
2. Verificar contenido REAL (no inferir): `gh pr list --state merged --limit 20 --json number,title,mergedAt,mergeCommit`, `gh pr list --state open --json number,title,headRefName`. Para cada PR abierto, `gh pr view <n> --json files,statusCheckRollup` y leer al menos un archivo si menciona ADRs/migrations.
3. Editar CURRENT.md con: (a) waves recién mergeadas con commit SHA, (b) tabla de PRs abiertos con CI status real, (c) blockers vigentes verificados (no copiar del anterior CURRENT.md sin re-confirmar).
4. Commit con subject ≤72 chars, body wrap a 95 chars. Push a github.
5. `gh pr create --base main` con body que incluya test plan ejecutado.
6. `gh pr checks <n> --watch --interval 15` (NO polling custom).
7. `gh pr merge <n> --squash --delete-branch` cuando watch retorne exit 0.

Condición de cierre: pegar en chat (a) URL del PR mergeado, (b) commit SHA en main vía `git fetch github main && git log github/main -1 --oneline`, (c) `gh pr list --state open` confirmando que CURRENT.md NO se autoreferencia como abierto.
```

**Pitfalls observados hoy**:
- El primer `/goal` infirió colisión ADR desde títulos. Costó un PR extra para corregir.
- Auto-merge falló entre PRs. Usar `--watch` y merge explícito.

---

## Plan 2 — Auditoría de coverage y cierre de gaps

**Cuándo usar**: cuando un package nuevo se incorpora o cuando CI reporta `Test + Coverage (≥80%)` cerca del umbral.

**Pre-conditions**:
- `pnpm install` ejecutado, dependencies frescas.
- No hay PRs abiertos tocando los mismos packages (evita conflictos).

**`/goal`**:

```
Llevar todos los packages a coverage ≥80% en statements, branches, functions y lines.

Pre-flight: leer agent-rigor CLAUDE.md + skill_read. phase_enter "coverage-audit" (sin feature slug, es housekeeping). Leer skills 31-test-driven-development y 41-debugging-and-error-recovery antes de escribir tests.

Steps:
1. `pnpm test --coverage` en root, capturar tabla por package.
2. Identificar packages bajo 80% en cualquier dimensión. Si hay paths legítimamente intestables (wrappers de SDKs externos sin lógica propia), listarlos en chat con justificación ANTES de continuar — esperar OK del PO.
3. Por cada package bajo umbral, en orden alfabético:
   a. Crear branch `chore/coverage-<pkg>-<YYYY-MM-DD>`.
   b. Identificar líneas/branches no cubiertos vía `pnpm --filter <pkg> test --coverage --reporter=verbose`.
   c. Escribir tests siguiendo Prove-It pattern (no tests que solo verifiquen que el código compila).
   d. Commit atómico por área cubierta (`test(<pkg>): cobertura de <area>`).
   e. Push, PR, gh pr checks --watch, gh pr merge --squash --delete-branch.
4. Al final, re-run `pnpm test --coverage` global.

Condición de cierre: pegar en chat (a) tabla de coverage por package mostrando todos ≥80%, (b) lista de PRs mergeados con sus commit SHAs, (c) lista de excepciones aprobadas por PO con justificación.

Abort si: un test que escribo falla 2 reintentos consecutivos sin que el código bajo test cambie — el código probablemente tiene un bug, escalar antes de "ajustar el test para que pase".
```

**Pitfalls anticipados**:
- "Ajustar el test al código" cuando el código tiene un bug. El abort trigger lo previene.
- Tests que mockean en exceso y ya no prueban nada útil. test-engineer subagent puede invocarse para validar.

---

## Plan 3 — Cierre operativo de un PR ya revisado

**Cuándo usar**: PR ya tiene approval del PO o es trivial/seguro (docs, fix mecánico), solo falta rebase + verificar CI + merge.

**Pre-conditions**:
- PR identificado por número.
- PO ya confirmó merge (no asumir aprobación implícita).

**`/goal`** (template, sustituir `<PR>`):

```
Cerrar PR #<PR> en main con CI 100% verde.

Sanity check zero: si <PR> sigue siendo placeholder literal o `gh pr list --state open --json number --jq length` retorna 0, ABORTAR y reportar antes del pre-flight. NO invocar hooks ni ledger writes para un goal insatisfacible.

Post-abort terse: si este sanity check dispara ABORT, en TODA re-invocación siguiente del Stop hook responder ÚNICAMENTE con un punto literal `.` (1 carácter, sin texto, sin código, sin `/goal clear` como sugerencia). NO re-explicar el abort. El PO ve el `.` en chat y sabe que está esperando su `/goal clear` manual.

Pre-flight: leer agent-rigor CLAUDE.md + skill_read. skip-cycle si es solo docs/rebase, phase_enter si toca código.

Steps:
1. `gh pr view <PR> --json files,headRefName,mergeStateStatus,statusCheckRollup` — capturar nombre de branch y estado. Si el comando falla (PR no existe), ABORTAR.
2. Si mergeStateStatus = BEHIND o UNSTABLE por checks de seguridad, hacer rebase:
   a. Identificar worktree del branch con `git worktree list | grep <headRefName>`. Si no existe, NO crear uno nuevo — pedir al PO. (Evita worktree proliferation.)
   b. En el worktree: `git fetch github main && git rebase github/main`.
   c. Si hay conflictos: ABORTAR y reportar — conflict resolution requiere decisión humana.
   d. `git push github <branch> --force-with-lease`.
3. Si el PR título/body menciona ADR-<N> y `docs/adr/<N>-*.md` ya existe en main con OTRO nombre, sugerir el siguiente número libre vía `ls docs/adr/ | grep -E "^[0-9]+" | sort -un | tail -1`. APLICAR rename + actualizar referencias internas + actualizar título/body con `gh pr edit`. Amend del commit con --no-edit + force-with-lease.
4. `gh pr checks <PR> --watch --interval 15`.
5. `gh pr merge <PR> --squash --delete-branch`.

Condición de cierre: pegar en chat (a) `gh pr view <PR> --json state,mergedAt,mergeCommit` mostrando MERGED, (b) `git fetch github main && git log github/main -1 --oneline` mostrando el squash commit en HEAD.

Abort si: el rebase produce >5 archivos en conflicto, o cualquier check de seguridad (gitleaks, npm audit, CodeQL, Trivy) reporta nuevo finding tras el rebase.
```

**Pitfalls observados hoy**:
- Branch #166 estaba 5 días desactualizada con 184 archivos diff visibles (era ilusión: solo 1 commit propio).
- `gh pr merge --delete-branch` falla si el worktree del branch sigue activo — limpia worktree primero (con permiso del PO).

---

## Plan 4 — Refactor mecánico sin cambio de comportamiento

**Cuándo usar**: rename, dedup, simplification, cambio de naming bilingüe. Casos típicos: `carrier`→`transportista`, `shipper`→`generadorCarga`, dedup de helpers idénticos.

**Pre-conditions**:
- El refactor está claramente definido (input → output preciso).
- No hay PRs abiertos tocando los mismos archivos.
- Lista de exclusiones decidida con el PO (qué NO renombrar).

**`/goal`** (template, sustituir `<from>`/`<to>`):

```
Reemplazar TODO uso de `<from>` por `<to>` en código, excluyendo:
- Archivos en docs/adr/ ya mergeados (no se reescribe historia).
- Archivos en docs/handoff/ con fecha < 2026-05-01 (contexto histórico).
- Commits previos (git log/blame no se modifica).
- Cualquier string dentro de tests que valida que el campo legacy todavía es aceptado.

Sanity check zero: si <from> o <to> siguen siendo placeholders literales, o `rg "<from>" --type ts -l | wc -l` retorna 0, ABORTAR antes del pre-flight. NO invocar hooks ni ledger writes ni Edits.

Post-abort terse: si este sanity check dispara ABORT, en TODA re-invocación siguiente del Stop hook responder ÚNICAMENTE con un punto literal `.` (1 carácter, sin texto, sin código, sin `/goal clear` como sugerencia). NO re-explicar el abort. El PO ve el `.` en chat y sabe que está esperando su `/goal clear` manual.

Pre-flight: leer agent-rigor CLAUDE.md + skill_read. phase_enter "refactor-<from>-to-<to>". Leer skill 51-code-simplification.

Steps:
1. `rg "<from>" --type ts -l > /tmp/refactor-files.txt`. Mostrar conteo en chat.
2. Por cada archivo del listado:
   a. Si está en la lista de exclusiones, skipear y registrar en chat.
   b. Edit con replace_all. Verificar que el cambio sea seguro (no rompe sintaxis, no toca strings de log o IDs externos).
3. `pnpm typecheck` — 0 errores requeridos (si falla, ABORTAR — el refactor reveló dependencia rota).
4. `pnpm lint` — 0 errores.
5. `pnpm test` — 0 fallos.
6. Commit atómico por package afectado (`refactor(<pkg>): renombrar <from> a <to>`).
7. Branch `refactor/<from>-to-<to>`, push, PR, --watch, --squash --delete-branch.

Condición de cierre: pegar en chat (a) `rg "<from>" --type ts -l | wc -l` mostrando 0 fuera de exclusiones, (b) outputs de typecheck + lint + test verdes, (c) URL del PR mergeado.

Abort si: typecheck rompe en >3 archivos (señal de que el rename no era seguro), o un test pasa SIN cambios — el test probablemente no estaba probando el comportamiento que debía.
```

**Pitfalls anticipados**:
- Strings dentro de logs con el nombre legacy (afecta búsquedas en Cloud Logging).
- Field names en respuestas API consumidas por clientes externos (breaking change implícito).

---

## Plan 5 — BUILD phase: ejecutar `plan.md` ya aprobado

**Cuándo usar**: `/spec` y `/plan` ya completados y aprobados por PO. `plan.md` tiene tareas T1...Tn atómicas (~100 LOC c/u). El BUILD ejecuta sin replantear scope.

**Pre-conditions**:
- `.specs/<feature>/spec.md` y `.specs/<feature>/plan.md` existen y están aprobados.
- devils-advocate sub-agent fue invocado durante PLAN.
- Si toca UI, `design-system/MASTER.md` existe y fue leído.

**`/goal`** (template, sustituir `<feature>`):

```
Ejecutar BUILD de .specs/<feature>/plan.md tareas T1 hasta Tn en orden.

Sanity check zero: si <feature> sigue siendo placeholder literal, o `.specs/<feature>/plan.md` no existe, o `.specs/<feature>/spec.md` no existe, ABORTAR antes del pre-flight. NO invocar hooks ni ledger writes.

Post-abort terse: si este sanity check dispara ABORT, en TODA re-invocación siguiente del Stop hook responder ÚNICAMENTE con un punto literal `.` (1 carácter, sin texto, sin código, sin `/goal clear` como sugerencia). NO re-explicar el abort. El PO ve el `.` en chat y sabe que está esperando su `/goal clear` manual.

Pre-flight: leer agent-rigor CLAUDE.md + skill_read. phase_enter "<feature>" phase "build". Leer skill 30-incremental-implementation y 32-context-engineering. Si plan.md tiene tareas UI, leer también 34-frontend-ui-engineering y design-system/MASTER.md.

Por cada tarea Ti del plan:
1. Leer la entrada de plan.md correspondiente. Articular en chat: qué hace, por qué este approach, qué podría salir mal (pre_build_articulation al ledger).
2. Si es nuevo comportamiento, escribir test FIRST (TDD). Watch el test fallar antes de implementar.
3. Implementar el mínimo código que hace pasar el test.
4. Refactor si necesario, manteniendo tests verdes.
5. Validar localmente: `pnpm --filter <pkg> test`, `pnpm typecheck`, `pnpm lint`.
6. Commit Conventional Commits (subject ≤72 chars, body ≤95 chars). Diff atómico.
7. Marcar Ti como [done] en plan.md y commitearlo.

Al completar todas las tareas:
- Push branch al remote github.
- Abrir PR con body que liste tareas completadas + outputs de tests + typecheck.
- NO mergear — el merge requiere /review humano con cooling-off de 30 min.

Condición de cierre: pegar en chat (a) commits creados con `git log main..HEAD --oneline`, (b) `.specs/<feature>/plan.md` con todas las Ti marcadas [done], (c) URL del PR abierto.

Abort si:
- Una Ti revela que el spec o plan tienen un gap (ej. casos no contemplados). Reportar y esperar — modificar el plan a mid-build es señal de que faltó refinamiento previo.
- Un test falla 2 reintentos consecutivos. Diagnosticar antes que parchar.
- Vocabulario drift aparece (ver agent-rigor §4 para la lista canónica).
- Cualquier Ti toca >150 LOC. El plan estaba mal granulado, abortar y re-plan.
```

**Pitfalls anticipados**:
- Tentación de juntar Ti pequeñas en un commit. Cada Ti = un commit (viola atomicidad si se junta).
- Saltar TDD bajo el argumento "el test es obvio". El skill obliga.

---

## Lessons learned aplicadas a esta v2

Cambios concretos respecto a las plantillas iniciales propuestas el 2026-05-16 a.m.:

| v1 (mañana) | v2 (estas plantillas) | Razón |
|---|---|---|
| Condición vaga "PR mergeado" | "URL del PR + commit SHA en main vía git fetch" | El `/goal` evaluador solo lee chat — necesita output literal |
| Asume auto-merge | `--watch` + `--squash` explícito | Auto-merge se rompió mid-sesión |
| Inferencia desde PR metadata OK | "Leer archivo real con gh pr view --json files" | Inferencia produjo afirmación falsa de colisión ADR |
| Polling custom con bash | `gh pr checks --watch --interval 15` | Mi awk falló por multi-word check names |
| Sin abort triggers | Triggers explícitos por plan | Evita bucles dañinos |
| Commit message sin constraint | Subject ≤72, body ≤95, footer ≤100 | Commitlint bloqueó hoy |
| Sin pre-flight ledger | skill_read + skip-cycle/phase_enter explícito | Hook bloqueó el primer Write hoy |

---

## Follow-ups detectados (no aplicados aquí)

1. **SessionStart hook** para pre-cargar agent-rigor CLAUDE.md + escribir `skill_read` automático. Requiere parche a agent-rigor (el hook necesita conocer session-id para el path del ledger). Sin esto, cada sesión paga 1-2 turnos al primer Write.
2. **Cleanup `.claude/settings.local.json`**: tiene ~20 entradas one-off que ya están cubiertas por `.claude/settings.json` con patterns. Limpieza opcional.
3. **Decidir si `.claude/settings.json` se comparte con equipo**: hoy está gitignored. Si se quiere PR-able, ajustar `.gitignore` para excluir solo `ledger/` y `settings.local.json`.
4. **ADR del proceso `/goal`**: si `/goal` se vuelve un patrón recurrente en Booster AI, merece un ADR formalizando cuándo se usa, qué requiere, y cómo se mide su éxito.
