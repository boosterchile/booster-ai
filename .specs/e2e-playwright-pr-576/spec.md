# E2E Playwright (PR, local): blindaje #576 en browser real

**Estado**: aceptada (goal del PO, 2026-07-09; dos decisiones selladas en el checkpoint de recon).
**Va ANTES** del spike de React Aria (Modal nacerá verificando foco real sobre esta infra).

## Contexto del recon (el plan original chocaba con la realidad)

- El job "Playwright + axe-core (a11y)" **NO es un stub en ci.yml**: vive en `e2e-staging.yml`, con `playwright.config.ts` completo (4 browsers) + 3 specs en `apps/web/e2e/`. Corre **nightly contra PROD** y **se salta en PRs a propósito** (guard 2026-06-09: sin `STAGING_URL` no le pega a prod con data de un PR).
- Lo que falta y este goal agrega: un check E2E **de PR** que levanta un **server local** y verifica `/apariencia` **sin tocar prod/staging**.
- `@axe-core/playwright` está instalado pero **ningún spec importa axe** (axe fantasma, confirmado).
- Las 5 primitivas en `/apariencia` son **#579 (sin mergear)**; en main `/apariencia` ya tiene botones de acento `text-white` (`accent-preview-button`).

## Decisiones selladas (checkpoint recon)

1. **Config/job local NUEVO y aparte** (Chromium-only + webServer local), sin tocar `e2e-staging.yml` ni su config de 4 browsers (nightly-vs-prod intacto).
2. **Sobre main**, el test #576 apunta a `accent-preview-button` (Ola 0), desacoplado de #579.

## Entradas

- `apps/web` (`@booster-ai/web`): dev = `vite` en puerto 5173; `/apariencia` renderiza `accent-preview-button` (`bg-accent-600 text-white`).
- `@playwright/test` 1.59.1 (ya instalado).
- El reset `@layer base` en `apps/web/src/styles.css` (el fix de #576).

## Salidas / criterios de éxito

1. **`apps/web/playwright.local.config.ts`**: SOLO Chromium; `webServer` siempre-on que levanta `pnpm dev` (5173) y espera `/apariencia`; `testDir: ./e2e-local` (aislado de los specs staging); trace/screenshot on-failure.
2. **`apps/web/e2e-local/appearance-576.spec.ts`**: navega a `/apariencia`, lee el **color COMPUTADO** de `accent-preview-button` en Chromium (`getComputedStyle(el).color`) y exige `rgb(255, 255, 255)` (blanco). **Debe fallar si se revierte el reset a `@layer base`** (validado localmente revirtiendo el reset → rojo → restaurar).
3. **`.github/workflows/e2e-pr.yml`**: nuevo workflow, PR-time (paths apps/web + packages ui), Node 24, instala **solo Chromium**, corre el E2E local, sube reporte/trace como artefacto en fallo. **NO-required** (workflow nuevo ⇒ no está en branch protection; la promoción a required es decisión posterior del PO).
4. **No romper nada**: los gates de ci.yml siguen verdes en clean-install; `e2e-staging.yml` intacto.
5. **Secundario (no forzar)**: axe-en-browser sobre `/apariencia`. Si añade flakiness o exige arreglar violaciones (scope), se deja como ítem aparte anotado.

## Verificación

- **Local (node 24 + Chromium)**: el test pasa; revirtiendo el reset `@layer base`, el test cae (prueba de que blinda de verdad); restaurar.
- **Vinculante = CI clean-install**: el nuevo job corre Playwright real y reporta; el resto de gates verde.

## Fuera de alcance

- Tests de Modal (Modal no existe; llegan en el spike de React Aria).
- Promover el check a required (decisión posterior del PO).
- Tocar `e2e-staging.yml` / `playwright.config.ts` (nightly-vs-prod).
- Migrar los specs staging existentes.

## Condición de término

Chromium instalado, `playwright.local.config.ts` con webServer a `/apariencia`, test #576 que pasa en Chromium y caería con el bug revertido, job de ci nuevo corriendo real como no-required con artefactos en fallo, resto de gates verde — con evidencia fresca del CI. PR **no mergeado** (gate PO, ADR-072). El agente termina turno.
