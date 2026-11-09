import { z } from 'zod';
import { textoEs } from './mensajes.js';

/**
 * Coordenadas WGS84 con validación de rango.
 * Para Chile: lat entre -56 y -17, lng entre -109 y -66.
 */
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const positionSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  accuracy_m: z.number().nonnegative().optional(),
  altitude_m: z.number().optional(),
  heading_deg: z.number().min(0).max(360).optional(),
  speed_kmh: z.number().nonnegative().optional(),
});

export type Position = z.infer<typeof positionSchema>;

/**
 * Dirección postal. Incluye opcional geocode (lat/lng).
 */
export const addressSchema = z.object({
  street: textoEs(1),
  number: z.string().optional(),
  apartment: z.string().optional(),
  commune: textoEs(1),
  city: textoEs(1),
  region: textoEs(1),
  country: z.string().default('CL'),
  postalCode: z.string().optional(),
  geocode: positionSchema.optional(),
});

export type Address = z.infer<typeof addressSchema>;
