import { z } from 'zod';

/**
 * Todos los IDs del sistema son UUIDs v4. Brands evitan que un id de un
 * dominio se cuele en otro a nivel de tipos.
 *
 * Naming bilingüe: las brands canónicas son español (`TransportistaId`,
 * `GeneradorCargaId`). Las legacy (`CarrierId`, `ShipperId`) se mantienen
 * como aliases para no romper schemas legacy del MVP (driver.ts,
 * cargo-request.ts) hasta que esos también migren.
 */
export const uuidSchema = z.string().uuid();
export const userIdSchema = uuidSchema.brand<'UserId'>();
export const empresaIdSchema = uuidSchema.brand<'EmpresaId'>();
export const planIdSchema = uuidSchema.brand<'PlanId'>();
export const membershipIdSchema = uuidSchema.brand<'MembershipId'>();
export const transportistaIdSchema = uuidSchema.brand<'TransportistaId'>();
export const generadorCargaIdSchema = uuidSchema.brand<'GeneradorCargaId'>();
export const driverIdSchema = uuidSchema.brand<'DriverId'>();
export const vehicleIdSchema = uuidSchema.brand<'VehicleId'>();
export const zoneIdSchema = uuidSchema.brand<'ZoneId'>();
export const tripIdSchema = uuidSchema.brand<'TripId'>();
export const tripRequestIdSchema = uuidSchema.brand<'TripRequestId'>();
export const cargoRequestIdSchema = uuidSchema.brand<'CargoRequestId'>();
export const offerIdSchema = uuidSchema.brand<'OfferId'>();
export const assignmentIdSchema = uuidSchema.brand<'AssignmentId'>();
export const tripEventIdSchema = uuidSchema.brand<'TripEventId'>();
export const stakeholderIdSchema = uuidSchema.brand<'StakeholderId'>();
export const consentIdSchema = uuidSchema.brand<'ConsentId'>();

/** @deprecated Usar `transportistaIdSchema`. Sólo en schemas legacy (driver.ts). */
export const carrierIdSchema = transportistaIdSchema;
/** @deprecated Usar `generadorCargaIdSchema`. Sólo en schemas legacy (cargo-request.ts). */
export const shipperIdSchema = generadorCargaIdSchema;

export type UserId = z.infer<typeof userIdSchema>;
export type EmpresaId = z.infer<typeof empresaIdSchema>;
export type PlanId = z.infer<typeof planIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type TransportistaId = z.infer<typeof transportistaIdSchema>;
export type GeneradorCargaId = z.infer<typeof generadorCargaIdSchema>;
export type DriverId = z.infer<typeof driverIdSchema>;
export type VehicleId = z.infer<typeof vehicleIdSchema>;
export type ZoneId = z.infer<typeof zoneIdSchema>;
export type TripId = z.infer<typeof tripIdSchema>;
export type TripRequestId = z.infer<typeof tripRequestIdSchema>;
export type CargoRequestId = z.infer<typeof cargoRequestIdSchema>;
export type OfferId = z.infer<typeof offerIdSchema>;
export type AssignmentId = z.infer<typeof assignmentIdSchema>;
export type TripEventId = z.infer<typeof tripEventIdSchema>;
export type StakeholderId = z.infer<typeof stakeholderIdSchema>;
export type ConsentId = z.infer<typeof consentIdSchema>;
/** @deprecated Usar `TransportistaId`. */
export type CarrierId = TransportistaId;
/** @deprecated Usar `GeneradorCargaId`. */
export type ShipperId = GeneradorCargaId;
