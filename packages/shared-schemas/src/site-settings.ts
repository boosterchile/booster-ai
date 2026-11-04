import { z } from 'zod';
import { errorOpcion, textoEs, urlEs } from './primitives/mensajes.js';

/**
 * Schema canónico de configuración del sitio (Booster AI).
 *
 * El admin puede editar estos campos desde
 * `/app/platform-admin/site-settings` y los cambios aplican en runtime
 * a `/login` y `/onboarding` sin redeploy.
 *
 * ADR-039 — Site Settings Runtime Configuration.
 *
 * El backend persiste como JSONB en la tabla `configuracion_sitio`
 * (versionada, singleton sobre `publicada=true`). El frontend lo lee
 * vía `GET /public/site-settings` (cache 5min) y aplica fallback a
 * defaults hardcoded si falla.
 */

export const siteIdentitySchema = z.object({
  /**
   * URL HTTPS del logo principal. Override del SVG default
   * `/icons/icon.svg`. Sirve desde el bucket público
   * `booster-ai-public-assets-{env}`.
   */
  logo_url: urlEs().optional(),
  /** Texto alternativo del logo para accesibilidad. */
  logo_alt: textoEs(1, 60).default('Booster AI'),
  /** URL HTTPS del favicon. Override del default. */
  favicon_url: urlEs().optional(),
  /**
   * Color primario en formato hex `#RRGGBB`. Override del verde
   * Booster default `#1fa058`. Propaga a CSS variable `--color-primary-500`
   * (y el bundle resuelve las variantes 600/700 con shift de luminosidad).
   */
  primary_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/i, 'Usa un color en formato #RRGGBB, como #0B5FFF')
    .optional(),
});

export const heroSchema = z.object({
  /** Primera línea del headline. */
  headline_line1: textoEs(1, 80),
  /** Segunda línea (renderiza en color acento primary). */
  headline_line2: textoEs(1, 80),
  /** Texto descriptivo bajo el headline. */
  subhead: textoEs(1, 500),
  /** Microcopy adicional (opcional, debajo del subhead). */
  microcopy: textoEs(1, 200),
});

export const certificationSchema = textoEs(1, 40);

export const personaCardSchema = z.object({
  persona: z.enum(['shipper', 'carrier', 'conductor', 'stakeholder'], { error: errorOpcion }),
  role: textoEs(1, 50),
  entity_name: textoEs(1, 80),
  tagline: textoEs(1, 200),
  highlights: z
    .array(textoEs(1, 100))
    .min(1, 'Agrega al menos 1 punto')
    .max(5, 'Usa como máximo 5 puntos'),
});

export const onboardingCopySchema = z.object({
  step1_title: textoEs(1, 100),
  step2_title: textoEs(1, 100),
  step3_title: textoEs(1, 100),
  step4_title: textoEs(1, 100),
});

export const loginCopySchema = z.object({
  hero_title: textoEs(1, 100),
  hero_subtitle: textoEs(1, 300),
});

export const siteConfigSchema = z.object({
  identity: siteIdentitySchema,
  hero: heroSchema,
  certifications: z.array(certificationSchema).max(8, 'Usa como máximo 8 certificaciones'),
  persona_cards: z.array(personaCardSchema).length(4, 'Agrega exactamente 4 tarjetas'),
  onboarding: onboardingCopySchema.optional(),
  login: loginCopySchema.optional(),
});

export type SiteIdentity = z.infer<typeof siteIdentitySchema>;
export type Hero = z.infer<typeof heroSchema>;
export type PersonaCard = z.infer<typeof personaCardSchema>;
export type OnboardingCopy = z.infer<typeof onboardingCopySchema>;
export type LoginCopy = z.infer<typeof loginCopySchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;

/**
 * Defaults canónicos — usados como fallback en frontend y como seed
 * inicial de la migration 0033. Single source of truth de los valores
 * de marca actuales (PR #216).
 */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  identity: {
    logo_alt: 'Booster AI',
  },
  hero: {
    headline_line1: 'Transporta más,',
    headline_line2: 'impacta menos.',
    subhead:
      'Marketplace B2B de logística sostenible para Chile. Conecta generadores de carga con transportistas, optimiza retornos vacíos y certifica huella de carbono bajo GLEC v3.0.',
    microcopy: 'Explora la demo desde cualquier rol — un click, sin registro.',
  },
  certifications: ['GLEC v3.0', 'GHG Protocol', 'ISO 14064', 'k-anonymity ≥ 5'],
  persona_cards: [
    {
      persona: 'shipper',
      role: 'Generador de carga',
      entity_name: 'Andina Demo S.A.',
      tagline: 'Publica cargas, ve ofertas y descarga certificados de huella verificada.',
      highlights: [
        '2 sucursales activas (Maipú, Quilicura)',
        'Matching automático con transportistas',
        'Certificados GLEC v3.0 descargables',
      ],
    },
    {
      persona: 'carrier',
      role: 'Transportista',
      entity_name: 'Transportes Demo Sur',
      tagline: 'Acepta cargas, asigna conductor y vehículo, factura sin papeles.',
      highlights: [
        '2 vehículos · 1 conductor activo',
        'Seguimiento en tiempo real vía Teltonika',
        'Cobra Hoy · pronto pago integrado',
      ],
    },
    {
      persona: 'conductor',
      role: 'Conductor profesional',
      entity_name: 'Pedro González',
      tagline: 'Ve tu próximo viaje, navega con la ruta eco y reporta GPS desde el celular.',
      highlights: [
        'Modo Conductor full-screen',
        'Ruta eco-eficiente sugerida',
        'GPS celular cuando no hay Teltonika',
      ],
    },
    {
      persona: 'stakeholder',
      role: 'Observatorio sostenibilidad',
      entity_name: 'Observatorio Logístico',
      tagline: 'Métricas agregadas por zona logística con k-anonimización ≥ 5.',
      highlights: [
        'Zonas: puertos, mercados, polos industriales',
        'Sin PII, sin empresas individuales',
        'Metodología pública auditable',
      ],
    },
  ],
};
