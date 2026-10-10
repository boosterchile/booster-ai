# Spec — Coverage 80 en las cuatro métricas (T10-08) + medición de CI (T10-14)

Programa TRL 10, fase B ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md), `.specs/trl10/spec.md`).
Autorización del PO para editar el quality gate de `ci.yml` (solo coverage): 2026-10-07.

## Entradas

- `ci.yml` exigía 80/75/80 (líneas/ramas/funciones) y no medía sentencias.
- Seis workspaces con umbral < 80 en alguna métrica: `apps/api`, `apps/web`,
  `apps/sms-fallback-gateway`, `apps/telemetry-processor`,
  `apps/telemetry-tcp-gateway`, `apps/whatsapp-bot`.
- El gate de CI comparaba `pct < min`; con `pct = 'Unknown'` (cero archivos
  medidos) la comparación es `false` y el gate pasaba en falso. Caso real:
  `packages/otel-bootstrap`, cuya lógica vive en `src/index.ts`, excluido del
  coverage por la regla genérica `src/**/index.ts`.

## Salidas

1. `ci.yml`: `COVERAGE_MIN_{LINES,BRANCHES,FUNCTIONS,STATEMENTS} = 80`; el gate
   chequea las cuatro y trata un `pct` no numérico como 0 (falla).
2. `vitest.config.ts` de los seis workspaces con `thresholds` 80 en las cuatro.
3. `src/**/index.ts` deja de excluirse en los packages cuyo `index.ts` contiene
   lógica: `otel-bootstrap`, `matching-algorithm`, `transport-documents`
   (`notification-fan-out` ya lo medía).
4. Tests nuevos donde la medición quedó < 80: `whatsapp-bot` (ramas de la
   máquina de conversación y del webhook), `otel-bootstrap` (delegación del
   exporter, arranque con Cloud Trace, handler SIGTERM, shutdown que falla),
   `transport-documents` (`createPdfTedIngestor`).

## Criterios de éxito

- [x] `pnpm test:coverage` 30/30 y el gate de CI, simulado localmente sobre cada
      `coverage-summary.json`, pasa en los 30 workspaces sin ningún `Unknown`.
- [x] Ningún umbral < 80 en ningún `vitest.config.ts` con thresholds.
- [x] T10-14: p95 del tiempo de reloj CI+E2E por PR ≤ 10 min sobre los últimos
      50 PRs (API de Actions), registrado en el PR.

## Fuera de alcance

- T10-10 y T10-11 (gates en `e2e-pr.yml`): sin autorización del PO para editar
  ese workflow; diferidos.
