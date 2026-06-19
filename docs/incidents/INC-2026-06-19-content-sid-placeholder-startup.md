# INC-2026-06-19 — `terraform apply` mountó un content-sid placeholder → `service_api` no arranca

| Campo | Valor |
|---|---|
| **Severidad** | SEV-2 (deploys/rollforward bloqueados; **sin impacto a usuarios**) |
| **Estado** | Mitigado (prod siempre sirvió la revisión sana); resolución en curso (poblar el SID real) |
| **Detectado por** | Felipe Vicencio (PO) — error de `terraform apply` en su terminal |
| **Servicio** | `booster-ai-api` (Cloud Run, southamerica-west1) |
| **Fecha** | 2026-06-18 ~22:10 America/Santiago (2026-06-19 ~02:10 UTC) |
| **Síntoma** | `Error waiting for Updating Service: ... container failed the configured startup probe checks` (revisión `booster-ai-api-00363/00364`) |

## Resumen

Durante el cierre de infraestructura de F4/F3 (PR #503), un `terraform apply` —que además barría **drift preexistente**— creó el secreto `content-sid-safety-alert` con su valor **placeholder** (`ROTATE_ME_CONTENT_SID_SAFETY_ALERT_PLACEHOLDER`) y lo montó en `service_api` como `CONTENT_SID_SAFETY_ALERT`. El api valida ese env var con `^HX[a-fA-F0-9]+$` (Twilio Content SID) en `apps/api/src/config.ts`. El placeholder no matchea → el api responde **"Invalid environment configuration. Refusing to start." → exit(1)** → la revisión nueva falla el startup probe.

**No hubo impacto a usuarios**: Cloud Run no enruta tráfico a una revisión que falla su probe, así que `booster-ai-api-00407` (revisión sana, que NO montaba el secreto) siguió sirviendo el 100%. El daño real fue **bloquear deploys/rollforward**: toda revisión nueva —incluido el próximo deploy de cloudbuild— montaría el placeholder y fallaría.

## Impacto

- **Usuarios**: ninguno. Prod sirvió ininterrumpidamente en `00407`.
- **Operacional**: `service_api` quedó sin poder crear revisiones nuevas hasta poblar el valor real. Las release approvals pendientes (#495–#502) no podían desplegarse.
- **Datos**: ninguno. (Los 2 secretos `dte-provider-*` sí se destruyeron — acción autorizada e intencional, no parte del incidente.)

## Línea de tiempo (referencia)

1. PR #503 (cablear bucket F4 + retirar secretos DTE) aprobado para apply; el plan mostraba `4 add / 10 change / 4 destroy`, incluyendo **drift preexistente** (topic `document.uploaded`, secreto `content-sid-safety-alert`).
2. `terraform apply`: creó pubsub + `content-sid-safety-alert` (placeholder) + actualizó `service_document` (sano) y **falló** al actualizar `service_api` (revisión `00363` → startup probe).
3. Diagnóstico: prod sano en `00407`. **Por qué no se cayó**: Cloud Run **no mueve tráfico a una revisión que no llega a READY** — la nueva falló el startup probe y el tráfico quedó en la asignación previa (`00407`, que NO monta el secreto). (Ojo: `service_api` usa `traffic_managed_externally=true` — el split lo maneja Cloud Build canary, **no** un target `LATEST`; igual aplica el invariante de "revisión no-READY no recibe tráfico".) Logs de la revisión fallida: `path: CONTENT_SID_SAFETY_ALERT, "Debe empezar con HX seguido de hex chars"`.
4. Confirmado: `00364` (gcloud, misma imagen que la sana `00407`) también falla → descarta "imagen vieja"; la causa es el **placeholder del secreto validado**.
5. Resolución: poblar el SID real (`HX…`) en `content-sid-safety-alert` y crear revisión nueva. (En curso por el PO; el SID es credencial.)

## Causa raíz

Un secreto con **validación de formato** en el env schema (`CONTENT_SID_*` = `^HX…`) fue **creado con su placeholder y montado en un service en el mismo apply**. El service valida el env var al arrancar y rechaza el placeholder. No existía un preflight que detectara "placeholder de secreto validado montado en un service".

## Factores contribuyentes

1. **Drift barrido en un apply ajeno**: `content-sid-safety-alert` era drift preexistente (alguien lo agregó a `security.tf` sin aplicar). Se aplicó junto con cambios no relacionados (F4/F3) en vez de resolverse aparte.
2. **Revisión de plan incompleta (agente)**: en el review del plan se clasificó el `content-sid-safety-alert` como "benigno" sin cruzar que (a) lo monta `service_api` y (b) `CONTENT_SID_SAFETY_ALERT` tiene validación de formato. Las dos señales estaban en el plan.
3. **Hipótesis de causa equivocada al inicio**: se atribuyó primero a "imagen stale de terraform" y luego a `TRANSPORT_DOCUMENTS_BUCKET`; recién los **logs** del contenedor dieron la causa real. (Lección: ir a los logs antes de teorizar — systematic-debugging.)
4. **terraform crea placeholder + monta en el mismo grafo**, sin gate que exija el valor real primero.

## Qué salió bien

- Cloud Run protegió prod (no enrutó a la revisión que falla el probe).
- Los 4 destroy fueron exactamente los esperados (secretos DTE); el plan se auditó recurso por recurso antes de aplicar.
- La diagnosis usó evidencia (Cloud Run API + Cloud Logging), no adivinanza, una vez que se fue a los logs.

## Acción correctiva / preventiva

| # | Acción | Estado | Ref |
|---|---|---|---|
| A1 | Poblar `content-sid-safety-alert` con el SID real + revisión nueva | En curso (PO) | — |
| A2 | **Preflight check (script)**: dado el plan JSON, falla si un secreto validado por formato queda placeholder y está montado en un service. Cubre `content-sid-*` (`^HX`) + `twilio-account-sid` (`^AC`), y cruza contra el estado resultante completo (`planned_values`), no solo `resource_changes`. | **Hecho (este PR)** — es un **script manual**, NO previene la recurrencia por sí solo | `scripts/repo-checks/check-validated-secret-placeholders.mjs` |
| A5 | **Gate pre-apply**: cablear A2 en el flujo de deploy (emitir `plan.json` y correr el check antes de `terraform apply`). **ESTA es la prevención real** — A2 sin A5 sigue dependiendo de que un humano lo corra (y el incidente lo causó un humano que no verificó). | **Pendiente** | — |
| A3 | Aplicar terraform **scoped** (no barrer drift ajeno); resolver el drift preexistente en su propio change | Pendiente | — |
| A4 | Revisión de plan: checklist de "secret nuevo → ¿lo monta un service? ¿el env var está validado?" en `booster-stack-conventions` | Pendiente (draft junto al preflight) | — |
| A6 | **Corregir comentarios engañosos** en `infrastructure/security.tf` (~l.243-245) y `infrastructure/compute.tf` (~l.256-258) que afirman que un secret en placeholder "degrada a solo-push" — es **FALSO**: el placeholder mata el startup. Esos comentarios fueron la fuente documentada del juicio "benigno" en la revisión del plan. | Pendiente | — |
| A7 | Evaluar que terraform no monte un secreto validado hasta tener valor real (mount condicional / ordering); y derivar el set validado de A2 de los `.regex` de los config.ts (anti-drift) | Pendiente | — |

## Cómo correr el preflight (antes de cualquier `terraform apply`)

```bash
terraform -chdir=infrastructure show -json tfplan > plan.json
node scripts/repo-checks/check-validated-secret-placeholders.mjs plan.json
```

Validado contra el plan real de este incidente: detecta `content-sid-safety-alert → booster-ai-api` y sale con código 1.
