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

## Pendiente (decisión del PO)
- REVIEW formal (code-reviewer + devils-advocate + security-auditor) no ejecutado: la
  regla solo-dev exige cooling-off de 30 min post-implementación. Se entrega diff para
  revisión humana; el ciclo /review queda disponible con waiver si se quiere antes.
- Registro del debug token en Firebase Console (manual, lo hace el PO).
- Enforcement de App Check en consola (fuera de alcance por instrucción explícita).
