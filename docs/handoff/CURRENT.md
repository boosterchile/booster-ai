# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-05-16 23:15 UTC (post-merges #166 + #226 + #227 + #228 + #229 + #164 — sesión completa cerrada con 0 PRs abiertos)
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

---

## (b) PRs abiertos — 0

**Repo cerrado**: sin PRs pendientes a 2026-05-16 23:15 UTC. Próximo trabajo arranca con `/spec` (nueva feature) o `/plan` (D11 si el PO decide avanzar).

---

## Housekeeping para D11 (próximo `/plan`)

La spec D11 (#164) entró a `main` con dos referencias numéricas que **ya están tomadas** y deben reasignarse al entrar a `/plan`:

- **ADR-033** mencionado en el título del spec → reasignar a **ADR-041** (siguiente libre tras 040). ADR-033 está tomado por `033-matching-algorithm-v2-multifactor-backhaul-aware.md`.
- **Migration 0027** mencionada en el spec → reasignar a **0034** (siguiente libre tras 0033 site-settings). Migration 0027 está tomada por `0027_matching_backtest_runs.sql`.

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
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
