import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { uuidSchema } from '../primitives/ids.js';
import { MENSAJES } from '../primitives/mensajes.js';
import { cargoTypeSchema } from './cargo-request.js';

/**
 * BARH-24 — body de POST /viajes-propios.
 * Cliente: generador registrado en Booster **o** externo (nombre obligatorio).
 */

const lugarViajePropioSchema = z.object({
  address_raw: z
    .string()
    .trim()
    .min(5, 'Ingresa una dirección (mínimo 5 caracteres)')
    .max(500, 'La dirección es demasiado larga'),
  region_code: z.string().trim().min(1, 'Selecciona una región').max(4),
  comuna_code: z.string().trim().min(1).max(10).optional(),
});

const clienteGeneradorSchema = z.object({
  tipo: z.literal('generador'),
  empresa_id: uuidSchema,
});

const clienteExternoSchema = z.object({
  tipo: z.literal('externo'),
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa el nombre del cliente')
    .max(200, 'El nombre es demasiado largo'),
  rut: rutSchema.optional(),
  contacto: z.string().trim().min(1).max(200).optional(),
  /** Ahí se le envía el certificado (`.specs/frente2-cierre` D2). */
  correo: z.string().trim().toLowerCase().email('Ingresa un correo válido').max(254).optional(),
});

export const crearViajePropioBodySchema = z.object({
  origen: lugarViajePropioSchema,
  destino: lugarViajePropioSchema,
  cargo_type: cargoTypeSchema,
  cargo_weight_kg: z
    .number({ error: MENSAJES.numero })
    .int(MENSAJES.numero)
    .positive('El peso debe ser mayor que 0')
    .optional(),
  cargo_volume_m3: z
    .number({ error: MENSAJES.numero })
    .int(MENSAJES.numero)
    .positive('El volumen debe ser mayor que 0')
    .optional(),
  pickup_date_raw: z
    .string()
    .trim()
    .min(1, 'Indica la fecha de recogida')
    .max(200, 'La fecha de recogida es demasiado larga'),
  cliente: z.discriminatedUnion('tipo', [clienteGeneradorSchema, clienteExternoSchema]),
});

export type CrearViajePropioBody = z.infer<typeof crearViajePropioBodySchema>;
