import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { stakeholderIdSchema, userIdSchema } from '../primitives/ids.js';

export const stakeholderTypeSchema = z.enum([
  'corporate_mandator',
  'internal_sustainability',
  'auditor',
  'regulator',
  'investor',
]);

export const reportingStandardSchema = z.enum([
  'GLEC_V3',
  'GHG_PROTOCOL',
  'ISO_14064',
  'GRI',
  'SASB',
  'CDP',
]);

export const dataCategorySchema = z.enum([
  'carbon_emissions',
  'routes',
  'distances',
  'fuels',
  'certificates',
  'vehicle_profiles',
]);

/**
 * Scope de acceso otorgado por un shipper/carrier a un stakeholder ESG.
 * Ver ADR-004 sección "Acceso consent-based de Sustainability Stakeholders".
 */
export const consentGrantSchema = z.object({
  id: z.string().uuid(),
  granted_by_user_id: userIdSchema,
  scope_type: z.enum(['shipper', 'carrier', 'trip_portfolio', 'organization']),
  scope_id: z.string().uuid(),
  data_categories: z.array(dataCategorySchema).min(1),
  granted_at: z.string().datetime(),
  expires_at: z.string().datetime().nullable(),
  revoked_at: z.string().datetime().nullable(),
  consent_document_url: z.string().url(),
});

export type ConsentGrant = z.infer<typeof consentGrantSchema>;

export const sustainabilityStakeholderSchema = z.object({
  id: stakeholderIdSchema,
  user_id: userIdSchema,
  organization_name: z.string().min(1),
  organization_rut: rutSchema.optional(),
  stakeholder_type: stakeholderTypeSchema,
  reporting_standards: z.array(reportingStandardSchema).default([]),
  report_cadence: z.enum(['monthly', 'quarterly', 'annual', 'on_demand']).default('on_demand'),
  scopes: z.array(consentGrantSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type SustainabilityStakeholder = z.infer<typeof sustainabilityStakeholderSchema>;
export type StakeholderType = z.infer<typeof stakeholderTypeSchema>;
