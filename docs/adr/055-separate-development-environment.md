# ADR-055: Entorno de desarrollo separado de producción (proyecto Firebase/GCP de dev)

- **Status**: **DRAFT** (2026-06-03). **NO Accepted.** Pendiente de resolver las 4 decisiones abiertas (§Open Questions) antes de transición a `Proposed`/`Accepted`. Ninguna ejecución cloud realizada — este documento es solo definición.
- **Date**: 2026-06-03
- **Deciders**: Felipe Vicencio (PO)
- **Linked**:
  - Spec: [`.specs/dev-environment-separation/spec.md`](../../.specs/dev-environment-separation/spec.md) (Draft — plantea las 4 OQ sin resolverlas)
  - Origen: integración de Firebase App Check (rama `feat/app-check`), donde se intentó configurar el dev local y se descubrió que apuntaba a prod.
  - Relacionado: backlog `#STAGING-ENV` (CLAUDE.md §Deploy — "No existe entorno staging … requiere un 2º GCP project con infra paralela"). Mismo patrón de raíz: un solo proyecto GCP.
  - Hilo abierto separado (NO se cierra acá): verificación gitleaks Firebase key — ver §"Hilo gitleaks abierto" al final.

## Context

### Problema (hallazgo de esta sesión, 2026-06-03)

Al configurar el entorno local del web app (`apps/web`) para Firebase App Check, se completó `apps/web/.env.local` con los valores del deploy de **producción** (`deploy-phase-2.sh` + `cloudbuild.production.yaml`):

- `VITE_API_URL=https://api.boosterchile.com` → el dev local pega al **backend real de prod**.
- `VITE_FIREBASE_*` → proyecto Firebase **`booster-ai-494222` (prod)**: Auth, Firestore, Storage reales.

**Riesgo concreto**: un seed, un test E2E, o un borrado ejecutado en local impacta **datos productivos reales** (cuentas, viajes, documentos). No hay aislamiento. El `.env.local` ya fue revertido (no apunta a prod) como mitigación inmediata; este ADR define la solución estructural.

### Estado verificado de la infraestructura (gcloud read-only, 2026-06-03)

- **Infra flat single-project**: `infrastructure/*.tf` describe **únicamente** `booster-ai-494222`. **NO existen** `infrastructure/environments/dev/`, `.../staging/`, `.../prod/` ni Terraform workspaces.
- ⚠️ **Discrepancia CLAUDE.md-vs-realidad**: tanto el CLAUDE.md raíz (estructura del repo) como `infrastructure/` referencian `environments/{dev,staging,prod}/`. **Eso no refleja la realidad**: la infra es un set plano de `.tf` sin separación por entorno. Esta discrepancia debe corregirse en la documentación al resolver este ADR (o registrarse como deuda documental conocida).
- **Org**: `boosterchile.com` (ID `435506363892`).
- **Billing**: cuenta `019461-C73CDE-DCE377` (abierta) — **la misma que paga prod**. Un proyecto de dev facturaría contra ella salvo decisión contraria.
- **Proyectos GCP accesibles**: solo `booster-ai-494222` (Booster AI / prod) y `gen-lang-client-...` (Default Gemini). **No hay proyecto de dev.**

## Decision (DRAFT — dirección, no resolución)

**Separar el entorno de desarrollo del de producción mediante un proyecto Firebase/GCP de dev dedicado.** El PO eligió esta dirección (vs. Firebase Emulator Suite y vs. no construir) el 2026-06-03.

La **forma concreta** queda pendiente de las 4 decisiones abiertas. Este ADR **no se da por Accepted** hasta resolverlas y, recién entonces, la ejecución se planifica decisión por decisión en sesiones futuras con la consola GCP al frente.

## Open Questions (a resolver — NO resueltas en esta sesión)

| # | Pregunta | Notas |
|---|---|---|
| **a** | **Nombre/ID del proyecto de dev** | ¿`booster-ai-dev`? Confirmar convención y disponibilidad del ID en GCP. |
| **b** | **Estructura Terraform** | Refactor del flat actual. Opciones: (1) módulo reutilizable + `environments/{dev,prod}/` que lo instancian; (2) Terraform workspaces; (3) tfvars por entorno sobre la misma config. Decisión de diseño no trivial — impacta todo `infrastructure/`. |
| **c** | **Alcance de réplica** | ¿Replicar **todo** prod (telemetría IoT, DR region, monitoring, k8s, org-policies) o un **subset mínimo** para desarrollo del web app (Identity Platform/Auth + Firestore + Cloud Run del API)? Define coste y esfuerzo. |
| **d** | **División de labor cloud** | Qué se scriptea en Terraform/gcloud (reproducible) vs. qué corre el PO manualmente en consola por permisos de org/billing. Ver acciones gated abajo. |

### Acciones irreversibles-ish / con permisos de org/billing (requieren autorización explícita del PO — NO se ejecutan en esta sesión)

- `gcloud projects create <id>` (creación de proyecto bajo la org).
- Linkear billing account `019461-C73CDE-DCE377` (o una nueva) al proyecto.
- Habilitar Firebase + Identity Platform + APIs requeridas en el proyecto de dev.
- Configurar IAM y org-policies del proyecto de dev.
- Crear una **site key reCAPTCHA v3 nueva** registrada para App Check del proyecto Firebase de dev (la actual `6Lc5Bwot…` es de prod).

## Consequences

### Positivas
- Aislamiento real: seeds/tests/borrados en local dejan de poder tocar datos de prod.
- Camino para resolver también `#STAGING-ENV` con el mismo refactor multi-proyecto de Terraform.
- Corrige la discrepancia CLAUDE.md-vs-realidad sobre `environments/`.

### Negativas / costes
- **Coste cloud recurrente** de un 2º proyecto facturando.
- Esfuerzo de infra (refactor Terraform flat → multi-proyecto) de varias sesiones.
- Mantenimiento de paridad dev↔prod (drift de config entre entornos).

### Alternativas consideradas y descartadas en esta decisión
- **Firebase Emulator Suite** (emuladores locales de Auth/Firestore + API local, sin coste cloud). Descartada por el PO en favor de un proyecto real; queda como fallback si el coste/effort del proyecto dev resulta prohibitivo.
- **No construir** (seguir sin dev, `.env.local` revertido). Descartada: el riesgo de tocar prod desde local es inaceptable a mediano plazo.

## Hilo gitleaks abierto (SEPARADO de este ADR — no se cierra acá)

Registrado para no perderlo en el pivote a este epic:

- La **Firebase web key** (`2bcd204b`, prod) tiene `browserKeyRestrictions: {}` — **ninguna restricción a nivel de key**. Su seguridad depende de **App Check enforcement + Firebase Security Rules**, que **NO se verificaron aún en Firebase Console**.
- La **Maps key** (`eb016256`) **sí** quedó verificada: referrer restringido a `https://app.boosterchile.com/*`.
- El **allowlist de las claves `AIza…` en `.gitleaks.toml` sigue PENDIENTE** de la verificación de App Check + Rules. Los 2 falsos positivos verdes (fixtures logger + región GCP) están en un stash (`stash@{0}` sobre `chore/working-tree-hygiene`), sin commitear, esperando cerrar la decisión Firebase para un solo commit limpio.

Este ítem es **tema separado** del entorno dev y no se resuelve con este ADR.
