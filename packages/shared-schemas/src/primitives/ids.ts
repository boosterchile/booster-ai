import { z } from 'zod';

/**
 * Todos los IDs del sistema son UUIDs v4.
 */
export const uuidSchema = z.string().uuid();
export const userIdSchema = uuidSchema.brand<'UserId'>();
export const empresaIdSchema = uuidSchema.brand<'EmpresaId'>();
export const planIdSchema = uuidSchema.brand<'PlanId'>();
export const membershipIdSchema = uuidSchema.brand<'MembershipId'>();
export const carrierIdSchema = uuidSchema.brand<'CarrierId'>();
export const driverIdSchema = uuidSchema.brand<'DriverId'>();
export const vehicleIdSchema = uuidSchema.brand<'VehicleId'>();
export const shipperIdSchema = uuidSchema.brand<'ShipperId'>();
export const zoneIdSchema = uuidSchema.brand<'ZoneId'>();
export const tripIdSchema = uuidSchema.brand<'TripId'>();
export const tripRequestIdSchema = uuidSchema.brand<'TripRequestId'>();
export const cargoRequestIdSchema = uuidSchema.brand<'CargoRequestId'>();
export const offerIdSchema = uuidSchema.brand<'OfferId'>();
export const assignmentIdSchema = uuidSchema.brand<'AssignmentId'>();
export const tripEventIdSchema = uuidSchema.brand<'TripEventId'>();
export const stakeholderIdSchema = uuidSchema.brand<'StakeholderId'>();

export type UserId = z.infer<typeof userIdSchema>;
export type EmpresaId = z.infer<typeof empresaIdSchema>;
export type PlanId = z.infer<typeof planIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type CarrierId = z.infer<typeof carrierIdSchema>;
export type DriverId = z.infer<typeof driverIdSchema>;
export type VehicleId = z.infer<typeof vehicleIdSchema>;
export type ShipperId = z.infer<typeof shipperIdSchema>;
export type ZoneId = z.infer<typeof zoneIdSchema>;
export type TripId = z.infer<typeof tripIdSchema>;
export type TripRequestId = z.infer<typeof tripRequestIdSchema>;
export type CargoRequestId = z.infer<typeof cargoRequestIdSchema>;
export type OfferId = z.infer<typeof offerIdSchema>;
export type AssignmentId = z.infer<typeof assignmentIdSchema>;
export type TripEventId = z.infer<typeof tripEventIdSchema>;
export type StakeholderId = z.infer<typeof stakeholderIdSchema>;
