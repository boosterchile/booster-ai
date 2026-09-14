# Spec: chore-retirar-config-claude-repo

- Author: Felipe Vicencio (with Claude Fable 5.1)
- Date: 2026-09-05
- Status: Approved
- Linked: [ADR-078](../../docs/adr/078-retiro-config-plugins-hooks-claude-code.md); PR #552 (versionó `.claude/settings.json`); PR #647 (hook `check-contrato-al-dia`); ADR-072 §3 y ADR-049 fila 3 (superadas parcialmente por ADR-078).

## 1. Objective

Que el repo deje de activar plugins, marketplaces y hooks de Claude Code en cada clon. Se eliminan `.claude/settings.json` y `.claude/hooks/check-contrato-al-dia.sh`, y ADR-078 registra la decisión superando la parte de ADR-072 y ADR-049 que fijaba ese archivo como declarador de plugins.

## 2. Why now

El 2026-09-05 el PO retiró de su entorno todos los plugins, skills y hooks de Claude Code. Mientras el repo versione `enabledPlugins: true`, cada clon vuelve a activarlos por encima de la configuración de usuario. Sin ADR nuevo, borrar el archivo contradice ADR-072 §3; el PO eligió expresamente la vía ADR + retiro completo.

## 3. Success criteria

- [ ] `git ls-files .claude/` → vacío.
- [ ] `git grep -n check-contrato-al-dia -- . ':!docs/adr/078-*' ':!.specs/chore-retirar-config-claude-repo/'` → sin coincidencias.
- [ ] `node scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` → OK (077 vive en PR #665; 078 no colisiona).
- [ ] ADR-078 usa el vocabulario de ADR-076 (`Vigente`) y no edita ADR-072 ni ADR-049.
- [ ] `git diff --stat origin/main` muestra exactamente 2 borrados (`.claude/settings.json`, `.claude/hooks/check-contrato-al-dia.sh`) y 2 altas (ADR-078, esta spec).
- [ ] gitleaks limpio sobre el cambio y CI verde en la PR.

## 4. User-visible behaviour

Ninguno (configuración del agente; no toca código, CI, infra ni datos).

## 5. Out of scope

- Retirar los hooks de ledger dentro de `boosterchile/booster-skills` (follow-up de ADR-072 §4, otro repo).
- Editar `CLAUDE.md` o `AGENTS.md`: ya describen los plugins como apoyo opcional.
- Migrar el estado de ADR-049 al vocabulario de ADR-076 (Slot 3 según ese ADR).

## 6. Constraints

1. ADRs inmutables: ADR-072 y ADR-049 no se editan; ADR-078 los supersede parcialmente.
2. Este chore no pertenece a ninguno de los tres frentes vivos; entra por orden expresa del PO (2026-09-05) como mantenimiento, no como producto.
3. Sin cambios en quality gates ni en `.github/workflows/*`.

## 7. Approach

Worktree desde `origin/main` en rama `chore/retirar-config-claude-repo`; `git rm` de los dos archivos; alta de ADR-078 y de esta spec; PR `chore` con sección Evidencia (ls-files, grep, check-adr-numbering, gitleaks, CI).

## 8. Alternatives considered

- **Retirar solo el hook y dejar los plugins declarados.** Descartada: mantiene la activación por repo que el PO acaba de retirar de su entorno.
- **Borrar todo sin ADR.** Descartada: ADR-072 §3 fija explícitamente que `superpowers` sigue habilitado en `settings.json`; el contrato exige superseder por ADR, no resolver por criterio propio.
- **Dejar `settings.json` con `enabledPlugins: false`.** Descartada: sigue siendo el repo decidiendo por el operador, y deja un archivo cuyo único contenido es negar algo.
