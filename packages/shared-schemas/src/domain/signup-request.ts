import { z } from 'zod';

/**
 * Solicitudes de registro — signup público gated por admin-approval (SEC-001
 * Sprint 2b H1.2, plan-sprint-2b T7 + T8 + T10). Reemplaza el flow anterior
 * de `createUserWithEmailAndPassword` client-side por:
 *
 *   1. Visitante envía form → POST /api/v1/signup-request → row INSERT con
 *      `estado=pendiente_aprobacion`.
 *   2. Email a admin allowlist; admin aprueba en UI → backend ejecuta Admin
 *      SDK `auth.createUser` + UPDATE `estado=aprobado` + `aprobado_por` +
 *      `aprobado_en`.
 *   3. Admin reject → UPDATE `estado=rechazado` (cuenta nunca creada).
 *
 * Ver ADR-052 (`docs/adr/052-signup-migration-admin-sdk-gate.md`) Status
 * `Proposed` (T6) → `Accepted` (T13 post-canary success).
 *
 * Naming: español snake_case en SQL/enum DDL, camelCase en TS identifiers
 * (CLAUDE.md §Reglas naming bilingüe). Spec O-1 + amendment A3 v3.4.
 */
export const signupRequestEstadoSchema = z.enum(['pendiente_aprobacion', 'aprobado', 'rechazado']);
export type SignupRequestEstado = z.infer<typeof signupRequestEstadoSchema>;

export const signupRequestSchema = z.object({
  /**
   * UUID v4 generado por la BD (defaultRandom via pgcrypto gen_random_uuid).
   * Identifica la solicitud en la UI admin + en URLs de approve/reject.
   */
  id: z.string().uuid(),
  /**
   * Email del solicitante. Max 320 chars (RFC 5321 § 4.5.3.1.3 local-part
   * 64 + @ + domain 255 = 320). Validación lowercase a cargo del service
   * layer (T8) para evitar duplicates `Foo@x.cl` vs `foo@x.cl`.
   */
  email: z.string().email().max(320),
  /**
   * Nombre del solicitante tal como lo escribió en el form. Plain text;
   * se usa como `displayName` en Firebase `auth.createUser` post-approve
   * (T10). Max 200 chars para permitir nombres compuestos chilenos sin
   * truncate prematuro.
   */
  nombreCompleto: z.string().min(1).max(200),
  estado: signupRequestEstadoSchema,
  /**
   * Timestamp de la solicitud (INSERT). Default `now()` en BD.
   */
  requestedAt: z.string().datetime(),
  /**
   * Email del admin que aprobó la solicitud. NULL hasta que un admin
   * ejecuta approve. Persiste audit trail aún si el admin pierde acceso
   * (Ley 19.628 art. 5: responsabilidad del responsable del registro).
   */
  approvedBy: z.string().email().max(320).nullable(),
  /**
   * Timestamp del approve / reject. NULL mientras `estado=pendiente_aprobacion`.
   * NOT NULL si `estado IN ('aprobado','rechazado')`. Service layer (T10) es
   * responsable de mantener la invariante al UPDATE.
   */
  approvedAt: z.string().datetime().nullable(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;
