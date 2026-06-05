# Review — app-check-recaptcha (REVIEW phase, 5 ejes + 3 sub-agentes)

**Fecha**: 2026-06-03 · **Rama**: `feat/app-check` (commit `da4ac1a`) · **Cooling-off**: 11 h ✓
**Sub-agentes**: code-reviewer + security-auditor + devils-advocate (auto, obligatorio).

> Este documento consolida los 3 sub-agentes + una **corrección empírica** de su hallazgo principal. El output crudo del devils-advocate quedó preservado abajo en §Anexo.

## Veredicto: NO listo para merge/deploy. 1 bloqueante real (corregido) + 3 fixes de calidad.

---

## ⚠️ Corrección empírica a los 3 sub-agentes

Los tres convergieron en: *"`VITE_RECAPTCHA_SITE_KEY` required → `vite build` hace throw → el job Build de CI y el de Cloud Build **revientan**"*.

**Eso es falso, verificado empíricamente.** `vite build` **NO ejecuta** el top-level de `env.ts` (el `safeParse` + `throw`); eso corre en **runtime en el browser**. Prueba: `env -i pnpm --filter @booster-ai/web build` (sin **ninguna** VITE_ var) → **EXIT 0, build OK**. Corolario lógico: si el throw ocurriera en build, el CI **ya estaría roto hoy** por las `VITE_FIREBASE_*` (también required y tampoco presentes en `ci.yml`) — y no lo está.

- ✅ **CI (`pnpm build`)**: NO se rompe. Sigue verde al abrir el PR.
- ✅ **Cloud Build (`vite build`)**: NO falla en build-time.

## 🔴 BLOQUEANTE real (mecanismo runtime, no build-time)

`VITE_RECAPTCHA_SITE_KEY` es `required` en `env.ts:41` pero **no está cableada en el deploy de prod**:
- `apps/web/Dockerfile:28-35` — 8 `ARG VITE_*`, ninguno RECAPTCHA.
- `cloudbuild.production.yaml:56-63` (build-args) + `:557-572` (substitutions) — no la pasan/definen.

**Consecuencia (corregida)**: Cloud Build produce un bundle con `import.meta.env.VITE_RECAPTCHA_SITE_KEY` inlineado como **`undefined`**. Cuando un usuario carga la PWA en prod, `env.ts` hace `throw new Error('Invalid env…')` en runtime → **la app no bootea para NINGÚN usuario (pantalla blanca)**. Pasa todos los gates de build (CI verde, Cloud Build verde) y rompe recién al cargar en el browser — más insidioso, no menos.

**Fix**: cablear la var en `Dockerfile` (ARG+ENV) + `cloudbuild.production.yaml` (build-arg + substitution `_VITE_RECAPTCHA_SITE_KEY` con la site key real — pública, OK versionarla junto a las otras Firebase keys). **Ambos archivos están en la lista "ask-first" de CLAUDE.md → requieren OK del PO.**

## 🟠 Fixes de calidad (antes del PR)

1. **`firebase.test.ts:83-86`** — `as unknown as [...]` nuevo viola CLAUDE.md (zero `as unknown as` sin Zod). Tipar el mock o usar `toHaveBeenCalledWith(...)`. (La línea 50 es deuda preexistente, no de este diff.)
2. **Falta test del invariante estrella** (spec §3/§6.3): que el debug token **no** se setea en prod y **sí** en dev. Hoy solo se "verifica" grepeando el bundle a mano. Agregar test que mockee `import.meta.env.DEV`. Spec §9 ni lo lista → gap del plan.
3. **Comentario `self`/worker** (`firebase.ts:14-18` + spec §6.2): afirma soporte en workers, pero solo se augmenta `interface Window` (en worker `self` es `WorkerGlobalScope`). La app corre en main thread → inofensivo, pero alinear el comentario.

## 🟡 Residuales a documentar (no bloquean el diff)

- **Sin followup stub** para activar enforcement: el spec lo deja fuera de alcance, pero la propiedad de seguridad real (App Check protegiendo) queda sin tracking. Crear `.specs/_followups/`.
- **Secuencia de activación**: desplegar este código y verificar tráfico "verificado" **antes** de activar enforcement (si no → outage). Responsabilidad operacional; documentar en runbook. *(Ya validado en esta sesión: las métricas en cero confirmaron que aún no está desplegado.)*
- **Sin kill-switch runtime**: init de App Check incondicional; desactivar requiere redeploy. Aceptable para v1.

## ✅ Lo que pasó la revisión

- Orden App Check antes de `getAuth`: correcto y **garantizado** (firebase.ts es el ÚNICO init de servicios Firebase — verificado, no hay getFirestore/getStorage/getAuth en otro módulo).
- Tree-shaking del bloque debug en prod: **verificado** (0 escrituras del flag en el bundle; solo lecturas internas del SDK).
- `isTokenAutoRefreshEnabled: true`: correcto, sin downside de seguridad.
- Sin secretos reales en el diff (gitleaks: no leaks). Site key es pública por diseño.
- Sin dependencia nueva (`firebase/app-check` es subpath del `firebase` ya presente).
- `self`/Window sin `as unknown as`: patrón limpio.

## Acción

Volver a BUILD: cablear la var en Dockerfile+cloudbuild (con OK del PO por ser ask-first) + 3 fixes de calidad + re-verify. **NO push/PR hasta resolver el bloqueante** — un PR ahora pasaría CI pero dejaría prod listo para romper al desplegar.

---

## Anexo — corrección de proceso

El devils-advocate y el security-auditor reportaron el bloqueante como "build-time failure". La verificación empírica (build sin env vars → EXIT 0) demostró que el mecanismo es **runtime**, no build-time. El impacto (prod inutilizable sin la var cableada) es real e igual de bloqueante, pero el agente que lo trate como "rompe CI/build" se equivoca en el síntoma. Lección: verificar el claim de falla antes de relayarlo, incluso cuando 3 agentes coinciden.
