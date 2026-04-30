-- Migración 0002 — Seed de planes default.
--
-- Sin estos datos, /empresas/onboarding falla buscando un plan por slug.
-- Para piloto sin billing real, los planes existen como placeholders con
-- precio 0 (excepto enterprise con precio "consultar"). El cobro real
-- queda manual / por planilla hasta integrar Flow.cl o Stripe en post-launch.
--
-- Idempotente con ON CONFLICT (slug) DO NOTHING — re-correr la migración
-- contra una DB que ya los tiene es no-op.
--
-- Features JSONB respeta el schema en
-- @booster-ai/shared-schemas → planFeaturesSchema.

INSERT INTO "plans" ("slug", "name", "description", "monthly_price_clp", "features", "is_active") VALUES
  (
    'free',
    'Free',
    'Plan gratis para arrancar. Hasta 5 cargas activas y 3 vehículos.',
    0,
    '{
      "max_active_trips": 5,
      "max_vehicles": 3,
      "max_concurrent_offers": 5,
      "advanced_analytics": false,
      "auto_documents": false,
      "api_access": false,
      "matching_priority": 10
    }'::jsonb,
    true
  ),
  (
    'standard',
    'Standard',
    'Para empresas en operación regular. Carriers con flota mediana, shippers con cargas semanales.',
    49000,
    '{
      "max_active_trips": 50,
      "max_vehicles": 20,
      "max_concurrent_offers": 15,
      "advanced_analytics": false,
      "auto_documents": true,
      "api_access": false,
      "matching_priority": 30
    }'::jsonb,
    true
  ),
  (
    'pro',
    'Pro',
    'Para operación profesional con flotas grandes o múltiples cargas diarias.',
    149000,
    '{
      "max_active_trips": null,
      "max_vehicles": 100,
      "max_concurrent_offers": 30,
      "advanced_analytics": true,
      "auto_documents": true,
      "api_access": true,
      "matching_priority": 60
    }'::jsonb,
    true
  ),
  (
    'enterprise',
    'Enterprise',
    'Solución a medida para grandes empresas y holdings. Precio negociado, SLA dedicado.',
    0,
    '{
      "max_active_trips": null,
      "max_vehicles": null,
      "max_concurrent_offers": 100,
      "advanced_analytics": true,
      "auto_documents": true,
      "api_access": true,
      "matching_priority": 90
    }'::jsonb,
    true
  )
ON CONFLICT ("slug") DO NOTHING;
