# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-05-16
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

---

## (b) PRs abiertos — exactamente 2

### [#164](https://github.com/boosterchile/booster-ai/pull/164) — `docs(spec): D11 stakeholder geo aggregations — cards + drill-down + ADR-033`

| Campo | Valor |
|---|---|
| Branch | `claude/spanish-greeting-pqMN2` |
| Creado | 2026-05-11 |
| Tipo | Spec-only (sin código de implementación, sin migration) |
| Estado | OPEN — pendiente review del PO antes de pasar a `/plan` y `/build` |
| Alcance | Sustituir mock data del skeleton stakeholder geo por agregaciones reales sobre `viajes` con **k-anonymity ≥ 5**. Tabla `zonas_stakeholder` (migration 0027), endpoints `GET /stakeholder/zonas` (cards 30d) + `GET /stakeholder/zonas/:slug/agregaciones` (drill-down), ruta web `/app/stakeholder/zonas/$slug`. 13 criterios de aceptación verificables. El título del PR menciona "ADR-033" como referencia futura (bounding boxes + ventana 30d), pero **el PR no contiene archivo ADR** — solo el spec. La asignación de número ADR sucede al entrar a `/plan` y `/build`. |
| Archivos | `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (nuevo, 136 líneas) |

**CI status** (último run 2026-05-11):

| Check | Workflow | Resultado |
|---|---|---|
| Install dependencies | CI | SUCCESS |
| Lint (Biome) | CI | SUCCESS |
| Typecheck (tsc) | CI | SUCCESS |
| Test + Coverage (≥80%) | CI | SUCCESS |
| Build | CI | SUCCESS |
| CI Success | CI | SUCCESS |
| Gitleaks secret scan | Security | SUCCESS |
| npm audit (HIGH+) | Security | SUCCESS |
| Trivy filesystem + config scan | Security | SUCCESS |
| CodeQL (javascript-typescript) | Security | SUCCESS |
| Generate SBOM | Security | SUCCESS |

→ **CI verde end-to-end**. Bloqueante = review humano + decisión sobre alcance.

### [#166](https://github.com/boosterchile/booster-ai/pull/166) — `docs(telemetry): Wave 3 v2 — preload CA root + ADR-033`

| Campo | Valor |
|---|---|
| Branch | `claude/sweet-brown-7fdf26` |
| Creado | 2026-05-12 |
| Tipo | Docs + ADR (telemetría Teltonika, distinto eje que las waves del plan de identidad) |
| Estado | OPEN — mergeable `UNSTABLE` (npm audit HIGH+ falla) |
| Alcance | Documenta el procedimiento validado en prod 2026-05-12 con Van Oosterwyk: cargar `ISRG Root X1` PEM al FMC150 vía FOTA **antes** del push cfg TLS. Sin este paso, firmware `04.01.00.Rev.08` no valida el chain Let's Encrypt y el handshake falla silenciosamente. 3 validaciones logradas: TLS 5061 vía `/proc/net/tcp6`, persistencia post-`cpureset`, failover DR ~2 min. Rollback SMS-MT documentado. |
| Archivos | `docs/adr/033-wave-3-tls-ca-preload-fmc150.md` (nuevo), `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md` (§0 + §4), `docs/runbooks/wave-2-3-deploy.md` (§5.2), `docs/handoff/2026-05-11-wave-3-incidente-rollback.md` (nuevo) |

**CI status** (último run 2026-05-12):

| Check | Workflow | Resultado |
|---|---|---|
| Install dependencies | CI | SUCCESS |
| Lint (Biome) | CI | SUCCESS |
| Typecheck (tsc) | CI | SUCCESS |
| Test + Coverage (≥80%) | CI | SUCCESS |
| Build | CI | SUCCESS |
| CI Success | CI | SUCCESS |
| Gitleaks secret scan | Security | SUCCESS |
| **npm audit (HIGH+)** | Security | **FAILURE** |
| Trivy filesystem + config scan | Security | SUCCESS |
| CodeQL (javascript-typescript) | Security | SUCCESS |
| Generate SBOM | Security | SUCCESS |

→ **Rebase sobre main** debería fijar `npm audit` (PR [#184](https://github.com/boosterchile/booster-ai/pull/184) bumpeó `@opentelemetry/*` a 0.218 cerrando los 4 HIGH del run).

**Colisión ADR-033 con `main`**: el archivo `docs/adr/033-wave-3-tls-ca-preload-fmc150.md` que trae #166 colisiona con `docs/adr/033-matching-algorithm-v2-multifactor-backhaul-aware.md` ya mergeado en main. **Fix planificado**: renumerar el ADR de #166 a **ADR-040** (siguiente libre tras 039) durante el rebase. PR #164 no aporta archivo ADR — solo referencia textualmente el número en el spec; no contribuye a esta colisión.

> **Nota housekeeping**: `main` ya arrastra colisiones históricas en 028 (`dual-source-data-model-teltonika-vs-maps` + `rbac-auth-firebase-multi-tenant-with-consent-grants`), 034 (`gcp-cost-efficiency-2026-05` + `stakeholder-organizations`) y 035 (`auth-universal-rut-clave-numerica` + `trl10-mantener-ha-recortar-ruido`). No se tocan retroactivamente (los hashes son referenciados externamente), pero a partir de ADR-040 se aplica la disciplina de "un número por archivo".

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
- **Demo Corfo** ejecutada 2026-05-18 con Wave 1 + auth universal listos.
- **Subdominio `demo.boosterchile.com`** operativo desde 2026-05-13 ([#206](https://github.com/boosterchile/booster-ai/pull/206)) — 4 personas click-to-enter sin formulario.
- **Issue [#194](https://github.com/boosterchile/booster-ai/issues/194)** (DR deploy) resuelto por [#210](https://github.com/boosterchile/booster-ai/pull/210) (habilitación DNS endpoint cluster DR).
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
