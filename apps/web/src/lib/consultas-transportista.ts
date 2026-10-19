import { z } from 'zod';
import { api } from './api-client.js';

/**
 * Lecturas que comparten clave de TanStack Query con la pantalla dueña.
 * `queryFn` devuelve la forma que esa pantalla guarda. El inicio y los
 * badges del sidebar derivan con `select` y no reemplazan el valor.
 */

const ofertasSchema = z.object({
  offers: z.array(z.object({ expires_at: z.string() }).passthrough()),
});

const asignacionesSchema = z.object({
  assignments: z.array(
    z
      .object({
        status: z.string(),
        driver: z.object({ user_id: z.string() }).passthrough().nullable(),
        trip: z
          .object({
            pickup_window_start: z.string().nullable(),
            origin: z.object({ address_raw: z.string() }).passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  ),
});

const docEstadoSchema = z.enum(['vencido', 'por_vencer', 'vigente']);

const cumplimientoSchema = z.object({
  resumen: z
    .object({
      vencidos: z.number(),
      por_vencer_30d: z.number(),
    })
    .passthrough(),
  vehiculos: z.array(
    z
      .object({
        plate: z.string(),
        tipo: z.string(),
        estado: docEstadoSchema,
      })
      .passthrough(),
  ),
  conductores: z.array(
    z
      .object({
        full_name: z.string(),
        tipo: z.string(),
        estado: docEstadoSchema,
      })
      .passthrough(),
  ),
});

const flotaSchema = z.object({
  fleet: z.array(
    z
      .object({
        plate: z.string(),
        teltonika_imei: z.string().nullish(),
        teltonika_source: z.enum(['own', 'mirror', 'browser_gps']).nullish(),
        status: z.enum(['activo', 'mantenimiento', 'retirado']).optional(),
        position: z
          .object({
            timestamp_device: z.string().nullish(),
            latitude: z.number().nullish(),
            longitude: z.number().nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  ),
});

const conductoresSchema = z.object({
  conductores: z.array(z.object({ id: z.string() }).passthrough()),
});

function parsear<T>(schema: z.ZodType<T>, raw: unknown, mensaje: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(mensaje);
  }
  return parsed.data;
}

export type OfertasCache = z.infer<typeof ofertasSchema>;
export type AsignacionCache = z.infer<typeof asignacionesSchema>['assignments'][number];
export type CumplimientoCache = z.infer<typeof cumplimientoSchema>;
export type FlotaCache = z.infer<typeof flotaSchema>['fleet'][number];
export type ConductorCache = z.infer<typeof conductoresSchema>['conductores'][number];

/** Misma forma que `useOffersMine`: `{ offers }`, no el arreglo pelado. */
export async function fetchOfertasPendientes(init: RequestInit): Promise<OfertasCache> {
  const raw = await api.get<unknown>('/offers/mine?status=pendiente', init);
  return parsear(ofertasSchema, raw, 'respuesta de ofertas inválida');
}

/** Misma forma que `/app/servicios`: el arreglo `assignments`. */
export async function fetchAsignaciones(init: RequestInit): Promise<AsignacionCache[]> {
  const raw = await api.get<unknown>('/assignments', init);
  return parsear(asignacionesSchema, raw, 'respuesta de servicios inválida').assignments;
}

/** Misma forma que `/app/cumplimiento`: la respuesta cruda. */
export async function fetchCumplimiento(init: RequestInit): Promise<CumplimientoCache> {
  const raw = await api.get<unknown>('/cumplimiento', init);
  return parsear(cumplimientoSchema, raw, 'respuesta de cumplimiento inválida');
}

/** Misma forma que `/app/flota`: el arreglo `fleet`, con `position`. */
export async function fetchFlota(init: RequestInit): Promise<FlotaCache[]> {
  const raw = await api.get<unknown>('/vehiculos/flota', init);
  return parsear(flotaSchema, raw, 'respuesta de flota inválida').fleet;
}

/** Misma forma que `/app/conductores`: el arreglo `conductores`. */
export async function fetchConductores(init: RequestInit): Promise<ConductorCache[]> {
  const raw = await api.get<unknown>('/conductores', init);
  return parsear(conductoresSchema, raw, 'respuesta de conductores inválida').conductores;
}
