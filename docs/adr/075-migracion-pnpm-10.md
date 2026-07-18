# ADR-075 — Migración a pnpm 10: fuente única de overrides en pnpm-workspace.yaml

**Estado**: Proposed
**Fecha**: 2026-07-18
**Decider**: Felipe Vicencio (Product Owner)
**Related**: `pnpm-workspace.yaml` (nueva fuente única de `overrides`/`onlyBuiltDependencies`), `package.json` (`packageManager`, campo `pnpm` eliminado), `.github/workflows/{ci,security,release,e2e-pr,e2e-staging}.yml` (pnpm/action-setup), PR #604 (pin `websocket-driver>=0.7.5`, CVE-2026-54466), incidente 2026-06-11 (lockfile sin `settings.overrides` → `crypto-js` 3.3.0 vulnerable)

---

## Contexto

El repo mantiene **13 security pins** (`overrides`) + **2 `onlyBuiltDependencies`** **duplicados a propósito** en dos lugares:

- `package.json` → campo `pnpm.overrides` — lo lee **pnpm 9**.
- `pnpm-workspace.yaml` → `overrides` — lo lee **pnpm 10** (que **ignora** el campo de `package.json` y emite `[WARN] The "pnpm" field in package.json is no longer read by pnpm`).

El duplicado fue una migración a medias, deliberada como red de seguridad: `packageManager` y el CI estaban en `pnpm@9.15.4`, pero un `pnpm install` local con pnpm 10 generaba el lockfile leyendo solo `pnpm-workspace.yaml`. Sin el duplicado, un install con la versión "equivocada" dropea overrides en silencio — exactamente lo que pasó el 2026-06-11 (lockfile sin `settings.overrides`; `crypto-js` 3.3.0 y `@grpc/grpc-js` vulnerables resueltos pese a los overrides históricos).

Estado verificado (2026-07-18, primera fuente, worktree desde `origin/main` @ b10519c):

- Los 13 overrides + 2 onlyBuiltDependencies de `package.json.pnpm` son **idénticos entrada-por-entrada** a los de `pnpm-workspace.yaml` (diff: 0 divergencias).
- `packageManager = pnpm@9.15.4`; los 5 workflows con `pnpm/action-setup` corren `9.15.4` (`ci`/`e2e-pr`/`release` vía env `PNPM_VERSION`; `security` ×7 y `e2e-staging` ×1 hardcoded).
- El `pnpm` local por defecto (Homebrew) es `9.15.4` — de ahí el WARN. `corepack pnpm@10` resuelve a **10.34.4** (disponible).
- Lockfile actual: `lockfileVersion: '9.0'`; todos los pins satisfacen su constraint (websocket-driver@0.7.5, qs@6.15.2, tmp@0.2.7, crypto-js@4.2.0, @grpc/grpc-js@1.14.4, form-data@4.0.6, uuid@11.1.1, http-proxy-agent@7.0.2, fast-xml-builder@1.2.0, protobufjs@7.6.4, @opentelemetry/{core,resources,sdk-trace-base}@2.8.0).

**Riesgo clave**: quitar el campo `pnpm` de `package.json` mientras el CI corre pnpm 9 haría que el CI pierda los overrides y reintroduzca los CVEs. Los dos cambios (quitar el campo + subir el CI a pnpm 10) **son inseparables** y van en el mismo PR.

## Decisión

Adoptar **pnpm 10.34.4** como versión única del proyecto y consolidar la configuración:

1. `pnpm-workspace.yaml` es la **fuente única** de `overrides` y `onlyBuiltDependencies`.
2. Eliminar el campo `pnpm` de `package.json` (deja de leerse en pnpm 10; el WARN desaparece).
3. `packageManager: "pnpm@10.34.4"` y **todos** los `pnpm/action-setup` de CI en `10.34.4` (mismo valor, sin divergencia version-vs-packageManager en action-setup@v6).
4. `engines.pnpm: ">=10.0.0"` (antes `>=9.0.0`): señaliza que con el campo removido, pnpm 9 dropea overrides. Enforcement real = `packageManager` + Corepack; `engines` es advisory (no hay `.npmrc` con `engine-strict`).
5. Regenerar el lockfile con pnpm 10.

## Consecuencias

- **Sin degradación de seguridad** (criterio de cierre, verificado en el PR): `pnpm audit --audit-level=high --prod` sigue en 0 vulns y `pnpm why` de los pins muestra las mismas versiones (ninguna baja). Si el audit pasara de 0 a >0, la migración se detiene y no se mergea.
- El lockfile se regenera con pnpm 10 (sigue `lockfileVersion 9.0`).
- El CI corre pnpm 10.34.4 en todos los jobs; el WARN de "pnpm field no longer read" desaparece del install.
- **Dev local**: quien tenga Corepack toma pnpm 10 automáticamente vía `packageManager`; quien use un pnpm 9 de Homebrew debe actualizar (`corepack use pnpm@10` o `brew upgrade pnpm`). Sin esto, un install local con pnpm 9 dropea overrides — mismo riesgo que motiva este ADR, ahora acotado a entornos que ignoran `packageManager`.
- Se elimina la deuda de mantener dos listas de overrides en sync.

El PO pasa este ADR a **Accepted** al aprobar el PR.
