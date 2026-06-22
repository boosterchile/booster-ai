# inc-2026-06-19-followups — Execution Plan

**Generado por**: skill `arquitecto-maestro` v1.1.0
**Fecha**: 2026-06-19
**Status**: ✅ **EJECUTADO (2026-06-22)** — el PO aprobó al fijar el goal "fortalecer
el secret manager para que no me solicite nuevamente autenticaciones por falta de
password o token". Open questions resueltas por el goal: **A7** = sí, con el flag
`content_sid_ready` por-secret (preventivo); **A5** = gate en `terraform-drift.yml`;
**ADR** = no formal, documentado en runbook + comentarios. A5/A6/A7/A3 implementados;
`terraform validate`/`fmt` OK; repo-checks 111 passed. La limpieza de ramas locales
(§7.6) NO aplica en este entorno.

## 1. Objective

Cerrar los action items del post-mortem **INC-2026-06-19** (placeholder `content-sid` montado en `service_api` → startup probe falla → deploys bloqueados):

- **A5** — cablear el preflight `check-validated-secret-placeholders.mjs` como **gate** (CI + pre-apply).
- **A3** — establecer la disciplina de **terraform apply scoped** (runbook).
- **A6** — corregir los comentarios **engañosos** en `security.tf`/`compute.tf` que afirman que un placeholder "degrada a solo-push" (falso para secrets validados por formato).
- **A7** — **mount condicional**: que terraform NO monte un secret validado por formato hasta que tenga valor real.
- **Limpieza** — borrar las 6 ramas locales squash-merged de la sesión (#501–#505, #507).

## 2. Why now

El incidente bloqueó deploys de prod por un placeholder montado. A5/A7 son los controles **detective + preventivo** que evitan la recurrencia; A6 corrige la creencia falsa documentada que **causó** el juicio "benigno" en el review del plan. Sin estos, el próximo `content-sid` (o `twilio-account-sid`) nuevo repite el incidente.

## 3. Success criteria (measurable)

- **A5**: `terraform-drift.yml` corre el preflight sobre su `drift.plan` (JSON) y **falla** (exit≠0) si un secret validado-por-formato queda placeholder y montado. Verificable: job rojo en un plan con esa condición; verde con el plan actual (no-op).
- **A3**: existe `docs/runbooks/terraform-apply.md` con los pasos (plan→review full→preflight→apply scoped); referenciado desde `infrastructure/README.md`.
- **A6**: los comentarios en `security.tf` (~245) y `compute.tf` (~246) ya NO afirman degradación graceful para el placeholder `ROTATE_ME_*`; distinguen valor **vacío/ausente** (graceful) de **placeholder no-vacío** (falla `^HX` → refuse to start). `terraform validate` OK.
- **A7**: un `content-sid` validado se monta en `service_api` **solo** si su flag de readiness es true; `terraform plan` desde `main` sigue dando **No changes** (los content-sid actuales, ya con valor real, quedan flag=true). Test de la lógica si aplica.
- **Limpieza**: `git branch` ya no lista las 6 ramas de la sesión; `git branch --merged`/contenido en main intacto.
- **Global**: `pnpm lint` (incl. lint:rls) EXIT 0, `terraform fmt -check` + `validate` OK, repo-checks tests verdes.

## 4. User-visible behaviour

- **Antes**: agregar un `content-sid` nuevo a `security.tf` + montarlo = el `terraform apply` crea el placeholder, lo monta, y la próxima revisión de `service_api` **falla el startup** (incidente). Nada lo ataja.
- **Después**: (A7) un `content-sid` nuevo se agrega con flag readiness=false → se crea el placeholder pero **no se monta** → el service arranca, la feature queda inactiva hasta cargar el valor real y flipear el flag. (A5) si alguien igual lo monta como placeholder, el drift check / pre-apply **falla** con mensaje accionable. (A6) los comentarios reflejan la realidad. Sin cambios para usuarios finales (es infra/ops).

## 5. Out of scope

- NO `terraform apply` a prod (manual, lo corre el owner; este plan solo cambia código/CI/docs).
- NO tocar prod, secrets, ni redeploys (credenciales = owner).
- NO 4c (stub XML).
- NO cambiar la validación `^HX` de `config.ts` (es correcta; el fix es no montar placeholders).
- NO tocar IAM/Billing de Terraform.

## 6. Constraints

- CLAUDE.md: zero `any`, Zod en boundaries, Conventional Commits con scope, sección Evidencia, squash merge, NUNCA push a main.
- `.github/workflows/*` son archivos sensibles → cambio justificado (este plan).
- ADR-069 (Booster no emite DTE) / ADR-070 (custodia) vinculantes al contexto F4 pero no se tocan.
- El preflight ya existe y está testeado (#504); A5 lo **cablea**, no lo reescribe.

## 7. Approach

Un PR `chore/inc-2026-06-19-followups` (infra/ci/docs) + limpieza local de ramas (git, no PR).

1. **A6** (comentarios) — editar `security.tf` (bloque `content-sid-safety-alert`) + `compute.tf` (bloque secrets de `service_api`): aclarar que el placeholder `ROTATE_ME_*` **NO** degrada graceful (falla `^HX` → "Refusing to start"); solo el valor **vacío/ausente** es graceful (preprocess `''→undefined`). Apuntar a INC-2026-06-19 + el preflight.
2. **A7** (mount condicional) — en `compute.tf`, variable `content_sid_ready` (map<string,bool>, default por-secret) que gatea la inclusión de cada `CONTENT_SID_*` en el `secrets` de `service_api`. Los actuales (offer_new/chat_unread/tracking/safety_alert, ya con valor real en prod) → true (plan sigue no-op). Un content-sid nuevo entra con false → no se monta. Documentar la convención.
3. **A5** (gate) — extender `terraform-drift.yml`: tras el plan, `terraform show -json drift.plan > plan.json`, `actions/setup-node`, `node scripts/repo-checks/check-validated-secret-placeholders.mjs plan.json`; el job falla si exit≠0. (No cambia el SA read-only.)
4. **A3** (runbook) — `docs/runbooks/terraform-apply.md`: plan→`out`→review del plan COMPLETO→preflight→apply (con `-target` acotado al reconciliar; no barrer drift ajeno; cargar valor real de secrets validados ANTES de montarlos). Link desde `infrastructure/README.md`.
5. **Verificación** — `terraform fmt -check -recursive`, `terraform validate`, `pnpm lint`, repo-checks tests; `terraform plan` (read-only ADC) debe seguir **No changes**.
6. **Limpieza ramas** — `git branch -D` de las 6 ramas squash-merged de la sesión (verificadas por #PR en main): `feat/transport-documents-4b-ted`, `fix/manual-entry-retencion-o3`, `chore/f4-post-merge-housekeeping`, `chore/inc-2026-06-19-preflight-secret-placeholders`, `chore/c7-validacion-ted-dd`, `chore/current-md-f4-inc-consolidation`. NO tocar las pre-existentes.

## 8. Risks

| Riesgo | Prob | Impacto | Mitigación |
|---|---|---|---|
| A7 deja de montar un content-sid que prod necesita (rompe feature) | media | alto | flags de los actuales = true; `terraform plan` debe dar No changes ANTES de mergear |
| A5 falla el drift check por un falso positivo | baja | medio | el check ya tiene 19 tests; validar contra el plan real (no-op → verde) |
| A7 sobre-complica el módulo | media | bajo | gatear en compute.tf (caller), no en el módulo; map simple |
| terraform-drift necesita Node y no lo tiene | alta | bajo | agregar `actions/setup-node` (el check es Node puro, sin deps) |
| Borrar una rama con trabajo no mergeado | baja | alto | borrar SOLO las 6 verificadas como squash-merged (#501–#505,#507) |

## 9. Alternatives considered (rejected)

- **A7 vía data source que lee el valor del secret en plan** → RECHAZADO: expone el secret en el state (sensible). 
- **A5 como check bloqueante en ci.yml sobre cambios de infra** → considerado; pero ci.yml no produce un terraform plan (necesita auth GCP + init). `terraform-drift.yml` ya tiene WIF + plan → es el home natural. (Se puede sumar a futuro un job on-PR si se quiere bloqueo en PR.)
- **No hacer A7, solo A5** → RECHAZADO: A5 es detective; el post-mortem pidió también el control preventivo (no montar hasta tener valor). Pero ver Open Questions — es la decisión del PO.

## 10. Test list

- repo-checks: los 19 tests de `check-validated-secret-placeholders` siguen verdes (sin cambios al check).
- A7: `terraform validate` OK; `terraform plan` desde main = No changes (los content-sid actuales montados igual).
- A5: simular un plan.json con violación → el step falla (exit 1); el plan real (no-op) → verde. (Se puede validar localmente con un fixture.)
- A6/A3: docs — `terraform fmt -check` OK, links válidos.

## 11. Open questions (PO)

1. **A7 — ¿hacerlo y con qué forma?** Recomiendo el flag `content_sid_ready` por-secret (preventivo + matchea el post-mortem), con el costo de un apply en dos pasos para content-sids nuevos. Alternativa: omitir A7 y confiar solo en A5 (detective). **Decisión del PO.**
2. **A5 — ¿home del gate?** Propongo `terraform-drift.yml` (tiene WIF+plan; cadencia diaria + workflow_dispatch) + el paso pre-apply en el runbook A3. ¿OK, o además un job bloqueante on-PR para cambios de `infrastructure/`?
3. **¿ADR para la convención A7** ("secrets validados por formato se montan solo cuando ready")? Propongo documentarla en el runbook + comentario (no ADR formal). ¿OK?

## 12. Devils-advocate pass

- *"A7 es over-engineering; A5 ya ataja el caso."* — A5 es detective (falla el plan); A7 evita el footgun estructural (un dev agrega+monta y rompe). El post-mortem pidió ambos. Pero es legítimo elegir solo A5 → es la Open Question 1.
- *"El flag readiness es burocracia."* — Sí agrega un paso, pero el incidente costó un deploy bloqueado + horas. El default false para nuevos es el que protege.
- *"terraform-drift es periódico, no pre-apply real."* — Cierto; por eso A3 (runbook) documenta correr el preflight ANTES del apply manual. A5 en drift es la red de seguridad, no el único gate.

## 13. Approval

**Pendiente** — esperando decisión del PO sobre Open Questions 1–3.
