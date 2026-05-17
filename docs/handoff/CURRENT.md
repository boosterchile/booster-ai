# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-05-17 ~06:00 UTC (post D11 BUILD review formal — 12 PRs revisados, 1 mergeado, plan v1 BLOCKED, pivote Opción 2)
**Documento vivo**: este archivo refleja el estado en `main` al momento de la última actualización. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md)

---

## (a) Waves 1-6 — estado de merge

Las seis waves del plan de identidad universal + dashboard conductor están **completas y mergeadas en `main`**.

| Wave | Alcance | PRs mergeados | Fecha cierre |
|---|---|---|---|
| **Wave 1** | Conductor identity + split dashboard (`/app/conductor` vs `/app/conductor/configuracion`) + migration 0029 + sweep español neutro | [#179](https://github.com/boosterchile/booster-ai/pull/179), [#189](https://github.com/boosterchile/booster-ai/pull/189) (smoke script) | 2026-05-13 |
| **Wave 2** | Tests + sweep i18n argentinismos → neutro | Integrado en [#179](https://github.com/boosterchile/booster-ai/pull/179) (+24 specs) | 2026-05-13 |
| **Wave 3** | Stakeholder organizations + ADR-034 (entidad XOR con empresas, migrations 0030/0031) + zonas filtradas por región + UI miembros | [#180](https://github.com/boosterchile/booster-ai/pull/180) → [#198](https://github.com/boosterchile/booster-ai/pull/198) (reabierto), [#199](https://github.com/boosterchile/booster-ai/pull/199) (zonas), [#203](https://github.com/boosterchile/booster-ai/pull/203) (UI miembros) | 2026-05-13 |
| **Wave 4** | Auth universal RUT + clave numérica + ADR-035 (foundation → UI selector → rotación clave → activación flag) | [#181](https://github.com/boosterchile/booster-ai/pull/181) (foundation 1/3), [#185](https://github.com/boosterchile/booster-ai/pull/185) (UI 2/3), [#187](https://github.com/boosterchile/booster-ai/pull/187) (rotación 3/3), [#190](https://github.com/boosterchile/booster-ai/pull/190) (`AUTH_UNIVERSAL_V1_ACTIVATED=true` en prod) | 2026-05-13 |
| **Wave 5** | Wake-word "Oye Booster" foundation + ADR-036 — service stub, flag `WAKE_WORD_VOICE_ACTIVATED=false` | [#183](https://github.com/boosterchile/booster-ai/pull/183) (foundation 1/2). **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186)) cerrado sin merge** — wire real bloqueado por Picovoice (ver §c). | 2026-05-13 (foundation) |
| **Wave 6** | Research cultura conductor chileno + guion entrevistas (input para refinamientos UI y Wave 5) | [#182](https://github.com/boosterchile/booster-ai/pull/182) | 2026-05-13 |

**Soporte transversal mergeado el mismo día**:
- [#184](https://github.com/boosterchile/booster-ai/pull/184) — bump `@opentelemetry/*` a 0.218 (cierra 4 HIGH vulns, desbloquea `npm audit` en CI).
- [#191](https://github.com/boosterchile/booster-ai/pull/191) — GCP cost efficiency TRL 10 (right-sizing + log exclusion, ADR-034/035).
- [#192](https://github.com/boosterchile/booster-ai/pull/192) — handoff con orden de merge consolidado.

**Verificación**: `gh pr list --state merged --search "wave" --limit 50` (ejecutado 2026-05-16).

### Mergeados 2026-05-16 (post-handoff inicial)

- [#166](https://github.com/boosterchile/booster-ai/pull/166) (commit `b5d1f18`, 22:26 UTC) — `docs(telemetry): Wave 3 v2 — preload CA root + ADR-040`. Rebased sobre main, ADR renumerado de 033→040 por colisión con `033-matching-algorithm-v2`. `npm audit (HIGH+)` resuelto vía bump OpenTelemetry de #184. Files: `docs/adr/040-wave-3-tls-ca-preload-fmc150.md` (+90), `docs/handoff/2026-05-11-wave-3-incidente-rollback.md` (+180), `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md` (±37/2), `docs/runbooks/wave-2-3-deploy.md` (±24/2).
- [#226](https://github.com/boosterchile/booster-ai/pull/226) (commit `641288d`, 22:26 UTC) — `docs(handoff): snapshot CURRENT.md estado proyecto 2026-05-16` (primera versión de este documento, +130 líneas).
- [#227](https://github.com/boosterchile/booster-ai/pull/227) (commit `d5e2e06`, 22:34 UTC) — `docs(handoff): actualizar CURRENT.md post-merge #166 + #226`. Reduce el documento a 1 PR abierto (#164), agrega la sección "Mergeados 2026-05-16" y "Housekeeping ADRs", clarifica que #164 no contiene archivo ADR todavía (solo spec) y recomienda ADR-041.
- [#228](https://github.com/boosterchile/booster-ai/pull/228) (commit `fa03246`, 22:53 UTC) — `docs(runbooks): plantillas /goal v2 con lessons de la sesion 2026-05-16`. Añade `docs/runbooks/goal-templates.md` (+255 líneas) con los aprendizajes operativos del flujo `/goal` aplicado a esta sesión.
- [#229](https://github.com/boosterchile/booster-ai/pull/229) (commit `c8ce2a3`, 23:05 UTC) — `docs(handoff): refresh CURRENT.md post-merge #227 + #228`. Segunda iteración del documento aplicando Plan 1 v2 vía `/goal` (9 min, 12.6k tokens, 0 errores fácticos — validó las plantillas v2 en producción).
- [#164](https://github.com/boosterchile/booster-ai/pull/164) (commit `2429f86`, 23:14 UTC) — `docs(spec): D11 stakeholder geo aggregations — cards + drill-down + ADR-033`. Spec D11 formalizada en `main` tras 5 días en DRAFT. Habilita `/plan` y `/build` cuando el PO decida. Files: `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (+136 líneas).

### Mergeados 2026-05-16/17 (post-coverage batch)

Sesión nocturna dedicada a cobertura de tests por package + housekeeping.

| PR | SHA | UTC | Título | Files |
|---|---|---|---|---|
| [#230](https://github.com/boosterchile/booster-ai/pull/230) | `786a5b3` | 23:17 | `docs(handoff): cierre sesion 2026-05-16 — 0 PRs abiertos` | `docs/handoff/CURRENT.md` (+12/−34) |
| [#231](https://github.com/boosterchile/booster-ai/pull/231) | `94155fe` | 23:22 | `refactor(d11-spec): renumerar ADR-033→041 y migration 0027→0034` | `docs/specs/…-d11.md` (±8/8), `docs/handoff/CURRENT.md` (±3/6) |
| [#232](https://github.com/boosterchile/booster-ai/pull/232) | `48c3d04` | 23:52 | `chore(coverage): infra de coverage en 15 packages + floor baseline` | 15 × `vitest.config.ts` + 15 × `package.json` + `pnpm-lock.yaml` |
| [#233](https://github.com/boosterchile/booster-ai/pull/233) | `fa301d3` | 23:58 | `test(ui-tokens): cobertura 100/100/100/100` | `tokens.test.ts` (+207), `vitest.config.ts` (±5/9) |
| [#234](https://github.com/boosterchile/booster-ai/pull/234) | `96e10c5` | 00:07 | `test(logger): cobertura 93/92/100/93 — createLogger + redaction` | `createLogger.test.ts` (+129), `redaction.test.ts` (+52) |
| [#235](https://github.com/boosterchile/booster-ai/pull/235) | `4a758e6` | 00:13 | `test(config): cobertura 100/100/100/100 — parseEnv + 5 schemas` | `parseEnv.test.ts` + 5 × `schemas/*.test.ts` (+243 total) |
| [#236](https://github.com/boosterchile/booster-ai/pull/236) | `09dc62f` | 00:19 | `test(whatsapp-client): cobertura 95/91/86/97 — WhatsAppClient HTTP` | `client.test.ts` (+156) |
| [#237](https://github.com/boosterchile/booster-ai/pull/237) | `5bd0228` | 00:39 | `test(certificate-generator): cobertura 97.82/80.15/100/97.82` | 5 × test (`ca-self-signed`, `emitir-certificado`, `firmar-kms`, `firmar-pades`, `storage`) + ajuste `generar-pdf-base.test.ts` (+734) |
| [#238](https://github.com/boosterchile/booster-ai/pull/238) | `ba0ee10` | 00:50 | `test(shared-schemas): cobertura 98.53/87.5/94.11/98.52` | `all-schemas.test.ts` (+428) |
| [#239](https://github.com/boosterchile/booster-ai/pull/239) | `756e9b4` | 01:06 | `fix(certificate-generator): CO2e ASCII en section title (subscript crash)` | `generar-pdf-base.ts` (±7/2), `generar-pdf-base.test.ts` (+34) — fix de bug descubierto en #237 + regression test (cert-gen subió a 99.63/82.53/100/99.63) |
| [#240](https://github.com/boosterchile/booster-ai/pull/240) | `a1419a2` | 01:18 | `docs(runbooks): sanity check zero anti-Stop-hook-loop` | `goal-templates.md` (±16/2) |
| [#241](https://github.com/boosterchile/booster-ai/pull/241) | `def7e64` | 01:46 | `docs(handoff): refresh CURRENT.md post-coverage batch` | `docs/handoff/CURRENT.md` (+23/−2) |
| [#242](https://github.com/boosterchile/booster-ai/pull/242) | `21a3d37` | 02:15 | `docs(runbooks): terse post-abort en sanity check zero` | `goal-templates.md` (±3/1) |
| [#243](https://github.com/boosterchile/booster-ai/pull/243) | `69534d3` | 02:21 | `docs(runbooks): embeber terse-post-abort en /goal text de Plans 3-5` | `goal-templates.md` (+10/0) |

**Resultado coverage**: los 15 packages no-stub pasan **≥80/80/80/80** (statements/branches/functions/lines). Lowest: certificate-generator branches=80.15%. Stubs (`ai-provider`, `carta-porte-generator`, `document-indexer`, `trip-state-machine`, `ui-components`) siguen exemptados hasta tener lógica real (PO-aprobado).

---

## (b) PRs abiertos — 9 (D11 BUILD review formal)

D11 BUILD ejecutado autónomamente vía `/goal` el 2026-05-17 (12 tasks DONE, ~$5-10 USD). Review formal con sub-agentes (`code-reviewer`, `devils-advocate`, `security-auditor`, `ux-designer`) reveló **bugs CRITICAL de privacy + violación de contrato agent-rigor + LOC waivers excedidos 2-3×**. Plan v1 BLOCKED, pivote a Opción 2 (`originComunaCode` mapping).

| PR | Task | Status |
|---|---|---|
| [#246](https://github.com/boosterchile/booster-ai/pull/246) | T1 ADR-041 | SUPERSEDE — pendiente ADR-042 |
| [#247](https://github.com/boosterchile/booster-ai/pull/247) | T2 Zod+Drizzle | REQUEST_CHANGES — `numeric` ↔ `z.number()` mismatch |
| [#249](https://github.com/boosterchile/booster-ai/pull/249) | T4 k-anonymity | REQUEST_FIX privacy CRITICAL |
| [#250](https://github.com/boosterchile/booster-ai/pull/250) | T5 hora+pico | REQUEST_CHANGES naming + k-anon |
| [#251](https://github.com/boosterchile/booster-ai/pull/251) | T6 tipo+combustible | MERGE post-T5 fix |
| [#252](https://github.com/boosterchile/booster-ai/pull/252) | T7 puntoEnBoundingBox | REQUEST_CHANGES NaN |
| [#253](https://github.com/boosterchile/booster-ai/pull/253) | T8 abort doc | OPEN — reset a abort-doc-only (`7b2a18e`) |
| [#255](https://github.com/boosterchile/booster-ai/pull/255) | T10 UI drill-down | REQUEST_CHANGES blocked-by-T9-v2 |
| [#256](https://github.com/boosterchile/booster-ai/pull/256) | T11 UI cards | REQUEST_CHANGES + SPLIT blocked-by-T8-v2 |
| [#257](https://github.com/boosterchile/booster-ai/pull/257) | T12 perf | REVERT_DONE_MARK — test tautológico |

**Cerrados sin merge**: #254 (T9, REJECT — privacy bugs heredados).

**Mergeado**: #248 (T3 migration zonas_stakeholder + seed, commit `2843e69`).

**Hallazgos sistémicos**:
1. Helper k-anonymity (#249) tiene 1 CRITICAL (quasi-identifier strings leak) + 3 HIGH. Es el ÚNICO control técnico privacy → prioridad #1.
2. Schema drift `domain/` ↔ `db/`: `domain/trip.ts` tiene state values en inglés (`delivered`, etc.); `db/schema.ts` divergió a español (`entregado`). ADR-042 resolverá.
3. "DONE" sin evidencia: T8 marcado DONE auto-resolviendo abort, T12 marcado DONE con test placeholder tautológico.

**Trazabilidad**: [`docs/handoff/2026-05-17-d11-review-plan.md`](2026-05-17-d11-review-plan.md) + comments en GitHub por PR.

---

## Housekeeping ADRs

**D11 numeración ya alineada con `main`**: el spec en `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` referencia **ADR-041** y **migration 0034** (siguientes libres). El título del PR original #164 menciona "ADR-033" — quedó como artefacto histórico del merge commit, sin impacto en el contenido del spec.

`main` arrastra colisiones históricas de numeración ADR en 028 (`dual-source-data-model-teltonika-vs-maps` + `rbac-auth-firebase-multi-tenant-with-consent-grants`), 034 (`gcp-cost-efficiency-2026-05` + `stakeholder-organizations`) y 035 (`auth-universal-rut-clave-numerica` + `trl10-mantener-ha-recortar-ruido`). No se tocan retroactivamente (los hashes son referenciados externamente). A partir de **ADR-040** se aplica la disciplina de "un número por archivo".

---

## (c) Blockers vigentes

### Picovoice approval

- **Estado**: PENDIENTE. Consola Picovoice respondió *"Thank you for your interest. Our team will review it shortly."* — sin ETA comprometido por el vendor.
- **Cuenta**: creada por Felipe (`dev@boosterchile.com`).
- **Bloquea**:
  - Acceso al modelo custom `oye-booster-cl.ppn` (entrenamiento del wake-word).
  - Provisión de `PICOVOICE_ACCESS_KEY` (Secret Manager + variable Cloud Run).
  - Wire real en `apps/web/src/services/wake-word.ts` (reemplazar `StubWakeWordController` por `PorcupineWakeWordController`).
  - Activación del flag `WAKE_WORD_VOICE_ACTIVATED=true` en prod.
- **Estado UI**: foundation Wave 5 ([#183](https://github.com/boosterchile/booster-ai/pull/183)) mergeado con UI inerte (flag OFF por default). Cero impacto visible para usuarios.
- **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186))** cerrado sin merge — se rehará cuando la approval llegue y el modelo esté disponible.

### Samples de voz Van Oosterwyk

- **Estado**: PENDIENTE coordinación con cliente.
- **Requerimiento**: 3 conductores reales × ~5 min de audio limpio cada uno, idealmente distribución regional:
  - 1 norteño (Antofagasta / Iquique)
  - 1 centro (RM / V Región)
  - 1 sureño (Bío Bío hacia el sur)
- **Pipeline**: subida al training pipeline de Picovoice → ~24h training → output `oye-booster-cl.ppn` (~50 KB) → commit a `apps/web/public/wake-word/`.
- **Dependencia mutua con Picovoice approval**: el upload de samples requiere acceso al Console post-approval. Los dos bloqueantes están encadenados.
- **ETA conjunto realista**: ~1 semana desde el momento en que llegue approval + samples estén grabados.

---

## Apuntadores rápidos

- **Auth universal activo en prod** desde 2026-05-13 ([#190](https://github.com/boosterchile/booster-ai/pull/190)): `app.boosterchile.com` muestra selector RUT + clave numérica. Usuarios legacy (Google / email+password) ven `<RotarClaveModal/>` bloqueante en próximo login.
- **Demo Corfo** agendada para lunes 2026-05-18 con Wave 1 + auth universal listos (hoy es 2026-05-16, faltan 2 días).
- **Subdominio `demo.boosterchile.com`** operativo desde 2026-05-13 ([#206](https://github.com/boosterchile/booster-ai/pull/206)) — 4 personas click-to-enter sin formulario.
- **Issue [#194](https://github.com/boosterchile/booster-ai/issues/194)** (DR deploy) resuelto por [#210](https://github.com/boosterchile/booster-ai/pull/210) (habilitación DNS endpoint cluster DR).
- **Coverage gate activo en CI desde 2026-05-16** ([#232](https://github.com/boosterchile/booster-ai/pull/232)): cada `packages/*` no-stub emite `coverage-summary.json` y vitest enforza thresholds 80/80/80/80 in-config. El bash gate del workflow CI valida los summaries y bloquea merge si alguno cae bajo umbral. Esto cierra el hueco de "CI silenciosamente pasa porque ningún package emite cobertura".
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
