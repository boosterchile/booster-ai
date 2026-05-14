-- ADR-039 — Site Settings Runtime Configuration
--
-- Tabla `configuracion_sitio` para configuración editable de marca y copy
-- desde el admin UI sin redeploy. Versionada (una fila por publicación
-- + drafts). Singleton sobre `publicada=true` para que el endpoint público
-- siempre tenga UNA versión vigente.

CREATE TABLE IF NOT EXISTS "configuracion_sitio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"publicada" boolean DEFAULT false NOT NULL,
	"nota_publicacion" text,
	"creado_por_email" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- Singleton: solo UNA fila con publicada=true a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS "configuracion_sitio_publicada_unique"
	ON "configuracion_sitio" ("publicada") WHERE "publicada" = true;

-- Versiones ordenadas por fecha (history más reciente primero).
CREATE INDEX IF NOT EXISTS "configuracion_sitio_creado_idx"
	ON "configuracion_sitio" ("creado_en" DESC);

-- Seed inicial con los valores hardcoded de produción al momento de
-- introducir esta feature (post PR #216 — propuesta de valor + logo
-- canónico + botones verde Booster). Fuente de verdad: `DEFAULT_SITE_CONFIG`
-- en packages/shared-schemas/src/site-settings.ts (mantener sincronizado).
INSERT INTO "configuracion_sitio" ("version", "config", "publicada", "nota_publicacion", "creado_por_email")
VALUES (
	1,
	'{
		"identity": {
			"logo_alt": "Booster AI"
		},
		"hero": {
			"headline_line1": "Transporta más,",
			"headline_line2": "impacta menos.",
			"subhead": "Marketplace B2B de logística sostenible para Chile. Conecta generadores de carga con transportistas, optimiza retornos vacíos y certifica huella de carbono bajo GLEC v3.0.",
			"microcopy": "Explora la demo desde cualquier rol — un click, sin registro."
		},
		"certifications": ["GLEC v3.0", "GHG Protocol", "ISO 14064", "k-anonymity ≥ 5"],
		"persona_cards": [
			{
				"persona": "shipper",
				"role": "Generador de carga",
				"entity_name": "Andina Demo S.A.",
				"tagline": "Publica cargas, ve ofertas y descarga certificados de huella verificada.",
				"highlights": ["2 sucursales activas (Maipú, Quilicura)", "Matching automático con transportistas", "Certificados GLEC v3.0 descargables"]
			},
			{
				"persona": "carrier",
				"role": "Transportista",
				"entity_name": "Transportes Demo Sur",
				"tagline": "Acepta cargas, asigna conductor y vehículo, factura sin papeles.",
				"highlights": ["2 vehículos · 1 conductor activo", "Seguimiento en tiempo real vía Teltonika", "Cobra Hoy · pronto pago integrado"]
			},
			{
				"persona": "conductor",
				"role": "Conductor profesional",
				"entity_name": "Pedro González",
				"tagline": "Ve tu próximo viaje, navega con la ruta eco y reporta GPS desde el celular.",
				"highlights": ["Modo Conductor full-screen", "Ruta eco-eficiente sugerida", "GPS móvil cuando no hay Teltonika"]
			},
			{
				"persona": "stakeholder",
				"role": "Observatorio sostenibilidad",
				"entity_name": "Observatorio Logístico",
				"tagline": "Métricas agregadas por zona logística con k-anonimización ≥ 5.",
				"highlights": ["Zonas: puertos, mercados, polos industriales", "Sin PII, sin empresas individuales", "Metodología pública auditable"]
			}
		]
	}'::jsonb,
	true,
	'Seed inicial con valores hardcoded de production post PR #216.',
	'system'
);
