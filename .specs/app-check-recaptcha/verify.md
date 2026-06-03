# Verify — app-check-recaptcha

**Fase**: VERIFY · **Fecha**: 2026-06-03 · **Rama**: `feat/app-check`

## Evidencia

### Tests
`pnpm --filter @booster-ai/web exec vitest run src/lib/firebase.test.ts`
→ **6 passed (6)** — 4 de regresión + 2 nuevos (init App Check + orden antes de getAuth).

### Typecheck
`pnpm --filter @booster-ai/web typecheck` (`tsc --noEmit`) → **0 errores**.
Corregido: la opción real del SDK Firebase v12 es `isTokenAutoRefreshEnabled`, no
`isTokenAutoRefresh` (nombre coloquial de la instrucción).

### Lint
`biome check` sobre los 4 archivos de código tocados → **0 errores, 0 warnings**.

### Build de producción
`vite build` con env dummy → **build OK** (87 módulos, PWA generada).

### Garantía "nunca en prod" (tree-shaking)
- Bundle prod (`dist/assets/index-*.js`): **0 escrituras** de `FIREBASE_APPCHECK_DEBUG_TOKEN=true`.
  El bloque `if (import.meta.env.DEV) { self.FIREBASE_APPCHECK_DEBUG_TOKEN = true }` fue
  eliminado por DCE (esbuild reemplaza `import.meta.env.DEV` por `false` en `vite build`).
- Las 4 ocurrencias del identificador en el bundle son **lecturas internas del propio SDK**
  Firebase App Check (consume el global si alguien lo setea); inofensivas en prod donde nunca se setea.

## Re-verify post-REVIEW (2026-06-03, cooling-off 11 h)

El REVIEW formal (code-reviewer + security-auditor + devils-advocate) encontró 1 bloqueante
real + 3 fixes de calidad (ver `review.md`). Resueltos y re-verificados:

### Bloqueante 🔴 resuelto — cableado prod de `VITE_RECAPTCHA_SITE_KEY`
- `apps/web/Dockerfile`: + `ARG`/`ENV VITE_RECAPTCHA_SITE_KEY`.
- `cloudbuild.production.yaml`: + `--build-arg` + substitution `_VITE_RECAPTCHA_SITE_KEY` (site key real de prod, pública).
- **Verificación end-to-end**: `vite build` **con** la var → site key `6Lc5Bwot…` **inlineada en el bundle** ✓ (la PWA bootea en prod). Sin el fix, el bundle llevaba `undefined` → throw en runtime para todos los usuarios.

> Corrección al REVIEW: los 3 agentes dijeron "el build revienta". Falso (verificado: `env -i … vite build` → EXIT 0). El mecanismo es **runtime**, no build-time. El fix es igualmente necesario. Ver `review.md` §Anexo.

### Fixes de calidad 🟠 resueltos
- `firebase.test.ts`: eliminado el `as unknown as` nuevo (mock tipado con firma explícita) — cumple CLAUDE.md zero-cast.
- **Nuevo test del invariante**: con `import.meta.env.DEV=false` NO se setea `self.FIREBASE_APPCHECK_DEBUG_TOKEN`; con `true` SÍ.

### Evidencia final (post-fix)
- Tests: **8 passed (8)** (6 previos + 2 del invariante debug-token).
- Typecheck `tsc --noEmit`: **0 errores** (resueltos `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`).
- Biome: **0 errores** sobre los archivos tocados.
- Build con var → site key inlineada ✓. Debug flag: **0 escrituras** en prod (tree-shaking confirmado de nuevo).

## Pendiente (decisión / acción del PO)
- Registro del debug token en Firebase Console (manual, lo hace el PO).
- Enforcement de App Check en consola — trackeado en [`.specs/_followups/app-check-enforcement-activation.md`](../_followups/app-check-enforcement-activation.md). NO activar hasta ver tráfico verificado post-deploy.
- Merge del PR (decisión del PO) + gate de aprobación `production`.
