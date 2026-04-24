import { z } from 'zod';

/**
 * Todos los IDs del sistema son UUIDs v4.
 */
export const uuidSchema = z.string().uuid();
export const userIdSchema = uuidSchema.brand<'UserId'>();
export const carrierIdSchema = uuidSchema.brand<'CarrierId'>();
export const driverIdSchema = uuidSchema.brand<'DriverId'>();
export const vehicleIdSchema = uuidSchema.brand<'VehicleId'>();
export const shipperIdSchema = uuidSchema.brand<'ShipperId'>();
export const tripIdSchema = uuidSchema.brand<'TripId'>();
export const cargoRequestIdSchema = uuidSchema.brand<'CargoRequestId'>();
export const stakeholderIdSchema = uuidSchema.brand<'StakeholderId'>();

export type UserId = z.infer<typeof userIdSchema>;
export type CarrierId = z.infer<typeof carrierIdSchema>;
export type DriverId = z.infer<typeof driverIdSchema>;
export type VehicleId = z.infer<typeof vehicleIdSchema>;
export type ShipperId = z.infer<typeof shipperIdSchema>;
export type TripId = z.infer<typeof tripIdSchema>;
export type CargoRequestId = z.infer<typeof cargoRequestIdSchema>;
export type StakeholderId = z.infer<typeof stakeholderIdSchema>;
