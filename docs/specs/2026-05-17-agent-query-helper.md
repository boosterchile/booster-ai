# Spec — Agent query helper (script para queries headless contra Cloud SQL prod via bastion)

- **Author**: Felipe Vicencio (PO) + Claude (agent-rigor)
- **Date**: 2026-05-17
- **Status**: **Draft** — pendiente PO approval
- **Supersedes**: PR #275 ([prod-query-tool spec](2026-05-17-prod-query-tool.md), cerrado tras verificación empírica)
- **ADR a crear**: `045-agent-query-helper.md`

---

## 1. Objetivo

Habilitar al agente a ejecutar queries SELECT contra Cloud SQL prod desde shell headless usando un **wrapper script de ~50 LOC sobre infraestructura existente**: bastion IAP (Capa 1 ADR-013) + ADC + cloud-sql-proxy ya corriendo en bastion + token-file bypass del user OAuth refresh issue.

Reemplaza el approach descartado de spec C #275 (servicio Cloud Run custom 15-17h con AST parser, audit log dual, VPC connector, rate limit).

## 2. Why now

Verificación empírica 2026-05-17 ~20:50 UTC demostró que el approach minimalista funciona end-to-end:

```bash
gcloud auth application-default print-access-token > /tmp/gcloud-adc-token
gcloud --access-token-file=/tmp/gcloud-adc-token compute start-iap-tunnel \
  db-bastion 5432 --local-host-port=127.0.0.1:5436 \
  --zone=southamerica-west1-a --project=booster-ai-494222 &
psql "postgresql://booster_app:***@localhost:5436/booster_ai" \
  -c "SELECT to_regclass('public.log_acceso_stakeholder');"
# → log_acceso_stakeholder (query exitosa)
```

Total: 30 segundos. Cero infraestructura nueva. Cero código de aplicación.

El gap real era operacional: el patrón funciona pero no estaba documentado ni encapsulado. Cualquier futuro session del agente que necesite query prod hoy tiene que re-descubrir el patrón.

Esta spec encapsula el patrón en:
- Un script ergonómico (`scripts/db/agent-query.sh`).
- Documentación en runbook.
- ADR-045 corto registrando la decisión y el descarte del spec C anterior.

## 3. Success criteria

- [ ] **CR-1**: Existe `scripts/db/agent-query.sh` ejecutable que toma SQL como argumento (`-c "SELECT ..."` o `-f file.sql`) y retorna resultado en stdout. Exit code ≠0 si query falla.
- [ ] **CR-2**: El script reutiliza el patrón del existente `scripts/db/connect.sh` (Capa 1 ADR-013) pero opera headless via:
  - `gcloud auth application-default print-access-token` (ADC, no user OAuth).
  - `gcloud --access-token-file=<path>` flag para bypass del user OAuth refresh.
  - `--impersonate-service-account` NO necesario (dev@boosterchile.com como Owner tiene IAP transitivo).
- [ ] **CR-3**: El script verifica precondiciones antes de ejecutar:
  - Bastion `db-bastion` reachable (ADC token valido + instance RUNNING).
  - `psql` instalado (mismo check que connect.sh).
  - SQL pasado no es vacío.
- [ ] **CR-4**: El script cleanup el tunnel en exit (SIGINT/SIGTERM/EXIT trap).
- [ ] **CR-5**: Runbook `docs/runbooks/agent-query-prod.md` documenta:
  - Quick start (3 líneas).
  - Cuándo usar vs Cloud SQL Studio.
  - Cuándo NO usar (mutations, queries de >MB, loops).
  - Troubleshooting (token expirado, tunnel timeout, psql not found).
- [ ] **CR-6**: ADR-045 documenta:
  - Decisión: helper script sobre infraestructura existente.
  - Spec C descartada (link a PR #275 cerrado).
  - Alternativas evaluadas con verdict empírico (no solo teórico como v1 del spec C).
  - Trade-offs: por qué NO custom Cloud Run service, NO booster_query_tool por defecto.

## 4. Out of scope (v1)

- **Rol DB read-only `booster_query_tool`**: opcional para defense-in-depth, NO necesario en v1. El script usa `booster_app` (que tiene full DML/DDL); el control es operacional (humano revisa SQL antes de pegar) + pg_audit del bastion. Si el patrón se vuelve frecuente y el riesgo de mutation accidental sube, agregar en v1.1 vía Terraform.
- **Audit log dedicado**: Cloud SQL ya tiene pg_audit configurado (per ADR-013 Capa 1). El bastion + IAP tunnel ya queda en Cloud Audit Logs (acceso IAP). Doble audit no aporta.
- **Rate limit**: el agente lo usa pocas veces por sesión, no en loop. Si llegamos a 100+ queries/hora, considerar.
- **AST parser**: innecesario. El script ejecuta lo que le pasa el agente; el agente es responsable de no escribir queries mutantes.
- **CLI helper como package npm**: bash script es suficiente. Si crece a >100 LOC, considerar TS package.
- **Cloud Run service custom**: descartado por overhead de mantenimiento + superficie de ataque permanente vs reuso 100% de infra existente.

## 5. Test list

- [ ] **T1**: SELECT simple retorna resultado esperado.
- [ ] **T2**: Multi-row SELECT formatea correctamente.
- [ ] **T3**: SQL inválido retorna error de psql con exit ≠0.
- [ ] **T4**: SIGINT al script kills el tunnel cleanly (no proceso huérfano).
- [ ] **T5**: Sin ADC válido falla con mensaje útil (no genérico `gcloud error`).
- [ ] **T6**: psql no instalado falla con mensaje útil.

Tests son manuales (validados por el PO en su laptop). El script vive en `scripts/db/` que no tiene CI test runner — alineado con `connect.sh` existente.

## 6. Risks + mitigations

| Riesgo | Mitigación |
|---|---|
| Agente ejecuta UPDATE/DELETE por error | Script imprime warning + confirma antes de ejecutar si detecta DML/DDL keywords (`UPDATE\|DELETE\|INSERT\|DROP\|CREATE\|ALTER\|TRUNCATE`). Soft check, no perimeter |
| Token ADC leak vía cat /tmp/gcloud-adc-token en logs | Script crea token con `mktemp` + permisos 600 + `trap rm` en exit. Cero persistence |
| Bastion VM down → tunnel falla | Mensaje claro "verificar bastion en GCP Console / `gcloud compute instances describe db-bastion`" |
| Query lenta cuelga el agente | Pasar `-c "SET statement_timeout TO '30s'; ${SQL}"` al psql call |
| pg_audit pierde context del invocador (queda como `booster_app`) | Aceptable v1; v1.1 puede migrar a IAM database auth (ADR-013 Capa 2 pendiente) |

## 7. Estimación de esfuerzo

| Fase | Tiempo |
|---|---|
| Script `agent-query.sh` (basado en `connect.sh`) | 30 min |
| Tests manuales T1-T6 | 30 min |
| Runbook `agent-query-prod.md` | 30 min |
| ADR-045 | 30 min |
| Devils-advocate + fixes | 30 min |
| **Total** | **~2.5h** |

vs 15-17h del spec C descartado.

## 8. Alternativas consideradas

| Alternativa | Verdict |
|---|---|
| Spec C #275 (Cloud Run service custom) | **Descartado** tras devils-advocate v2 + verificación empírica. Overhead de mantenimiento + superficie nueva sin justificación |
| Status quo (Cloud SQL Studio web manual) | Sigue válido para humanos. NO resuelve agente headless |
| `booster_query_tool` rol DB read-only desde v1 | Movido a v1.1 si el patrón se vuelve frecuente. v1 mantiene `booster_app` por simplicidad |
| Pre-baked stored procedures (`SECURITY DEFINER`) | Limitante. Cubre <50% de casos ad-hoc. Si lo necesitamos, agregar como complemento futuro |
| Wrapper TypeScript en package npm | Overkill para ~50 LOC. Bash script alineado con `connect.sh` existente |

## 9. Open questions

- ¿`docs/runbooks/agent-query-prod.md` o `docs/runbooks/db-access-agent.md`? Default: `agent-query-prod.md`.
- ¿Detectar DML keywords pre-execute es soft check o hard reject? Default: soft warning con confirmación interactiva. Si el agente lo invoca con `-y` flag, skip.
- ¿Statement_timeout 30s en script o dejarlo configurable via env var? Default: 30s default, override con `STATEMENT_TIMEOUT_S` env.

## 10. Quality gates (calidad antes que fechas)

Plan + BUILD se completan cuando:
1. Script funciona en al menos 3 invocaciones consecutivas distintas (T1, T2, T3).
2. Runbook leído por humano fresco resulta exitoso (test mental).
3. ADR-045 documenta cada decisión + alternativa descartada.
4. Devils-advocate sobre el plan + sobre el PR final no encuentra P0.

Fechas externas (Corfo, demos) se ajustan a estos gates.

## 11. Próximos pasos post-approval

1. `/plan` corto (1-2 sesiones de 1h cada una).
2. `/build` task atómico (script + tests manuales + runbook + ADR).
3. Devils-advocate sobre el PR.
4. Merge tras code-reviewer pass.
