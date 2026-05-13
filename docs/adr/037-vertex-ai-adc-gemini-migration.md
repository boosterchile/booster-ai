# ADR 037 — Migración Gemini API key → Vertex AI con ADC

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Cierra issue**: [#195](https://github.com/boosterchile/booster-ai/issues/195)
**Relacionado**: ADR-035 (auditoría que destapó el banner)

---

## Contexto

Cloud Console mostró banner crítico durante la habilitación del billing export (2026-05-13):

> *"Action Required: One or more projects enabled with Gemini API (generativelanguage.googleapis.com) have unrestricted API keys. To prevent unauthorized usage and costs, restrict these keys or switch to Authorization keys."*

Inventario de keys al momento:

| Key | UID | Service | Origen restriction |
|---|---|---|---|
| `Booster Gemini - API Backend` | `a5a60db7-0dc4-43c2-b08a-bb21e7834c2d` | generativelanguage | **ninguna** ← lo que el banner reclama |
| `Booster Routes - API Backend` | `e091850a-d5ea-4941-bcf0-8f966032b58b` | routes | ninguna |
| `Booster Maps - Web (PWA)` | `eb016256-c055-42f8-a3ce-c60749b50cbe` | addressvalidation | referrer `app.boosterchile.com/*` ✅ |

El backend `booster-ai-api` (Cloud Run) usa la key Gemini desde `apps/api/src/services/gemini-client.ts` para generar el coaching post-entrega de cada trip (Phase 3 PR-J2). El bot WhatsApp tenía un binding del mismo secret pero **no se usa en código** — binding huérfano.

## Riesgo

- **Costo**: una key filtrada genera tráfico Gemini cobrado a la cuenta. Gemini 1.5 Flash ≈ USD 0.075/M input + 0.30/M output tokens. Pro: 1.25 / 5. Filtración fácil → cientos de USD/mes.
- **Seguridad**: la key pasa por Cloud Run env vars + Secret Manager + logs eventuales + dumps. La `service-restriction = generativelanguage.googleapis.com` limita el daño a Gemini API, pero igual hay superficie de ataque.
- **Compliance TRL 10**: API keys hardcoded para uso backend son anti-pattern. Vertex AI / ADC es el camino oficial GCP para servidores.

---

## Decisión

Migrar `apps/api/src/services/gemini-client.ts` a **Vertex AI Gemini API** con autenticación via **Application Default Credentials** (ADC).

### Cambios

1. **`gemini-client.ts`** — refactor completo:
   - Quita parámetro `apiKey`. Recibe `projectId` (+ `location` opcional).
   - Endpoint: `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent`
   - Auth: singleton `GoogleAuth` de `google-auth-library` (ya estaba en deps). En cada request obtiene access token via ADC y lo pone en header `Authorization: Bearer ...`.
   - Region: `southamerica-east1` (São Paulo) — latencia ~80ms desde Santiago, vs ~150ms us-central1. Modelo `gemini-1.5-flash` confirmado disponible.
   - Body, safety settings, timeout, fallback a null: idénticos al cliente previo.

2. **`generar-coaching-viaje.ts`** — callsite:
   - Parámetro `geminiApiKey?` renombrado a `geminiProjectId?`.
   - `createGeminiGenFn({ projectId, logger })` en vez de `{ apiKey, logger }`.

3. **`confirmar-entrega-viaje.ts`** — pasa `geminiProjectId: appConfig.GOOGLE_CLOUD_PROJECT` en lugar de `geminiApiKey: appConfig.GEMINI_API_KEY`.

4. **`config.ts`** — schema:
   - Elimina `GEMINI_API_KEY: z.string().optional()`.
   - Agrega `GOOGLE_CLOUD_PROJECT: z.string().optional()` (Cloud Run lo setea automáticamente).

5. **`infrastructure/compute.tf`** — env vars de Cloud Run:
   - Elimina `GEMINI_API_KEY = ...` del `service_api` y del `service_whatsapp_bot` (binding huérfano).
   - `GOOGLE_CLOUD_PROJECT = var.project_id` ya estaba en `common_env_vars`.

### IAM — sin cambios necesarios

El SA `booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com` ya tiene `roles/aiplatform.user` (verificado vía `gcloud projects get-iam-policy`). Vertex AI Gemini se llama bajo ese rol.

### Secret Manager — sin cambios en este ADR

El secret `gemini-api-key` queda en Secret Manager (no se borra del .tf de `security.tf`) como artefacto histórico para eventual rollback rápido. **Pero la API key real se elimina** post-apply para que el secret quede como string vacío inerte. Quitar el secret de Terraform es trabajo cosmético de otro PR.

---

## Apply post-merge

```bash
# 1. terraform apply para sacar GEMINI_API_KEY del Cloud Run
cd infrastructure/
export TF_VAR_billing_account="019461-C73CDE-DCE377"
terraform apply

# 2. Smoke test del coaching (verificar que Vertex AI responde)
#    Trigger: confirmar-entrega de un trip en demo seed; el dashboard
#    debería mostrar coaching con fuente=gemini (no plantilla).

# 3. Eliminar la API key productiva
gcloud services api-keys delete \
  a5a60db7-0dc4-43c2-b08a-bb21e7834c2d \
  --project=booster-ai-494222 \
  --location=global \
  --quiet

# 4. Verificar que el banner desaparece (≤24h)
```

## Validación post-apply

- [ ] `gcloud run services describe booster-ai-api ... --format="value(spec.template.spec.containers[0].env[].name)"` ya no incluye `GEMINI_API_KEY`
- [ ] `gcloud services api-keys list --project=booster-ai-494222` no muestra `Booster Gemini - API Backend`
- [ ] Smoke test del flow coaching: invocar `POST /admin/seed/demo` + simular confirmar-entrega de un trip + verificar en `metricas_viaje.coaching_fuente = 'gemini'`
- [ ] `gcloud logging read "resource.type=cloud_run_revision AND severity>=WARNING" --limit=10` no muestra errores nuevos de auth en gemini-client
- [ ] Banner GCP "unrestricted API keys" desaparece (≤24h, posible 24-48h)

---

## Consecuencias

### Positivas

- ✅ Cierra el banner GCP de "unrestricted API keys" (security + compliance TRL 10).
- ✅ Sin API keys hardcoded — auth via workload identity (best practice).
- ✅ Sin rotaciones manuales de keys en el futuro.
- ✅ Latencia mejorada: `southamerica-east1` (~80ms) vs Gemini API global default (~150-200ms).
- ✅ Quota tracking por proyecto/SA en Cloud Console (más granular que API key).

### Negativas

- Cold start ligeramente mayor (~50-100ms adicionales por el primer `getAccessToken()` — el token se cachea después).
- Tests locales del backend ahora requieren `gcloud auth application-default login` para invocar Gemini. Para tests unitarios con mock fetch, sin cambio.

### Reversibilidad

- `git revert` del PR + `terraform apply` vuelve al estado previo en <10 min. La API key original se puede recrear (con la misma restricción de servicio) si necesario.
- El secret `gemini-api-key` en Secret Manager queda intacto, permitiendo cargar una key nueva sin tocar Terraform.

---

## Pendientes no resueltos por este ADR

1. **`Booster Routes - API Backend`** (key `e091850a-...`) también sin restricción de origen. Mismo fix recomendado: usar ADC con `roles/serviceusage.routesViewer` o equivalente. Issue separado.
2. **`Browser key (Firebase)`** — auto-creada por Firebase. Su scheme es distinto (browser-side); el banner no la flagea pero podría agregarse referrer restriction.
3. **Secret `gemini-api-key` en Secret Manager** — eliminar el resource Terraform de `security.tf` cuando se confirme estabilidad de Vertex AI (1 sprint post-merge).

---

## Referencias

- [Vertex AI Gemini docs](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini)
- [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)
- [google-auth-library Node.js](https://github.com/googleapis/google-auth-library-nodejs)
- Issue [#195](https://github.com/boosterchile/booster-ai/issues/195) — security trigger
- ADR-035 — auditoría que destapó el banner
