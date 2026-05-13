# ADR 038 — Migración Routes API key → ADC (X-Goog-User-Project)

**Estado**: Aceptado
**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Relacionado**: ADR-037 (Gemini API key → Vertex AI ADC, mismo patrón)

---

## Contexto

Después de cerrar el banner GCP de Gemini API key con ADR-037, la auditoría dejó pendiente un segundo cabo suelto: **`Booster Routes - API Backend`** (UID `e091850a-d5ea-4941-bcf0-8f966032b58b`) — API key del Routes API también sin restricción de origen.

Inventario al iniciar:

| Key | Service | Origen restriction | Acción |
|---|---|---|---|
| ~~`Booster Gemini - API Backend`~~ | ~~generativelanguage~~ | ~~ninguna~~ | **eliminada ADR-037** ✓ |
| `Booster Routes - API Backend` | routes | **ninguna** ← esta | ← este ADR |
| `Booster Maps - Web (PWA)` | addressvalidation | referrer ✓ | mantener |
| `Browser key (Firebase)` | firebasedatabase | n/a | mantener (Firebase la maneja) |

El backend `booster-ai-api` usa la key Routes API en múltiples flows:
- `services/routes-api.ts` (cliente HTTP)
- `services/calcular-metricas-viaje.ts` (distancia precisa post-asignación)
- `services/eco-route-preview.ts` (preview de eco-ruta para shipper)
- `services/compute-route-eta.ts` (ETA real para tracking público)
- `services/persist-eco-route-polyline.ts` (cache polyline post-accept)
- `services/get-assignment-eco-route.ts` (endpoint del driver)
- `services/get-public-tracking.ts` (tracking público sin auth)
- `services/offer-actions.ts` (orquestación post-accept)

## Decisión

Validado empíricamente que **Routes API acepta OAuth bearer token con header `X-Goog-User-Project`** (curl test directo respondió `OK — distance=120531m duration=5111s` para Santiago → Valparaíso).

Migrar el cliente al mismo patrón de ADR-037 (Vertex AI Gemini):
- `Authorization: Bearer {ADC access token}` (en lugar de `X-Goog-Api-Key`)
- `X-Goog-User-Project: {GCP project ID}` (para que GCP sepa a qué proyecto facturar la quota)

### Cambios

#### Código (12 archivos)

| Archivo | Cambio |
|---|---|
| `apps/api/src/services/routes-api.ts` | Singleton `GoogleAuth` (scope cloud-platform) + bearer token + `X-Goog-User-Project` header. `apiKey` → `projectId` en `ComputeRoutesParams`. |
| `apps/api/src/services/calcular-metricas-viaje.ts` | `routesApiKey` → `routesProjectId` (param y firma) |
| `apps/api/src/services/eco-route-preview.ts` | Idem |
| `apps/api/src/services/compute-route-eta.ts` | Idem |
| `apps/api/src/services/persist-eco-route-polyline.ts` | Idem |
| `apps/api/src/services/get-assignment-eco-route.ts` | Idem |
| `apps/api/src/services/get-public-tracking.ts` | Idem |
| `apps/api/src/services/offer-actions.ts` | Pasa `config.GOOGLE_CLOUD_PROJECT` en lugar de `config.GOOGLE_ROUTES_API_KEY` |
| `apps/api/src/routes/offers.ts` | Idem |
| `apps/api/src/routes/assignments.ts` | Idem |
| `apps/api/src/routes/public-tracking.ts` | Idem |
| `apps/api/src/server.ts` | Idem (2 callsites: public-tracking + assignments) |
| `apps/api/src/config.ts` | Quita `GOOGLE_ROUTES_API_KEY` del schema (el `GOOGLE_CLOUD_PROJECT` ya estaba post-ADR-037) |

#### Tests (5 archivos, ~20 reemplazos)

Tests unitarios actualizados: `routesApiKey` → `routesProjectId`, `apiKey` → `projectId` en assertions de `computeRoutes`. Resultado: **921 passed, 0 failed, 2 skipped**.

#### Infra (1 archivo)

| Archivo | Cambio |
|---|---|
| `infrastructure/compute.tf` | Elimina `GOOGLE_ROUTES_API_KEY = ...` del env del `service_api`. |

#### IAM — sin cambios necesarios

El SA `booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com` ya tiene `roles/serviceusage.serviceUsageConsumer` (verificado vía `gcloud projects get-iam-policy`). Eso es suficiente para usar Routes API con `X-Goog-User-Project`.

---

## Apply post-merge (3 pasos)

```bash
# 1. terraform apply (saca GOOGLE_ROUTES_API_KEY del Cloud Run env)
cd infrastructure/
export TF_VAR_billing_account="019461-C73CDE-DCE377"
terraform apply

# 2. Smoke test: trigger un flow Routes API
#    (ej. POST /carrier/offers/:id/accept o GET /assignments/:id/eco-route)
#    Verificar log "distancia obtenida via Routes API" sin auth_error.

# 3. Eliminar la API key
gcloud services api-keys delete \
  e091850a-d5ea-4941-bcf0-8f966032b58b \
  --project=booster-ai-494222 \
  --location=global \
  --quiet
```

## Validación post-apply

- [ ] `gcloud run services describe booster-ai-api ...` ya no incluye env `GOOGLE_ROUTES_API_KEY`
- [ ] `gcloud services api-keys list --project=booster-ai-494222` no muestra `Booster Routes - API Backend`
- [ ] Smoke test: aceptar una oferta de demo seed → `metricas_viaje.distancia_km` proviene de Routes API (no de `estimarDistanciaKm` Chile)
- [ ] `gcloud logging read` no muestra errores de auth en `routes-api.ts`

---

## Consecuencias

### Positivas

- ✅ Cierra completamente el tema de API keys del proyecto (excepto `Booster Maps - Web (PWA)` que ya está bien restringida con referrer, y la Firebase auto-creada).
- ✅ Sin rotaciones manuales de keys de Routes en el futuro.
- ✅ Quota tracking por proyecto/SA via X-Goog-User-Project.

### Negativas

- Cold start ligeramente mayor (~50-100ms adicionales por el primer `getAccessToken()` — cacheado después).
- Tests locales requieren `gcloud auth application-default login` para invocar Routes API real. Para tests unitarios con mock fetch, sin cambio (los tests siguen pasando 921/921).

### Reversibilidad

`git revert` del PR + `terraform apply` vuelve al estado previo en <10 min. La API key se puede recrear desde Cloud Console si necesario.

---

## Pendientes que NO resuelve este PR

- Eliminar el secret `google-routes-api-key` de `infrastructure/security.tf` (cosmético, 1 sprint post-merge una vez validada estabilidad).
- `Browser key (auto created by Firebase)` — auto-creada y manejada por Firebase, fuera del scope.

---

## Estado API keys post este ADR

| Key | Estado |
|---|---|
| ~~`Booster Gemini - API Backend`~~ | **eliminada** (ADR-037) ✓ |
| ~~`Booster Routes - API Backend`~~ | **eliminada** (ADR-038, este) ✓ |
| `Booster Maps - Web (PWA)` | mantener (referrer-restricted, browser-side) |
| `Browser key (Firebase auto)` | mantener (Firebase la gestiona) |

Banner GCP "unrestricted API keys" debe desaparecer dentro de 24h post-delete.

---

## Referencias

- ADR-037 — mismo patrón ADC para Gemini API
- [Routes API auth options](https://developers.google.com/maps/documentation/routes/authentication)
- [X-Goog-User-Project header](https://cloud.google.com/apis/docs/system-parameters)
- `docs/audits/gcp-costs-2026-05-13.md` — auditoría que destapó las keys
