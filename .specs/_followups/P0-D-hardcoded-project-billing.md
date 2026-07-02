# P0-D — GCP Project ID / Billing Account / KMS path hardcoded

> ✅ **RESUELTO en #469** (merged 2026-06-14). Billing account id eliminado del repo; `superRefine` en config.ts exige `GOOGLE_CLOUD_PROJECT` en prod y `BILLING_EXPORT_TABLE` con dashboard activo; sin fallback a literal de prod.

**Dimensión**: security / tech-debt · **Esfuerzo**: S
**Fuente**: audit 2026-06-14

## Problema
Mismo literal de producción en 3 archivos:
- `apps/api/src/config.ts:566` — default Zod `'booster-ai-494222.billing_export.gcp_billing_export_v1_019461_C73CDE_DCE377'`
- `apps/api/src/server.ts:625` — fallback `?? 'booster-ai-494222'`
- `packages/certificate-generator/src/tipos.ts:118` — KMS key path con `booster-ai-494222`

## Impacto
Information disclosure: project ID, billing account ID (`019461_C73CDE_DCE377`) y dataset BigQuery facilitan reconocimiento y construcción de paths de recursos GCP válidos.

## Plan de pago
1. Mover default de `BILLING_EXPORT_TABLE` a variable Terraform sin default en código; required cuando `OBSERVABILITY_DASHBOARD_ACTIVATED=true`.
2. `gcpProjectId`: eliminar fallback a prod (usar `undefined` → no correlacionar OTel).
3. Paths KMS en `tipos.ts` como documentación, no defaults productivos.
4. Verificar que la build no rompa sin los defaults (tests + typecheck).

## NO ejecutar ahora
Diagnóstico. Fix aparte; tocar config.ts/server.ts afecta boundaries → validar con Zod + tests.
