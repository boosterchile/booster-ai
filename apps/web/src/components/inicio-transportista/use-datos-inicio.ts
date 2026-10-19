import { useQuery } from '@tanstack/react-query';
import { fetchVehiculosEmpresa } from '../../components/vehiculos-lista.js';
import {
  type AsignacionCache,
  type ConductorCache,
  type CumplimientoCache,
  type FlotaCache,
  type OfertasCache,
  fetchAsignaciones,
  fetchConductores,
  fetchCumplimiento,
  fetchFlota,
  fetchOfertasPendientes,
} from '../../lib/consultas-transportista.js';
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

function aCarga<T>(query: { isError: boolean; data: T | undefined }): Carga<T> {
  if (query.isError) {
    return { estado: 'error' };
  }
  if (query.data === undefined) {
    return { estado: 'cargando' };
  }
  return { estado: 'listo', valor: query.data };
}

function seleccionarOfertas(data: OfertasCache): OfertaInicio[] {
  return data.offers.map((oferta) => ({
    expires_at: oferta.expires_at,
    precioClp: oferta.proposed_price_clp ?? null,
    origen: oferta.trip_request?.origin_address_raw ?? '',
    destino: oferta.trip_request?.destination_address_raw ?? '',
  }));
}

function seleccionarServicios(filas: AsignacionCache[]): AsignacionInicio[] {
  return filas.map((fila) => ({
    ...(fila.id ? { id: fila.id } : {}),
    status: fila.status,
    sinConductor: fila.driver == null,
    pickupInicio: fila.trip.pickup_window_start,
    direccionOrigen: fila.trip.origin.address_raw,
    direccionDestino: fila.trip.destination?.address_raw ?? '',
    patente: fila.vehicle?.plate ?? null,
    conductor: fila.driver?.full_name ?? null,
  }));
}

function seleccionarCumplimiento(data: CumplimientoCache): CumplimientoInicio {
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
}

function seleccionarFlota(fleet: FlotaCache[]): VehiculoFlotaInicio[] {
  return fleet.map((vehiculo) => {
    const item: VehiculoFlotaInicio = {
      ...(vehiculo.id ? { id: vehiculo.id } : {}),
      plate: vehiculo.plate,
      teltonikaImei: vehiculo.teltonika_imei ?? null,
      timestampDevice: vehiculo.position?.timestamp_device ?? null,
      latitude: vehiculo.position?.latitude ?? null,
      longitude: vehiculo.position?.longitude ?? null,
    };
    if (vehiculo.status) {
      item.status = vehiculo.status;
    }
    if (vehiculo.teltonika_source) {
      item.teltonikaSource = vehiculo.teltonika_source;
    }
    return item;
  });
}

function contarFilas(filas: readonly unknown[]): number {
  return filas.length;
}

function contarConductores(filas: ConductorCache[]): number {
  return filas.length;
}

/**
 * Lee el inicio con los mismos endpoints y las mismas claves que las
 * pantallas dueñas. La caché guarda la forma de ellas; `select` arma la vista.
 * Un fallo queda en su propia query: el resto del inicio sigue.
 */
export function useDatosInicio(): {
  datos: DatosInicio;
  reintentar: (fuente: FuenteReintento) => void;
} {
  const scope = useEmpresaScope();

  // Sin refetchInterval: el Inicio y los badges del sidebar observan las
  // mismas claves. Cada observer con intervalo tenía su propio timer
  // (flota cada 20 s, ofertas y servicios cada 30 s) y una sesión quieta
  // acumulaba cientos de GET. La pantalla dueña sigue poleando cuando está abierta.
  const ofertasQ = useQuery({
    queryKey: scope.key('offers', 'mine', 'pendiente'),
    queryFn: () => fetchOfertasPendientes(scope.init),
    select: seleccionarOfertas,
    retry: false,
    staleTime: 15_000,
  });

  const serviciosQ = useQuery({
    queryKey: scope.key('assignments', 'empresa'),
    queryFn: () => fetchAsignaciones(scope.init),
    select: seleccionarServicios,
    retry: false,
  });

  const cumplimientoQ = useQuery({
    queryKey: scope.key('cumplimiento'),
    queryFn: () => fetchCumplimiento(scope.init),
    select: seleccionarCumplimiento,
    retry: false,
  });

  const flotaQ = useQuery({
    queryKey: scope.key('flota'),
    queryFn: () => fetchFlota(scope.init),
    select: seleccionarFlota,
    retry: false,
  });

  const vehiculosQ = useQuery({
    queryKey: scope.key('vehiculos'),
    queryFn: () => fetchVehiculosEmpresa(scope.init),
    select: contarFilas,
    retry: false,
  });

  const conductoresQ = useQuery({
    queryKey: scope.key('conductores'),
    queryFn: () => fetchConductores(scope.init),
    select: contarConductores,
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
    if (fuente === 'vehiculos') {
      void vehiculosQ.refetch();
      return;
    }
    if (fuente === 'conductores') {
      void conductoresQ.refetch();
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
      // Plata del inicio está apagada: no pedimos el historial de Cobra hoy.
      cobraHoy: 'disponible',
    },
    reintentar,
  };
}
