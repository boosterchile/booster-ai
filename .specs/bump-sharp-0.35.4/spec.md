# Spec: bump-sharp-0.35.4

- Author: Felipe Vicencio (con agente)
- Date: 2026-09-09
- Status: Approved (chore de seguridad, PO 2026-09-09)
- Linked: GHSA-rgj7-g3m4-5g8c (sharp <0.35.4, HIGH, libheif), `.github/workflows/security.yml` (jobs `npm audit (HIGH+)` y `Trivy filesystem + config scan`), ADR-075 (pnpm 10, `pnpm-workspace.yaml` como fuente única de overrides), ADR-070 §O-2 (sharp con binario prebuilt).

## 1. Objective

Dejar en 0 las vulnerabilidades HIGH/CRITICAL que hacen fallar los dos checks de `security.yml` en todo PR desde el 2026-09-08, subiendo `sharp` de 0.35.1 a 0.35.4 (versión parchada) en los dos paquetes que lo declaran.

## 2. Why now

El advisory se publicó el 2026-09-08 21:25 UTC. Desde entonces cualquier PR (incluido #670, docs-only) queda con `npm audit` y `Trivy fs` en rojo y el run programado de Security en `main` fallará igual.

## 3. Success criteria

- [ ] `apps/api/package.json` y `packages/transport-documents/package.json` declaran `"sharp": "0.35.4"`; `pnpm-lock.yaml` resuelve `sharp@0.35.4` y sus `@img/sharp-*` correspondientes; ninguna otra dependencia cambia de versión.
- [ ] `corepack pnpm audit --audit-level=high --prod` termina en 0 HIGH/CRITICAL.
- [ ] `pnpm --filter @booster-ai/api typecheck`, `test` y `build` en verde con node 24 y pnpm 10.34.4; `pnpm --filter @booster-ai/transport-documents test` en verde.
- [ ] CI del PR: `npm audit (HIGH+)`, `Trivy filesystem + config scan` y `Docker build + smoke (api)` en verde (este host no tiene Docker; el docker build se verifica en CI).

## 4. User-visible behaviour

Ninguno. Cambio de versión de una librería de procesamiento de imágenes usada por el worker de documentos (preprocesado de fotos para decodificar el TED).

## 5. Out of scope

- Cualquier otro advisory `moderate`/`low` que reporte `pnpm audit`.
- Cambios en `onlyBuiltDependencies` u overrides de `pnpm-workspace.yaml` (sharp no necesita build script: usa binarios prebuilt vía `@img/sharp-*`).

## 6. Constraints

1. Lockfile regenerado solo con Corepack/pnpm 10.34.4 (ADR-075): pnpm 9 dropearía los overrides.
2. Sin merge por el agente: lo hace el PO.

## 7. Approach

Bump literal en los dos `package.json`, `corepack pnpm install` para actualizar el lockfile, verificación de que el diff del lockfile se limita a `sharp` y `@img/sharp-*`, audit, typecheck/test/build del api y test de transport-documents.

## 8. Alternatives considered

- **Override `sharp@<0.35.4: >=0.35.4` en `pnpm-workspace.yaml`**: rechazado; sharp es dependencia directa en dos paquetes, el bump explícito es más legible y no agrega un pin permanente.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Binario prebuilt de sharp 0.35.4 no disponible para `linux-x64`/alpine del runtime | L | H | El job `Docker build + smoke (api)` de CI lo detecta; sharp publica `@img/sharp-linuxmusl-x64` |
| Cambio de comportamiento en el preprocesado de fotos (TED) | L | M | Tests de `packages/transport-documents` y del worker; patch release dentro de 0.35.x |

## 10. Test list

- T1: `pnpm audit --audit-level=high --prod` → exit 0.
- T2: `git diff pnpm-lock.yaml` solo toca `sharp` y `@img/sharp-*`.
- T3: typecheck + test + build de `@booster-ai/api`; test de `@booster-ai/transport-documents`.

## 11. Rollout

- Feature-flagged? No. Migration needed? No.
- Rollback plan: revert del commit.
- Monitoring: job `Docker build + smoke (api)` y checks de Security en el PR.

## 12. Open questions

None.

## 13. Decision log

- 2026-09-09 — Chore autorizado por el PO al pedir levantar la tarea del chip en la sesión.
