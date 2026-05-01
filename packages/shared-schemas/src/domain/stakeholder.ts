import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { consentIdSchema, stakeholderIdSchema, userIdSchema } from '../primitives/ids.js';

export const stakeholderTypeSchema = z.enum([
  'mandante_corporativo',
  'sostenibilidad_interna',
  'auditor',
  'regulador',
  'inversor',
]);
export type StakeholderType = z.infer<typeof stakeholderTypeSchema>;

/**
 * Estándares de reporte ESG. Mantenidos en MAYÚSCULAS por ser siglas
 * internacionales reconocidas — única excepción a la regla "enums en
 * español snake_case sin tildes".
 */
export const reportingStandardSchema = z.enum([
  'GLEC_V3',
  'GHG_PROTOCOL',
  'ISO_14064',
  'GRI',
  'SASB',
  'CDP',
]);
export type ReportingStandard = z.infer<typeof reportingStandardSchema>;

export const reportCadenceSchema = z.enum(['mensual', 'trimestral', 'anual', 'bajo_demanda']);
export type ReportCadence = z.infer<typeof reportCadenceSchema>;

export const consentScopeTypeSchema = z.enum([
  'generador_carga',
  'transportista',
  'portafolio_viajes',
  'organizacion',
]);
export type ConsentScopeType = z.infer<typeof consentScopeTypeSchema>;

export const consentDataCategorySchema = z.enum([
  'emisiones_carbono',
  'rutas',
  'distancias',
  'combustibles',
  'certificados',
  'perfiles_vehiculos',
]);
export type ConsentDataCategory = z.infer<typeof consentDataCategorySchema>;

/**
 * Scope de acceso otorgado por un generador de carga / transportista a un
 * stakeholder ESG. Ver ADR-004 sección "Acceso consent-based de
 * Sustainability Stakeholders".
 */
export const consentGrantSchema = z.object({
  id: consentIdSchema,
  granted_by_user_id: userIdSchema,
  scope_type: consentScopeTypeSchema,
  scope_id: z.string().uuid(),
  data_categories: z.array(consentDataCategorySchema).min(1),
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
  report_cadence: reportCadenceSchema.default('bajo_demanda'),
  scopes: z.array(consentGrantSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type SustainabilityStakeholder = z.infer<typeof sustainabilityStakeholderSchema>;
