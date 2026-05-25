import { z } from 'zod';

/**
 * Cuentas demo — registry DB-driven que reemplaza module-level constants
 * pre-Sprint-2a (SEC-001 cierre, plan-sprint-2a T1+T3).
 *
 * Una row por cuenta demo (4 activas + N retiradas tras post-disclosure
 * account replacement por ADR-053). El seed (apps/api/src/services/
 * seed-demo-startup.ts) consulta esta tabla con SELECT email WHERE
 * persona=X AND deshabilitado_en IS NULL para decidir si crear o
 * skip una cuenta en cold-start. Idempotente by design.
 *
 * Naming: español snake_case per CLAUDE.md §Reglas naming bilingüe.
 * Equivalencias post v3.3 amendment 2026-05-25:
 *   generador_carga ↔ shipper
 *   transportista   ↔ carrier
 *   stakeholder     ↔ stakeholder (anglicismo aceptado)
 *   conductor       ↔ conductor
 *
 * Emails siguen English como identificadores (no contract): pattern
 * `demo-2026-<persona-en>@boosterchile.com` + `drivers+demo-2026-
 * conductor@boosterchile.invalid` para conductor (per spec
 * SC-1.1.1 v3.2).
 */
export const personaDemoSchema = z.enum([
  'generador_carga',
  'transportista',
  'stakeholder',
  'conductor',
]);
export type PersonaDemo = z.infer<typeof personaDemoSchema>;

export const cuentaDemoSchema = z.object({
  persona: personaDemoSchema,
  email: z.string().email().max(320),
  /**
   * Firebase UID asignado por Admin SDK auth.createUser. Null durante
   * la creación inicial (entre INSERT row y llamada Firebase). NULL
   * transitorio es estado válido — el script T4 detect y resume.
   */
  firebase_uid: z.string().min(1).max(128).nullable(),
  creado_en: z.string().datetime(),
  /**
   * Timestamp cuando la cuenta fue retirada via auth.updateUser({
   * disabled: true }). NULL = activa. NOT NULL = retirada
   * irreversiblemente per ADR-053.
   */
  deshabilitado_en: z.string().datetime().nullable(),
});
export type CuentaDemo = z.infer<typeof cuentaDemoSchema>;
