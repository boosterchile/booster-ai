# Booster AI — Pasada 1: Quality + Deuda técnica

> **Fecha**: 2026-05-15
> **Auditor**: Claude (vía Explore subagent + grep directo)
> **Scope**: Cero `any` / cero `console.*` / TODO sin issue / vocabulario drift / packages stub / archivos enormes / duplicación lógica / colocación de tests / naming bilingüe / dead exports.
> **Estado del repo**: `main` (b9f7b08, 2026-05-14). Ver §11 de [inventory.md](inventory.md) para deltas de la rama `feat/security-blocking-hotfixes-2026-05-14`.
> **Naturaleza**: lectura pura. Output = este archivo. Sin modificación de código.

---

## Resumen ejecutivo

| Axis | Estado | N hallazgos |
|---|---|---|
| 1. `any` en código de producción | drift menor | **4** |
| 2. `console.*` en código de producción | CLEAN | 0 |
| 3. TODO sin issue | drift sistemático | 8 |
| 4. Vocabulario drift (CLAUDE.md §4) | **AUDIT BLOCKED** (ver §4) | — |
| 5. Packages stub sin importadores | drift estructural | 5 |
| 6. Archivos > 500 LOC | smell | 20 (top-20 listados) |
| 7. `matching-algorithm` duplicación (regresión AUDIT.md 2026-05-01) | RESUELTO ✓ | 0 |
| 8. Dead exports | bajo riesgo | n/d (sin import-graph tool) |
| 9. Colocación de tests | parcial | 10 ejemplos sin sibling |
| 10. Naming bilingüe | CLEAN | 0 |

**Veredicto**: El proyecto pasa los principales gates declarados (CLAUDE.md §1). Los `any` son 4 supervivientes justificables (interop con libs sin tipos). Los `console.*` están en cero. La regresión que la auditoría anterior (2026-05-01) reportaba en `matching-algorithm` está cerrada: hoy hay separación clara `package puro ↔ service orquestador`. La deuda neta vive en (a) 5 packages stub que ningún workspace importa, (b) 8 entradas `// TODO` sin issue todas del mismo patrón "implementar según ADR", y (c) 20 archivos > 500 LOC con tres rutas > 1k LOC.

---

## 1. `any` types en código de producción (4)

`noExplicitAny: error` en `biome.json` debería forzar a cero. Los 4 supervivientes son interop legítimos pero merecen comentario explícito o `biome-ignore` con razón:

- [apps/web/src/services/voice-commands.ts:4](apps/web/src/services/voice-commands.ts) — `window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }`. Web Speech API sin tipos estándar. **Aceptable** con justificación.
- [apps/telemetry-processor/src/crash-trace-adapters.ts:1](apps/telemetry-processor/src/crash-trace-adapters.ts) — `({ insertIds: [row.crash_id] } as any)`. Cast a BigQuery API. Mover a un tipo `BigQueryInsertOptions` declarado.
- [apps/api/src/db/migrator.ts:1](apps/api/src/db/migrator.ts) — `db: any`. Parámetro de la función migrator runner. Reemplazable por `NodePgDatabase<typeof schema>` de drizzle-orm.
- [packages/certificate-generator/src/ca-self-signed.ts:1](packages/certificate-generator/src/ca-self-signed.ts) — `(forge.pki as any).getTBSCertificate(cert)`. node-forge expone esto sin tipo. **Aceptable** con justificación.

**Acción sugerida**: añadir `biome-ignore lint/suspicious/noExplicitAny: <razón>` con motivo en cada uno, o reemplazar (migrator es trivial).

---

## 2. `console.*` en código de producción

**CLEAN** — 0 hallazgos en `apps/*/src/**` y `packages/*/src/**` (excluyendo tests, scripts y e2e). Biome `noConsole: error` + uso disciplinado de `@booster-ai/logger` (Pino) lo enforce.

---

## 3. TODOs sin referencia a issue (8 — todos mismo patrón)

Los 8 `// TODO` supervivientes son **el mismo comentario** repetido en los 5 packages stub + 3 apps stub:

- [apps/document-service/src/main.ts](apps/document-service/src/main.ts) — comentario `implementar según el ADR correspondiente`.
- [apps/notification-service/src/main.ts](apps/notification-service/src/main.ts) — id.
- [apps/matching-engine/src/main.ts](apps/matching-engine/src/main.ts) — id.
- [packages/ai-provider/src/index.ts](packages/ai-provider/src/index.ts) — comentario `implementar según ADRs relacionados`.
- [packages/carta-porte-generator/src/index.ts](packages/carta-porte-generator/src/index.ts) — id.
- [packages/document-indexer/src/index.ts](packages/document-indexer/src/index.ts) — id.
- [packages/trip-state-machine/src/index.ts](packages/trip-state-machine/src/index.ts) — id.
- [packages/ui-components/src/index.ts](packages/ui-components/src/index.ts) — id.

**Patrón**: scaffolding declarado al kick-off (2026-04-23) que aún no se llenó. CLAUDE.md §4 prohíbe los `// TODO` sin issue. Aquí no hay issue — sólo "según ADR correspondiente". El ADR sí existe (e.g. ADR-007 para carta-porte) pero no hay GitHub issue trackeando el cierre. **Acción**: crear issues GitHub linkados a los ADRs y referenciar en el comentario, o eliminar el stub si no se implementa.

---

## 4. Vocabulario drift — AUDIT BLOCKED

El subagente Explore que envié con instrucciones para grep los términos del listado **CLAUDE.md §4 — "Vocabulario prohibido"** en código de producción **fue bloqueado por el hook `agent-rigor` PreToolUse** porque la propia query de búsqueda contiene los términos prohibidos. Cuando intenté hacer el grep yo directamente y registrar el `drift_justified` per las instrucciones del hook, el hook bloqueó también la entrada del ledger porque la propia justificación cita los términos.

Es un **bucle recursivo del hook**: imposible auditar este axis sin un waiver explícito.

**Recomendación**: ejecutar el audit fuera del hook con un waiver one-off (`AGENT_RIGOR_DISABLE_HOOKS=1 grep -ni <patrón> apps packages`) o pre-aprobar la lista de términos con `[waiver: audit-only]` en el ledger. Esta brecha del audit es **por diseño defensivo** del hook, no es un fallo en el código de Booster AI.

**Workaround manual** que Felipe puede correr fuera de Claude:

```bash
cd /Volumes/Pendrive128GB/Booster-AI
# Ver lista de términos en CLAUDE.md §4 (operating contract agent-rigor)
# y grep cada uno por separado:
rg -ni '<cada-término-de-clademd-§4>' apps packages --type ts --type tsx
```

Si el resultado agregado es 0, axis 4 está CLEAN. Si tiene matches, son drift declarable.

---

## 5. Packages stub sin importadores (5 — drift estructural)

Cinco paquetes declarados en `pnpm-workspace.yaml` pero con cero importadores en el repo. Cada uno exporta sólo una constante `PACKAGE_NAME` y un comentario `// TODO`:

| Package | LOC | Exports | Importadores | ADR motor |
|---|---|---|---|---|
| `@booster-ai/ai-provider` | 7 | `PACKAGE_NAME` | **0** | ADR-025 (NLU WhatsApp), ADR-037 |
| `@booster-ai/carta-porte-generator` | 7 | `PACKAGE_NAME` | **0** | ADR-007 |
| `@booster-ai/document-indexer` | 7 | `PACKAGE_NAME` | **0** | ADR-007 |
| `@booster-ai/trip-state-machine` | 7 | `PACKAGE_NAME` | **0** | ADR-004 |
| `@booster-ai/ui-components` | 7 | `PACKAGE_NAME` | **0** | ADR-008 |

**Significado**:

- "Cero importadores" se verificó por grep contra `from '@booster-ai/<package>'` en todo el repo.
- Los ADRs motores existen y son válidos — pero la lógica que ellos prescriben hoy vive **fuera** de su package:
  - `trip-state-machine`: el lifecycle del trip está declarado **inline en `apps/api/src/db/schema.ts`** como enum + transiciones implícitas en services. ADR-004 prescribió XState aquí; nadie lo cumple.
  - `ai-provider`: la abstracción Gemini/Claude vive en `apps/api/src/services/gemini-client.ts` directamente. ADR-025 prescribió un package independiente; está violado.
  - `carta-porte-generator`: PDF Carta de Porte se genera en `packages/certificate-generator` mezclado con certificados.
  - `document-indexer`: el indexado SII está en `apps/api/src/services/reconciliar-dtes.ts` directamente.
  - `ui-components`: componentes shadcn-style están en `apps/web/src/components/` directamente.

**Acción**: o se elimina el stub (commit limpio: ya nadie depende, el delete no rompe nada) o se ejecuta la migración prescrita por el ADR. **Mantener el stub en este estado contradice CLAUDE.md §1** (postura "cero deuda desde day 0").

---

## 6. Archivos > 500 LOC (top 20, TS/TSX, no tests)

| # | Path | LOC | Comentario |
|---|---|---:|---|
| 1 | [apps/api/src/db/schema.ts](apps/api/src/db/schema.ts) | 2 159 | Todo el schema Drizzle en un solo archivo. Candidato a partir por dominio. |
| 2 | [apps/web/src/routes/cargas.tsx](apps/web/src/routes/cargas.tsx) | 1 532 | Listado shipper. Extraer subcomponentes (filtros, fila, modal). |
| 3 | [apps/web/src/routes/platform-admin.tsx](apps/web/src/routes/platform-admin.tsx) | 1 121 | Admin dashboard. Tabs no separados. |
| 4 | [apps/web/src/routes/conductores.tsx](apps/web/src/routes/conductores.tsx) | 1 115 | CRUD + invitación + reset. |
| 5 | [apps/web/src/routes/platform-admin-matching.tsx](apps/web/src/routes/platform-admin-matching.tsx) | 1 043 | UI backtest matching v2. |
| 6 | [apps/api/src/services/seed-demo.ts](apps/api/src/services/seed-demo.ts) | 948 | Seed multi-tenant demo. Naturalmente largo. |
| 7 | [apps/web/src/routes/vehiculos.tsx](apps/web/src/routes/vehiculos.tsx) | 945 | CRUD vehículos + telemetría inline. |
| 8 | [apps/web/src/routes/platform-admin-site-settings.tsx](apps/web/src/routes/platform-admin-site-settings.tsx) | 831 | Editor brand+copy. |
| 9 | [apps/api/src/routes/vehiculos.ts](apps/api/src/routes/vehiculos.ts) | 747 | Handlers. |
| 10 | [apps/web/src/components/onboarding/OnboardingForm.tsx](apps/web/src/components/onboarding/OnboardingForm.tsx) | 709 | Form multi-paso. |
| 11 | [apps/api/src/routes/chat.ts](apps/api/src/routes/chat.ts) | 692 | SSE + POST + read marks. |
| 12 | [apps/api/src/routes/assignments.ts](apps/api/src/routes/assignments.ts) | 687 | POD + eco-route + status. |
| 13 | [packages/certificate-generator/src/generar-pdf-base.ts](packages/certificate-generator/src/generar-pdf-base.ts) | 657 | PDF builder. |
| 14 | [apps/web/src/routes/sucursales.tsx](apps/web/src/routes/sucursales.tsx) | 651 | CRUD sucursales. |
| 15 | [apps/api/src/services/matching-backtest.ts](apps/api/src/services/matching-backtest.ts) | 646 | Comparador v1 vs v2. |
| 16 | [apps/api/src/routes/me.ts](apps/api/src/routes/me.ts) | 637 | Perfil + roles. |
| 17 | [apps/web/src/routes/conductor-configuracion.tsx](apps/web/src/routes/conductor-configuracion.tsx) | 632 | Ajustes driver. |
| 18 | [apps/web/src/components/profile/AuthProvidersSection.tsx](apps/web/src/components/profile/AuthProvidersSection.tsx) | 621 | Switching de providers. |
| 19 | [apps/api/src/routes/trip-requests-v2.ts](apps/api/src/routes/trip-requests-v2.ts) | 609 | Shipper handlers v2. |
| 20 | [apps/api/src/routes/documentos.ts](apps/api/src/routes/documentos.ts) | 581 | Compliance vehic + cond. |

**Observación**: 8 de los 20 son **rutas frontend** (`apps/web/src/routes/*.tsx`) con > 600 LOC. El patrón de TanStack Router file-based + componentes inline en la misma ruta genera estos monolitos. Candidatos naturales a extraer en `components/<route>/` aparte. **Riesgo**: cobertura de tests por línea cae cuando una ruta hace 5 cosas distintas; pequeñas regresiones quedan invisibles.

---

## 7. Logic duplication: `matching-algorithm` (regresión AUDIT.md 2026-05-01)

**RESUELTO ✓**. La auditoría previa decía: _"apps/api/src/services/matching.ts implementó el algoritmo inline. El código pertenece aquí [package], no en services/. Duplicación y violación de principio CLAUDE.md."_

**Estado actual** verificado:

- `packages/matching-algorithm/src/` — 6 archivos:
  - `index.ts` (135 LOC) — exports: `MATCHING_CONFIG`, `scoreCandidate`, `scoreToInt`, `selectTopNCandidates`, types.
  - `factor-matching.ts` (195 LOC) — scoring v1 puro.
  - `v2/index.ts` + `v2/score-candidate.ts` (167 LOC) + `v2/select-top-n.ts` (45 LOC) + `v2/types.ts` (203 LOC) — multi-factor backhaul-aware (ADR-033).
- `apps/api/src/services/matching.ts:1-12` **importa**: `MATCHING_CONFIG, ScoredCandidate, ScoredCandidateV2, scoreCandidate, scoreCandidateV2, scoreToInt, scoreToIntV2, selectTopNCandidates, selectTopNCandidatesV2` desde `@booster-ai/matching-algorithm`. ✓
- Los archivos `matching-v2-lookups.ts` y `matching-v2-weights.ts` en services/ son orquestación (queries SQL + carga de pesos desde env) — no algoritmo. Separación legítima.

**Veredicto**: el principio "lógica en packages, orquestación en services" se cumple en matching. La regresión está cerrada.

---

## 8. Dead exports

**Bajo riesgo**, no auditable exhaustivamente sin tool de import-graph (`ts-prune`, `knip`, etc., no disponible en este entorno).

Heurística aplicada: `index.ts` de cada package que solo re-exporte tipos sin runtime → ninguno encontrado. Los stubs (§5) sí cuentan pero ya están listados.

**Acción recomendada**: añadir `knip` o `ts-prune` al pipeline `pnpm lint` para detectar exports muertos de forma sostenida.

---

## 9. Colocación de tests — drift en surfaces críticas

Sample de 10 archivos en `apps/api/src/` **sin sibling `.test.ts`** (no exhaustivo):

- [apps/api/src/routes/feature-flags.ts](apps/api/src/routes/feature-flags.ts) — endpoint público crítico (decide UI pre-login).
- [apps/api/src/routes/admin-cobra-hoy.ts](apps/api/src/routes/admin-cobra-hoy.ts) — admin platform, toca dinero (ADR-029/032).
- [apps/api/src/routes/me-clave-numerica.ts](apps/api/src/routes/me-clave-numerica.ts) — set/rotate clave auth universal (ADR-035, crítico).
- [apps/api/src/routes/admin-matching-backtest.ts](apps/api/src/routes/admin-matching-backtest.ts) — admin matching v2.
- [apps/api/src/routes/admin-seed.ts](apps/api/src/routes/admin-seed.ts) — seed/cleanup demo.
- [apps/api/src/services/matching-v2-weights.ts](apps/api/src/services/matching-v2-weights.ts) — carga pesos del algoritmo desde env (afecta ranking de carrier).
- [apps/api/src/services/estimar-distancia.ts](apps/api/src/services/estimar-distancia.ts) — distancia haversine (entra en pricing y emisiones).
- [apps/api/src/services/consent.ts](apps/api/src/services/consent.ts) — gates de consent stakeholder (ADR-028).
- [apps/api/src/services/emitir-certificado-viaje.ts](apps/api/src/services/emitir-certificado-viaje.ts) — KMS sign + GCS upload del certificado de huella.
- [apps/api/src/services/gemini-client.ts](apps/api/src/services/gemini-client.ts) — wrapper Vertex AI (toca billing + PII en prompts).

**Patrón**: las 5 surfaces de `routes/` sin test son admin/platform. Las de `services/` incluyen 4 que tocan **dinero o legales**: certificados, consent, distancia (entra en pricing), gemini (billing). La política CLAUDE.md ("Sin features sin tests, coverage 80%") está violada en estas surfaces — o existe el test en otro path (no colocado) o falta. Pasada 3 (test-quality) lo profundiza.

---

## 10. Naming bilingüe — CLEAN

- **TS code**: identificadores en English camelCase. Verificación en `apps/api/src/services/`: `estimarDistanciaKm`, `checkStakeholderConsent`, `resolveMatchingV2Weights`. Spanish aparece sólo como referencia a nombres de tabla SQL en strings (legítimo).
- **SQL DDL**: español snake_case sin tildes. Verificación en `apps/api/drizzle/0030_*`, `0033_*`: `nombre_legal`, `region_ambito`, `creado_por_email`, `creado_en`. CLEAN.

---

## Acciones recomendadas (priorizadas)

1. **HIGH** — Cerrar los 5 stubs de `packages/`: o se eliminan (delete + remover de `pnpm-workspace.yaml` + actualizar ADR como "deferred") o se implementan. Mantener el estado actual contradice CLAUDE.md §1.
2. **HIGH** — Añadir tests para las 4 surfaces sensibles sin colocación: `emitir-certificado-viaje.ts`, `consent.ts`, `gemini-client.ts`, `me-clave-numerica.ts`. Son auth + dinero + legal.
3. **MEDIUM** — Refactorizar las 3 rutas frontend > 1 000 LOC (`cargas.tsx`, `platform-admin.tsx`, `conductores.tsx`) extrayendo subcomponentes.
4. **MEDIUM** — Resolver los 4 `any` con `biome-ignore` + razón o tipo concreto.
5. **MEDIUM** — Crear GitHub issues para los 8 `// TODO` y linkearlos en el comentario.
6. **LOW** — Partir `apps/api/src/db/schema.ts` (2 159 LOC) por dominio (`schema/user.ts`, `schema/trip.ts`, etc.).
7. **LOW** — Resolver el bucle del hook drift-vocabulary con un waiver pre-aprobado para audits.
8. **LOW** — Añadir `knip` o `ts-prune` al CI para dead exports.

---

## Procedencia

- Subagente Explore con scope quality (Bash + rg, sin Read loops).
- `wc -l` de TS/TSX en `apps/`, `packages/` filtrando `*.test.*` y `node_modules`.
- `grep -rl "from '@booster-ai/<package>'"` para verificar importadores de stubs.
- `head` de archivos clave: `apps/api/src/services/matching.ts` (imports 1-12), `biome.json`.
- Hook agent-rigor PreToolUse bloqueó la grep de axis 4 — documentado.
