# Spec — Entorno de desarrollo separado de producción

**Feature slug**: `dev-environment-separation`
**Fase**: DEFINE (Draft)
**Fecha**: 2026-06-03
**ADR**: [`docs/adr/055-separate-development-environment.md`](../../docs/adr/055-separate-development-environment.md) (DRAFT)
**Estado**: **Definición pura.** Ninguna ejecución cloud. Las 4 decisiones abiertas se **plantean**, no se resuelven, en este documento.

## 1. Objetivo

Aislar el entorno de desarrollo del de producción para que el trabajo local
(`apps/web` + `apps/api`) no pueda tocar datos productivos reales. La dirección
elegida por el PO es un **proyecto Firebase/GCP de dev dedicado**.

## 2. Por qué ahora

Hallazgo 2026-06-03 (durante la integración de App Check): el `apps/web/.env.local`
se completó con credenciales de **prod** (`booster-ai-494222` + `https://api.boosterchile.com`).
Un seed/test/borrado local impactaba **datos reales de prod**. `.env.local` ya fue
revertido como mitigación; falta la solución estructural.

## 3. Estado verificado (gcloud read-only, 2026-06-03)

- Infra **flat single-project**: `infrastructure/*.tf` describe solo `booster-ai-494222`.
  **No existen** `environments/{dev,staging,prod}/` ni workspaces.
- ⚠️ **Discrepancia CLAUDE.md-vs-realidad**: CLAUDE.md + `infrastructure/` mencionan
  `environments/{dev,staging,prod}/`, pero no existen. Corregir al resolver el ADR.
- Org `boosterchile.com` (`435506363892`); billing `019461-C73CDE-DCE377` (la misma de prod).
- No hay proyecto GCP de dev.

## 4. Decisiones ABIERTAS (a resolver — NO se resuelven en esta sesión)

> Estas son **preguntas**, no conclusiones. Cada una se cierra en sesión futura con
> la consola GCP al frente y autorización explícita del PO.

### a) Nombre/ID del proyecto de dev
- ¿`booster-ai-dev`? Confirmar convención de naming y disponibilidad del project ID en la org.

### b) Estructura Terraform (refactor del flat actual — diseño no trivial)
- **Opción 1**: módulo reutilizable + `environments/{dev,prod}/` que lo instancian con vars distintas.
- **Opción 2**: Terraform **workspaces** sobre la config actual.
- **Opción 3**: **tfvars por entorno** sobre la misma config plana.
- Impacta **todo** `infrastructure/`. Requiere su propio mini-ADR o sección de decisión.

### c) Alcance de réplica
- **Todo prod**: telemetría IoT, DR region, monitoring, k8s, org-policies, etc.
- **Subset mínimo** para desarrollo del web app: Identity Platform/Auth + Firestore + Cloud Run del API.
- Define coste recurrente y esfuerzo de la primera entrega.

### d) División de labor cloud
- Qué se **scriptea** (Terraform/gcloud, reproducible) vs. qué corre **el PO en consola**
  por permisos de org/billing.
- **Acciones irreversibles-ish / gated** (requieren autorización explícita; **NO se ejecutan en esta sesión**):
  - `gcloud projects create <id>`
  - Linkear billing account al proyecto
  - Habilitar Firebase + Identity Platform + APIs
  - Configurar IAM + org-policies del proyecto dev
  - Crear **site key reCAPTCHA v3 nueva** para App Check del Firebase de dev (la actual `6Lc5Bwot…` es de prod)

## 5. Fuera de alcance (de esta fase DEFINE)

- Cualquier ejecución cloud (crear proyecto, billing, IAM, habilitar APIs).
- Refactor de Terraform.
- Resolver las 4 OQ.
- App Check enforcement (lo decide/ejecuta el PO aparte).

## 6. Dependencias / hilos relacionados

- **Hilo gitleaks abierto** (separado, no se cierra con este epic): la Firebase web key
  `2bcd204b` (prod) tiene `browserKeyRestrictions: {}`; su seguridad depende de App Check +
  Security Rules **aún no verificadas**. Allowlist `AIza…` en `.gitleaks.toml` **pendiente**
  (verdes en `stash@{0}`). Ver ADR-055 §"Hilo gitleaks abierto".
- **App Check** (`feat/app-check`): la integración de cliente ya está; el dev real de App Check
  necesitará la site key de dev (OQ-d).
- **`#STAGING-ENV`**: el refactor Terraform de la OQ-b resuelve también la raíz de staging.

## 7. Criterios de éxito de esta fase DEFINE (cumplidos)

- [x] ADR-055 escrito como DRAFT (no Accepted) con contexto, estado verificado y discrepancia documentada.
- [x] Las 4 decisiones planteadas como OQ sin resolver.
- [x] Acciones gated listadas como no-ejecutables en esta sesión.
- [x] Hilo gitleaks cruzado para no perderlo.
- [x] Cero cambios cloud.

## 8. Próximo paso (sesión futura)

Resolver OQ-a (naming) y OQ-c (alcance) primero — son las que desbloquean OQ-b (estructura TF)
y OQ-d (labor). Recién con eso, plan de ejecución decisión-por-decisión.
