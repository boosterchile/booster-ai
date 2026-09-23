# Spec — Cara pública alineada al repo

**Estado**: aceptada por el PO el 2026-09-23, al pedir actualizar el repositorio y resolver los hallazgos de la revisión.

## Entradas

- `README.md` describía emisión de DTE, devices FMS150, packages `dte-provider` y `ai-provider`, plugins de Claude Code y ADR hasta 065.
- `apps/matching-engine` y `apps/notification-service` arrancan como esqueleto y el comentario apuntaba a un plugin para implementarlos.
- `docs/ci-cd.md` mandaba a skills de `agent-rigor` y `booster-skills`.

## Salidas

- `README.md` describe la PWA, la huella, el matching dentro de `apps/api`, el archivo documental sin emisión de DTE, y el árbol real de apps y packages.
- Los dos esqueletos conservan el log `starting (skeleton)` y dejan de pedir una implementación vía plugin.
- `docs/ci-cd.md` apunta al contrato. `docs/frentes-vivos.md` registra el código posterior al 2026-09-13 sin dar los slots por cerrados.

## Criterios de éxito

1. `README.md` no menciona FMS150, `dte-provider`, `ai-provider` ni plugins como forma de trabajar.
2. Los `main.ts` de matching y notificaciones no contienen `TODO` ni `booster-skills`.
3. El log de arranque `starting (skeleton)` no cambia, para no romper runbooks ni el smoke test.
4. Ningún ADR ni workflow de CI se edita. Los tres slots no se marcan terminados.
