# Spec: feat-deploy-pipeline-hardening

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: Auditoría 2026-06-09 — riesgo ALTO "canary-verify placeholder que siempre pasa", medio "release.yml no encadenado a ci.yml", medio "canal de alertas único". Follow-ups canary-verify-mql-real + segundo-canal-alertas-sre. ⚠️ Toca archivos sensibles del pipeline (CLAUDE.md §archivos críticos): el PR requiere revisión explícita del PO.

## 1. Objective

(1) `canary-verify` deja de ser `exit 0`: consulta la Monitoring API (request_count por response_code_class + p95 de request_latencies de la revision canary, ventana 30min) y ABORTA el build si error_rate ≥1% o p95 ≥500ms — la promoción a 100% gana su gate automático. (2) `release.yml` espera el check "CI Success" del mismo SHA antes de deployar (hoy corren en paralelo). (3) Canal webhook de alertas parametrizado (`var.sre_webhook_url`, count-gated) + TODAS las policies pasan a `local.alert_channel_ids` — al poblar la URL, ambos canales notifican.

## 2. Why now

Los tres eran deuda declarada del pipeline; el PO pidió resolver todo lo detectado. El webhook queda listo para cuando el PO genere la URL (Slack incoming webhook o Google Chat space webhook).

## 3. Success criteria

- [ ] canary-verify: FAIL real ante breach; defensivo ante sin-muestra (0 requests / sin tag) → warn + decisión humana (semántica documentada previa, preservada).
- [ ] release.yml: deploy aborta si CI Success concluye failure; timeout 30min.
- [ ] 20 policies → `local.alert_channel_ids`; webhook count-gated (sin URL = comportamiento actual exacto).
- [ ] terraform validate OK; YAMLs válidos.

## 4. User-visible behaviour

Operador: un canary malo aborta solo (antes: promoción ciega tras 30min de sleep); deploy nunca corre con CI rojo; alertas a 2 canales cuando exista webhook.

## 5. Out of scope

- Canary para servicios ≠ api (siguen directo a 100% — follow-up existente).
- Crear el webhook (insumo del PO; el TF queda esperándolo).
- Rollback automático (el humano decide; runbook signup-canary-rollback ya corregido en #441).

## 6. Constraints

1. Sin deps nuevas en el build: python3 + gcloud del cloud-sdk image; stdlib only.
2. Sin URL de webhook el plan de TF es no-op para canales (count 0).
3. El gate de CI usa github.token (sin secrets nuevos).

## 7. Approach

Inline python en el step (urllib + Monitoring API v3, ALIGN_SUM/REDUCE_SUM por response_code_class y ALIGN_PERCENTILE_95/REDUCE_MAX); resolución de revision por tag vía gcloud describe. Poll de check-runs con gh api en release.yml. Locals + count en monitoring.tf.

## 8. Alternatives considered

- **A. MQL vía gcloud monitoring (CLI)** — Rechazada: el comando está en alpha/inestable entre versiones del cloud-sdk image; la REST v3 con stdlib es estable y testeable a mano.
- **B. wait-on-check action de terceros** — Rechazada: dependencia de supply chain nueva para 15 líneas de gh api.
- **C. Webhook obligatorio ahora** — Rechazada: bloquearía el apply hasta que el PO genere la URL; count-gated lo desacopla.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| El check de canary falla por API/permiso y bloquea deploys buenos | M | M | El SA del build ya consulta Monitoring (guardrails ADR-034); errores de la API rompen el step → revisión humana (preferible a promoción ciega); primer deploy observado por el PO valida e2e |
| Métrica con labels distintos a los asumidos | L | M | response_code_class y request_latencies son métricas estándar de Cloud Run documentadas; primer run lo confirma |
| El gate de CI espera un check renombrado | L | L | "CI Success" = job agregador ci-success (name exacto verificado en ci.yml) |

## 10. Test list

- T1: YAMLs válidos (parse) + terraform validate.
- T2: revisión manual del flujo del script (sin GCP local) — la validación e2e REAL es el primer deploy observado (§11), igual que KMS/OTel.
- T3: plan de TF sin URL = sin cambios de canales (count 0) — lo verifica el drift check diario tras merge.

## 11. Rollout

- El PRÓXIMO deploy a prod es la validación e2e: el PO observa el step canary-verify con datos reales antes de confiar en él (si falla por plumbing, el fallback es revert de este PR — la promoción vuelve a ser manual, no peor que hoy).
- Webhook: el PO genera la URL → `terraform apply -var sre_webhook_url=...` (o tfvars) → disparar alerta de prueba.

## 11bis. Nota operativa (review 2026-06-11)

Merges rápidos consecutivos a main: la concurrency de ci.yml cancela el CI del primer SHA → su release aborta en el gate "Esperar CI Success" con conclusion=cancelled. Benigno: el deploy del SEGUNDO merge lleva ambos cambios; no re-runear el primero. (No existe runbook canary dedicado; si se crea, mover esta nota ahí.)

## 12. Open questions

None as of 2026-06-11 (la URL del webhook es insumo pendiente del PO, desacoplado por diseño).

## 13. Decision log

- 2026-06-11 — Draft + mandato PO. Python stdlib inline (no MQL CLI alpha, no actions de terceros).
