import { z } from 'zod';
import { chileanPhoneSchema } from '../primitives/chile.js';
import { driverIdSchema, transportistaIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Clases de licencia chilena (DS Nº 170 Ley Tránsito).
 *
 * - A1-A5: profesionales (taxi, transporte público, camiones). A5 es la
 *   única que habilita camión articulado >3500 kg + remolque.
 * - B: particulares hasta 9 pasajeros / 3500 kg.
 * - C: motocicletas.
 * - D: maquinaria automotriz no agrícola.
 * - E: tracción animal (rural histórico).
 * - F: vehículos institucionales (carabineros, FFAA).
 */
export const licenseClassSchema = z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F']);
export type LicenseClass = z.infer<typeof licenseClassSchema>;

export const driverStatusSchema = z.enum(['activo', 'suspendido', 'en_viaje', 'fuera_servicio']);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

/**
 * Schema del row `conductores` tal como lo devuelve el API.
 *
 * Notas:
 * - El RUT y el nombre completo viven en `users` (que es la identidad
 *   Firebase). Acá solo está el `user_id`. Los endpoints típicamente hacen
 *   join y exponen `user` anidado en la respuesta de lectura.
 * - Sin `vehiculo_principal_id`: la asignación conductor↔vehículo vive en
 *   `asignaciones` (ver memoria project_identity_model_decisions.md).
 */
export const driverSchema = z.object({
  id: driverIdSchema,
  user_id: userIdSchema,
  empresa_id: transportistaIdSchema,
  license_class: licenseClassSchema,
  license_number: z.string().min(1).max(50),
  /** Fecha (sin hora) de vencimiento. ISO `YYYY-MM-DD`. */
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'license_expiry debe ser ISO YYYY-MM-DD'),
  /**
   * `true` si el conductor no es chileno residente. Algunos puertos y
   * plantas industriales bloquean conductores extranjeros — la validación
   * ocurre al crear la asignación, no en este schema.
   */
  is_extranjero: z.boolean().default(false),
  status: driverStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** ISO datetime si soft-deleted, null si activo. */
  deleted_at: z.string().datetime().nullable(),
});

export type Driver = z.infer<typeof driverSchema>;

/**
 * Correo que no es un canal real: el de relleno del alta vieja y los
 * sintéticos de Firebase (`drivers+` / `users+` en el dominio reservado
 * `.invalid`). Nadie puede recibir la invitación ahí.
 */
export function esEmailDeRelleno(email: string): boolean {
  const normal = email.trim().toLowerCase();
  const arroba = normal.lastIndexOf('@');
  if (arroba < 1 || arroba === normal.length - 1) {
    return false;
  }
  const local = normal.slice(0, arroba);
  const dominio = normal.slice(arroba + 1);
  return dominio === 'boosterchile.invalid' || local.startsWith('pending-rut-');
}

/** Mensaje único del formato, en la ficha y en el alta. */
export const MENSAJE_EMAIL_CONDUCTOR = 'Escribe un email válido, como nombre@dominio.cl';

/**
 * El dominio tiene que incluir un punto y un TLD de al menos dos letras.
 * `a@b` y `a@b.c` no alcanzan. Zod `.email()` ya rechaza varios de estos
 * casos; el refine deja la regla en el contrato, no en el regex de la librería.
 */
function dominioConTld(email: string): boolean {
  const arroba = email.lastIndexOf('@');
  if (arroba < 1 || arroba === email.length - 1) {
    return false;
  }
  const etiquetas = email.slice(arroba + 1).split('.');
  if (etiquetas.length < 2) {
    return false;
  }
  const tld = etiquetas.at(-1) ?? '';
  return (
    /^[a-z]{2,}$/i.test(tld) && etiquetas.slice(0, -1).every((etiqueta) => etiqueta.length > 0)
  );
}

/**
 * Email de contacto del conductor. Obligatorio, en minúsculas, con TLD, y
 * nunca el de relleno. El máximo coincide con `usuarios.email` (varchar 255).
 */
export const conductorContactEmailSchema = z
  .string()
  .trim()
  .min(3, MENSAJE_EMAIL_CONDUCTOR)
  .max(255, MENSAJE_EMAIL_CONDUCTOR)
  .email(MENSAJE_EMAIL_CONDUCTOR)
  .refine(dominioConTld, { message: MENSAJE_EMAIL_CONDUCTOR })
  .transform((value) => value.toLowerCase())
  .refine((value) => !esEmailDeRelleno(value), {
    message: 'Tiene que ser el email real del conductor.',
  });

export type ConductorContactEmail = z.infer<typeof conductorContactEmailSchema>;

/**
 * Body para crear un conductor desde la interfaz transportista. El RUT del
 * conductor se recibe acá (no en `users`) porque la creación primero hace
 * `lookup` y si el user existe, lo enlaza; si no, crea user + envía invite.
 */
export const createDriverBodySchema = z.object({
  rut: z.string().min(1),
  full_name: z.string().min(1).max(200),
  /**
   * Email real del conductor. **Obligatorio** desde `equipo-de-la-empresa`
   * Fase B: es el canal de comunicación de la plataforma con esa persona.
   *
   * Era `nullable().optional()` y caía a `pending-rut-…@boosterchile.invalid`.
   * Medido en prod el 2026-07-31: **5 de 6 conductores** quedaron así — gente
   * a la que el sistema no puede escribirle. El dato no se perdió, nunca se
   * pidió.
   */
  email: conductorContactEmailSchema,
  /**
   * Teléfono móvil en E.164. **Obligatorio** desde 2026-08-03: WhatsApp es el
   * canal principal hacia el conductor — los conductores chilenos de camión
   * usan WhatsApp, no correo. Por acá le llega el enlace de activación.
   * El PIN no viaja por WhatsApp.
   *
   * Era `nullable().optional()`. Medido en prod: 2 de 7 conductores quedaron
   * sin número, o sea inalcanzables por el canal que más van a usar. Mismo
   * razonamiento que llevó a exigir el email en la Fase B: el dato no se
   * perdió, nunca se pidió.
   */
  phone: chileanPhoneSchema,
  license_class: licenseClassSchema,
  license_number: z.string().min(1).max(50),
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_extranjero: z.boolean().default(false),
});

export type CreateDriverBody = z.infer<typeof createDriverBodySchema>;

export const updateDriverBodySchema = z.object({
  license_class: licenseClassSchema.optional(),
  license_number: z.string().min(1).max(50).optional(),
  license_expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  is_extranjero: z.boolean().optional(),
  status: driverStatusSchema.optional(),
});

export type UpdateDriverBody = z.infer<typeof updateDriverBodySchema>;

/** Corregir el email de contacto y, si sigue pendiente, reenviar la invitación. */
export const corregirEmailConductorBodySchema = z.object({
  email: conductorContactEmailSchema,
});

export type CorregirEmailConductorBody = z.infer<typeof corregirEmailConductorBodySchema>;
