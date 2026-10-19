import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';
import type {
  AsignacionInicio,
  Carga,
  CumplimientoInicio,
  DatosInicio,
  DocInicio,
  FuenteReintento,
  OfertaInicio,
  VehiculoFlotaInicio,
} from './modelo.js';

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

const vehiculosSchema = z.object({
  vehicles: z.array(z.object({ id: z.string() }).passthrough()),
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

function aCarga<T>(query: {
  isError: boolean;
  data: T | undefined;
}): Carga<T> {
  if (query.isError) {
    return { estado: 'error' };
  }
  if (query.data === undefined) {
    return { estado: 'cargando' };
  }
  return { estado: 'listo', valor: query.data };
}

/**
 * Lee el inicio con los mismos endpoints y las mismas claves de caché que
 * ofertas, servicios, cumplimiento, flota, vehículos y conductores.
 * Un fallo queda en su propia query: el resto del inicio sigue.
 */
export function useDatosInicio(): {
  datos: DatosInicio;
  reintentar: (fuente: FuenteReintento) => void;
} {
  const scope = useEmpresaScope();

  const ofertasQ = useQuery({
    queryKey: scope.key('offers', 'mine', 'pendiente'),
    queryFn: async (): Promise<OfertaInicio[]> => {
      const raw = await api.get<unknown>('/offers/mine?status=pendiente', scope.init);
      return parsear(ofertasSchema, raw, 'respuesta de ofertas inválida').offers;
    },
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const serviciosQ = useQuery({
    queryKey: scope.key('assignments', 'empresa'),
    queryFn: async (): Promise<AsignacionInicio[]> => {
      const raw = await api.get<unknown>('/assignments', scope.init);
      const filas = parsear(asignacionesSchema, raw, 'respuesta de servicios inválida').assignments;
      return filas.map((fila) => ({
        status: fila.status,
        sinConductor: fila.driver == null,
        pickupInicio: fila.trip.pickup_window_start,
        direccionOrigen: fila.trip.origin.address_raw,
      }));
    },
    retry: false,
    refetchInterval: 30_000,
  });

  const cumplimientoQ = useQuery({
    queryKey: scope.key('cumplimiento'),
    queryFn: async (): Promise<CumplimientoInicio> => {
      const raw = await api.get<unknown>('/cumplimiento', scope.init);
      const data = parsear(cumplimientoSchema, raw, 'respuesta de cumplimiento inválida');
      const documentos: DocInicio[] = [
        ...data.vehiculos.map((doc) => ({
          tipo: doc.tipo,
          estado: doc.estado,
          referencia: doc.plate,
          clase: 'vehiculo' as const,
        })),
        ...data.conductores.map((doc) => ({
          tipo: doc.tipo,
          estado: doc.estado,
          referencia: doc.full_name,
          clase: 'conductor' as const,
        })),
      ];
      return {
        vencidos: data.resumen.vencidos,
        porVencer30d: data.resumen.por_vencer_30d,
        documentos,
      };
    },
    retry: false,
  });

  const flotaQ = useQuery({
    queryKey: scope.key('flota'),
    queryFn: async (): Promise<VehiculoFlotaInicio[]> => {
      const raw = await api.get<unknown>('/vehiculos/flota', scope.init);
      const fleet = parsear(flotaSchema, raw, 'respuesta de flota inválida').fleet;
      return fleet.map((vehiculo) => ({
        plate: vehiculo.plate,
        teltonikaImei: vehiculo.teltonika_imei ?? null,
        timestampDevice: vehiculo.position?.timestamp_device ?? null,
        latitude: vehiculo.position?.latitude ?? null,
        longitude: vehiculo.position?.longitude ?? null,
      }));
    },
    retry: false,
    refetchInterval: 20_000,
  });

  const vehiculosQ = useQuery({
    queryKey: scope.key('vehiculos'),
    queryFn: async (): Promise<number> => {
      const raw = await api.get<unknown>('/vehiculos', scope.init);
      return parsear(vehiculosSchema, raw, 'respuesta de vehículos inválida').vehicles.length;
    },
    retry: false,
  });

  const conductoresQ = useQuery({
    queryKey: scope.key('conductores'),
    queryFn: async (): Promise<number> => {
      const raw = await api.get<unknown>('/conductores', scope.init);
      return parsear(conductoresSchema, raw, 'respuesta de conductores inválida').conductores
        .length;
    },
    retry: false,
  });

  function reintentar(fuente: FuenteReintento) {
    if (fuente === 'ofertas') {
      void ofertasQ.refetch();
      return;
    }
    if (fuente === 'servicios') {
      void serviciosQ.refetch();
      return;
    }
    if (fuente === 'cumplimiento') {
      void cumplimientoQ.refetch();
      return;
    }
    void flotaQ.refetch();
  }

  return {
    datos: {
      ofertas: aCarga(ofertasQ),
      servicios: aCarga(serviciosQ),
      cumplimiento: aCarga(cumplimientoQ),
      flota: aCarga(flotaQ),
      vehiculos: aCarga(vehiculosQ),
      conductores: aCarga(conductoresQ),
    },
    reintentar,
  };
}
