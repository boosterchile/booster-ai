# P1-C — esbuild advisory + vite 6.4.2

> ✅ **RESUELTO POR ANÁLISIS (2026-06-16)** — sin cambio de código. La premisa
> del hallazgo (06-14) cambió contra el código vivo: vite ya está en 6.4.2 y el
> advisory de esbuild vigente NO aplica a este monorepo Node/pnpm. Forzar un
> override sería net-negativo (rompe tooling, beneficio de seguridad nulo).

**Dimensión**: deps · **Esfuerzo original estimado**: M (override) · **Fuente**: audit 2026-06-14

## Hallazgo original (06-14)

`drizzle-kit`/`vite`/`vitest` → `esbuild` con advisory GHSA (RCE + file read) High, build/dev-time, supply chain. Propuesta: override de esbuild + bump vite a 6.4.2.

## Verificación contra el código vivo (2026-06-16)

1. **vite ya está en 6.4.2** (`pnpm why esbuild` muestra `vite@6.4.2`). El bump propuesto **ya está hecho**.

2. **El advisory vigente de esbuild no aplica acá**:
   - Es **dev-only**: esbuild no es dependencia directa de ningún workspace; vive bajo `drizzle-kit`, `vite`, `vitest` (todas devDependencies / tooling de build/test). No está en el árbol de producción.
   - El gate de CI (`.github/workflows/security.yml` → `npm audit (HIGH+)`) corre `pnpm audit --audit-level=high --prod`. El flag `--prod` excluye devDependencies → **el gate da exit 0** ("No known vulnerabilities found"). esbuild nunca lo dispara.
   - El advisory concreto que reporta `pnpm audit` hoy es **GHSA-gv7w-rqvm-qjhr**: *"Missing binary integrity verification in the Deno module enables remote code execution via NPM_CONFIG_REGISTRY"*. El vector es **específico del path de instalación vía Deno**. Este repo es **Node/pnpm** → el vector no existe.

3. **Paths vulnerables** (`pnpm audit`):
   - `drizzle-kit@0.31.10 > @esbuild-kit/esm-loader > @esbuild-kit/core-utils@3.3.2 > esbuild@0.18.20` — el `@esbuild-kit/*` está **deprecated** (sunset por el autor a favor de `tsx`); drizzle-kit lo arrastra transitivamente. No fixeable sin que drizzle-kit migre.
   - `vite@6.4.2 > esbuild@0.25.12` — `<0.28.1`, flaggeado.

## Por qué NO se aplica un override

Forzar `esbuild@>=0.28.1` (global o scoped):
- Rompería con alta probabilidad a `drizzle-kit` (su `@esbuild-kit/core-utils@3.3.2` espera la API de esbuild **0.18**) → riesgo sobre `drizzle-kit generate` (generación de migraciones).
- Podría romper a `vite@6.4.2` (espera esbuild 0.25.x).
- **Beneficio de seguridad: nulo** — ni el vector Deno ni el árbol de producción aplican.

Introducir fragilidad en el toolchain de build por un cambio sin beneficio contradice la disciplina del proyecto. Se documenta como deuda **conscientemente no tomada**, no como parche silencioso.

## Re-evaluar si

- esbuild pasa a ser dependencia **de producción** de algún workspace, **o**
- aparece un advisory de esbuild que aplique a Node/pnpm en runtime, **o**
- `drizzle-kit` migra de `@esbuild-kit/*` a `tsx` (cerraría el path 0.18.20 solo).
