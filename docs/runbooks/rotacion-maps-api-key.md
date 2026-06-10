# Runbook — Rotación de la Google Maps API key (frontend)

- **Estado**: Vigente
- **Creado**: 2026-06-10
- **Reemplaza**: ADR-014 §Rotación pasos 2-3 (citaban `deploy-phase-2.sh`, eliminado 2026-06-10 por bypassear el pipeline — ver `.specs/ops-eliminar-deploy-phase-2/spec.md`). Los ADRs no se editan; esta es la referencia operativa vigente.
- **Key**: `Booster Maps - Web (PWA)` — pública-por-diseño (viaja en el bundle JS), protegida por restricción HTTP referrer a `https://app.boosterchile.com/*` (ADR-014). Los guardrails de costo viven en `infrastructure/api-cost-guardrails.tf` (ADR-034).

## Cuándo rotar

- Sospecha de abuso de cuota pese al referrer (revisar dashboard de api-cost-guardrails).
- Política de higiene periódica.
- Cambio de dominio del frontend.

## Procedimiento

1. **Crear la key nueva** en GCP Console (APIs & Services → Credentials) con las MISMAS restricciones: HTTP referrer `https://app.boosterchile.com/*`, y restricción de APIs mínima (Maps JavaScript API; revisar ADR-014 — la minimización de API surface quedó anotada como pendiente).
2. **PR normal** que cambie el default de la substitution `_VITE_GOOGLE_MAPS_API_KEY` en `cloudbuild.production.yaml` (sección `substitutions:`). La key es pública-por-diseño: el valor en el repo no es un secreto (gitleaks la allowlistea por esa razón; si alerta, revisar `.gitleaks.toml`).
3. **Merge a main** → release.yml → aprobación humana del Environment `production` → Cloud Build rebuildea `web` con la key nueva inyectada a build-time (las `VITE_*` se inlinean en el bundle: cambiar la key SIEMPRE requiere rebuild+redeploy, no es config de runtime).
4. **Verificar**: abrir `https://app.boosterchile.com/app/flota` y confirmar que el mapa carga sin errores de key en la consola del browser.
5. **Borrar la key vieja** en GCP Console recién después de verificar (la key vieja sigue sirviendo a clientes con bundle cacheado hasta que el SW actualice; esperar ~24h es lo prudente con `autoUpdate` del PWA).

## Lo que NO se hace

- ❌ `gcloud builds submit` desde laptop: salta ci.yml y el gate de aprobación humana (ese era el vector de `deploy-phase-2.sh`).
- ❌ Editar la key en el servicio Cloud Run `web`: las `VITE_*` son build-time, no runtime.

## Follow-up pendiente

- Gatear a nivel IAM quién puede `cloudbuild.builds.create` en el proyecto (hoy el gate humano vive solo en GitHub Actions). Tracked en `.specs/_followups/`.
