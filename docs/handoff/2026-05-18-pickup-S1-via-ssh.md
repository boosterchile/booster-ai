# Pickup S1 vía SSH desde otro device — 2026-05-18

**Contexto**: Sprint S0 production-readiness **cerrado** en sesión 2026-05-17/18 (12 PRs mergeados, ver [`docs/handoff/CURRENT.md`](./CURRENT.md) §"Sprint S0 production-readiness — CERRADO"). El PO continúa el trabajo desde otro device vía SSH.

Este doc lista lo necesario para retomar **S1** (drift implementación + branches coverage + 4 Playwright + sharding + a11y) sin pérdida de contexto.

---

## 1. Estado de main (verificado al cierre de S0)

- `main` HEAD: `971eaa1 docs(handoff): CURRENT.md wrap final sprint S0 cerrado (T11 of S0) (#289)`
- Working tree: clean
- `main` ↔ `github/main`: en sync (ahead/behind 0/0)
- 12 PRs S0 mergeados: tabla completa en `CURRENT.md`
- Todos los specs aprobados y commiteados en repo

---

## 2. Setup en el device nuevo (post-SSH)

### 2.1 Clone o pull

Si es **clone nuevo**:

```bash
gh repo clone boosterchile/booster-ai
cd booster-ai
```

Si ya tienes el repo, **pull main**:

```bash
git switch main
git pull github main  # remote `github` es el canónico; `origin` (GitLab) está obsoleto
```

### 2.2 Toolchain

Verificar:

```bash
node --version  # >= 22 (NVM pin .nvmrc); este Mac local tiene 24.13.0 funcional
pnpm --version  # = 9.15.4 (packageManager pin)
```

Si falta algo:

```bash
# nvm + node 22
nvm install 22 && nvm use

# pnpm via corepack
corepack enable && corepack prepare pnpm@9.15.4 --activate
```

### 2.3 Instalación de deps

```bash
pnpm install --frozen-lockfile
```

### 2.4 Dependencias externas (binarios)

```bash
# k6 (load testing — S0 T8 introducido, S1 NO lo usa; instalar igual para no bloquear S8 después)
brew install k6

# gitleaks (pre-commit hook — opcional pero hook warn si falta)
brew install gitleaks

# Postgres 16 (REQUERIDO para integration tests de S1)
brew install postgresql@16
brew services start postgresql@16

# Verificar postgres corre
pg_isready -h localhost  # esperar "accepting connections"
```

### 2.5 Base de datos local para integration tests (S1 la usa)

Los integration tests de `apps/api` (PR #271/#272 ya mergeados) usan una base local `booster_test_prototype` que se crea/recrea por `globalSetup`. Verificar:

```bash
# Postgres debe tener un user que pueda CREATE DATABASE
psql -h localhost -U $USER -d postgres -c '\l' | head -10

# Si tu user de macOS local NO tiene perms, crear uno:
# createuser -h localhost --superuser <tu-usuario-mac>
```

### 2.6 Credenciales

`.env` files (de prod/staging) **NO se sincronizan via git**. Si necesitas correr `apps/api` contra GCP local:

- Pedir/copiar `apps/api/.env` desde este Mac al MacBook nuevo (scp manual).
- O usar el ADC con `gcloud auth application-default login` (recomendado, sin keys descargadas).

Para S1 **NO se necesita** GCP — los integration tests corren contra Postgres local sin nube.

---

## 3. Archivos privados que NO están en git

| Archivo | Tamaño | Razón |
|---|---|---|
| `.private/piloto-prospects.md` | 6 KB | Shortlist 5+5 prospects piloto, info comercial sensible (decisión OQ-S0.1 resuelta) |

**Cómo transferir al MacBook nuevo** (si necesitas continuar el outreach desde allá):

```bash
# Desde este Mac (origen):
scp .private/piloto-prospects.md user@macbook:~/booster-ai/.private/piloto-prospects.md

# O via 1Password / cualquier vault seguro tuyo.
```

Si no transfieres y necesitas la shortlist, se puede regenerar desde `docs/handoff/2026-05-18-piloto-outreach.md` (stub público con categorías + criterios fit) — perderás solo los scores/contactos específicos.

---

## 4. Acciones PO pendientes (ejecutables desde cualquier device)

Estas 4 acciones son **lane externa** del sprint S0 cerrado y NO requieren código:

1. **Enviar RFP GLEC** (template en [`docs/compliance/glec-rfp.md`](../compliance/glec-rfp.md) §7.2) a:
   - SGS Chile, Bureau Veritas Chile, DNV LATAM
2. **Enviar RFP pentest** (template en [`docs/audits/security-rfp.md`](../audits/security-rfp.md) §7.2) a:
   - 1 vendor por categoría (Global EMEA / Boutique LATAM / Pentest-as-a-Service)
3. **Dry-run + envíos piloto** desde `.private/piloto-prospects.md` (si lo transfieres al MacBook) usando el template del mismo doc.
4. **Decidir OQ-S0.3**: qué hacer con remote `origin` (GitLab obsoleto). Opciones: (a) reapuntar `origin` a GitHub, (b) eliminar `origin`, (c) dejar como mirror pasivo.

Cada acción es independiente; no bloquean S1 si no las haces ya.

---

## 5. Cómo arrancar S1 desde el MacBook

### 5.1 Contexto necesario (leer antes de empezar)

1. [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) §"Sprint 1 — Cierre de deuda visible parte 1: drift + coverage + e2e crítico" — scope detallado.
2. [`docs/adr/043-drift-schema-domain.md`](../adr/043-drift-schema-domain.md) — metodología que S1 ejecuta.
3. [`.specs/stubs-decision/spec.md`](../../.specs/stubs-decision/spec.md) — decisión de `packages/trip-state-machine` (promoción en S1 según sub-spec).
4. [`docs/handoff/CURRENT.md`](./CURRENT.md) §"Pickup point S1" — checklist concreto.

### 5.2 Scope S1 (del roadmap maestro)

| Item | Detalle |
|---|---|
| Aplicar **ADR-043** | Inventario completo divergencias (script grep + clasificación A/B/C) + migration breaking-safe + refactor consumers Clase A |
| Implementar `packages/trip-state-machine` | XState v5; estados desde `db/schema.ts` `tripStatusEnum` (español); cubre `packages/trip-state-machine` stub de `stubs-decision` |
| Subir branches coverage `apps/api` | Hoy 75.01% → target 80%. Foco en error paths (4xx/5xx, validation failures, race conditions) |
| 4 specs Playwright críticos en CI por PR | `shipper-publica-carga`, `carrier-acepta-oferta`, `login-universal-rut-clave-numerica`, `public-tracking-via-link` |
| Sharding Playwright + path-filter en `ci.yml` | Cubre SC-29 (≤10 min p95 CI por PR) |
| a11y axe-core en cada Playwright | 0 violations P0/P1 al merge |

**Cubre SCs maestros**: SC-2, SC-4, SC-15 (parcial 4/8), SC-16 (parcial), SC-29.

### 5.3 Workflow recomendado al iniciar S1

1. Asumir contrato agent-rigor (los hooks en `.claude/` están configurados localmente; verificar que el plugin `agent-rigor` esté instalado en Claude Code en el MacBook).
2. `/spec s1-drift-coverage-e2e` — produce `.specs/s1-drift-coverage-e2e/spec.md` siguiendo skill 11.
3. devils-advocate sobre el spec (obligatorio solo-dev mode).
4. Aprobar spec con cambios si aplica.
5. `/plan` — produce `.specs/s1-drift-coverage-e2e/plan.md` con tareas atómicas.
6. devils-advocate sobre el plan.
7. Aprobar plan.
8. `/build` — ejecutar tarea por tarea siguiendo skill 30.

Cooling-off recomendado (skill 20 §Solo-Developer Adaptation): re-leer el roadmap §S1 con ojos frescos antes de iniciar.

---

## 6. Mensaje inicial para arrancar la sesión en el MacBook

Sugerencia de prompt para abrir nueva sesión Claude Code en el MacBook:

```
Continuamos production-readiness desde Sprint S0 cerrado (ver
docs/handoff/CURRENT.md §"Sprint S0 production-readiness — CERRADO"
y docs/handoff/2026-05-18-pickup-S1-via-ssh.md).

Quiero arrancar Sprint S1 (drift implementación + branches coverage +
4 Playwright críticos + sharding + a11y) siguiendo el roadmap §S1.

Antes de spec del sprint, lee:
- CLAUDE.md raíz
- .specs/production-readiness/roadmap.md §"Sprint 1"
- docs/adr/043-drift-schema-domain.md
- .specs/stubs-decision/spec.md §packages stub (trip-state-machine en S1)

Después produce .specs/s1-drift-coverage-e2e/spec.md con devils-advocate
obligatorio antes de pedirme aprobación.
```

---

## 7. Verificación pre-arranque S1 (checklist)

Antes de invocar `/spec`:

- [ ] `pnpm install` exitoso en el MacBook.
- [ ] `pg_isready -h localhost` ok.
- [ ] `pnpm typecheck` (root) exitoso.
- [ ] `pnpm lint` exitoso (0 errores; warnings legacy aceptados).
- [ ] `pnpm --filter @booster-ai/api test:integration` exitoso (verifica que la infra T1+T2 funciona en el nuevo device).
- [ ] `node scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` → exit 0.
- [ ] (opcional) `.private/piloto-prospects.md` transferido si vas a continuar outreach.

Si cualquier check falla, troubleshoot antes de S1.

---

## 8. Branches locales obsoletas (limpieza opcional)

Este Mac tiene ~160 branches locales (histórico de waves 1-6 y sprint S0). Todas las del sprint S0 (`chore/s0-*`) ya están mergeadas via squash → seguras de borrar.

**Comando seguro** (solo borra las que ya están mergeadas en `github/main`):

```bash
git branch --merged github/main | grep -v '^\*\|^[[:space:]]*main$' | xargs -I {} git branch -d {}
```

**NO ejecutar** `git branch -D` (force delete) salvo que sepas qué estás haciendo — algunas branches locales pueden tener trabajo no mergeado todavía.

En el MacBook nuevo (clone fresco) esto no aplica.

---

## 9. Recordatorios contractuales (agent-rigor)

- Cada cambio multi-archivo o que toque `main` sigue ciclo `/spec` → `/plan` → `/build` → `/test` → `/review` → `/ship`.
- Solo-dev mode: cooling-off 30 min obligatorio entre BUILD y REVIEW (hook `Stop` lo verifica).
- Devils-advocate obligatorio en `/spec`, `/plan` (cuando aplique), `/review`, `/ship`.
- **Vocabulario prohibido** (CLAUDE.md §4): la lista completa de palabras-trigger está en `CLAUDE.md` raíz §4. Si necesitas citar alguna de ellas didácticamente, envolver el match en <quote>...</quote> tags.
- Pre-commit hooks (gitleaks + biome + check-adr-numbering) NO se debilitan.
- Coverage gate 80/80/80/80 (líneas/funciones/statements + branches 75% mínimo CI).

---

## 10. Decision log

- **2026-05-18** — Handoff producido al cierre de sesión post-Sprint S0. PO continúa desde MacBook vía SSH. Todo el trabajo de S0 está en `main`; pickup point claro en S1.
