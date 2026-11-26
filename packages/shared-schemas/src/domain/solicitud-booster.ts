import { z } from 'zod';

/**
 * «Pedir a Booster» (`.specs/frente2-cierre` §3.4, decisión D3 del PO): una
 * empresa pide al personal de Booster una configuración que ya no edita ella
 * misma. La solicitud queda abierta hasta que el personal la marca resuelta
 * desde su panel. Tabla `solicitudes_booster` (migración 0091).
 */

/** Lo que se puede pedir. Hoy solo la fuente CAN de combustible del vehículo. */
export const TIPOS_SOLICITUD_BOOSTER = ['configurar_fuente_combustible'] as const;
export const tipoSolicitudBoosterSchema = z.enum(TIPOS_SOLICITUD_BOOSTER);
export type TipoSolicitudBooster = z.infer<typeof tipoSolicitudBoosterSchema>;

export const ESTADOS_SOLICITUD_BOOSTER = ['abierta', 'resuelta'] as const;
export const estadoSolicitudBoosterSchema = z.enum(ESTADOS_SOLICITUD_BOOSTER);
export type EstadoSolicitudBooster = z.infer<typeof estadoSolicitudBoosterSchema>;

/** Cómo se nombra cada tipo en la interfaz. */
export const ETIQUETA_TIPO_SOLICITUD_BOOSTER: Record<TipoSolicitudBooster, string> = {
  configurar_fuente_combustible: 'Configurar la fuente CAN de combustible',
};

/** Body de `POST /vehiculos/:id/pedir-booster`. */
export const pedirABoosterBodySchema = z.object({ tipo: tipoSolicitudBoosterSchema });
export type PedirABoosterBody = z.infer<typeof pedirABoosterBodySchema>;

/** La solicitud que devuelve `POST /vehiculos/:id/pedir-booster`. */
export const solicitudBoosterSchema = z.object({
  id: z.string(),
  tipo: tipoSolicitudBoosterSchema,
  estado: estadoSolicitudBoosterSchema,
  vehiculo_id: z.string().nullable(),
  creada_en: z.string(),
});
export type SolicitudBooster = z.infer<typeof solicitudBoosterSchema>;

export const respuestaPedirABoosterSchema = z.object({ solicitud: solicitudBoosterSchema });

/** Una fila de `GET /admin/plataforma/solicitudes`: las abiertas de todas las empresas. */
export const solicitudBoosterAbiertaSchema = z.object({
  id: z.string(),
  tipo: tipoSolicitudBoosterSchema,
  empresa: z.object({ id: z.string(), nombre: z.string() }),
  vehiculo: z.object({ id: z.string(), patente: z.string() }).nullable(),
  creada_en: z.string(),
});
export type SolicitudBoosterAbierta = z.infer<typeof solicitudBoosterAbiertaSchema>;

export const listaSolicitudesBoosterSchema = z.object({
  solicitudes: z.array(solicitudBoosterAbiertaSchema),
});
