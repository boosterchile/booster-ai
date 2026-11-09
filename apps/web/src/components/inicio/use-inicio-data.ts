import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api-client.js';
import { useEmpresaScope } from '../../lib/empresa-activa.js';
import type { Panel } from './generador.js';
import { type CertificadoInicio, type ViajeInicio, kgDe } from './generador.js';

/**
 * Lecturas del Inicio por rol. Fase 2 cambia este módulo a
 * `GET /me/inicio-resumen`; hoy pega a los endpoints que ya existen.
 * Sin refetchInterval: el Inicio no polea solo.
 */
export type RolInicio = 'generador' | 'transportista' | 'mixta' | 'conductor';

const viajeSchema = z
  .object({
    id: z.string(),
    tracking_code: z.string(),
    status: z.string(),
    origin_address_raw: z.string(),
    destination_address_raw: z.string(),
    pickup_window_start: z.string().nullish(),
    proposed_price_clp: z.number().nullish(),
    transportista_nombre: z.string().nullish(),
    avance_pct: z.number().nullish(),
    ofertas_pendientes: z.number().nullish(),
  })
  .passthrough();

const listaViajesSchema = z.object({ trip_requests: z.array(viajeSchema) });

const certSchema = z
  .object({
    tracking_code: z.string(),
    kg_co2e: z.union([z.number(), z.string()]).nullish(),
    certificate_issued_at: z.string().nullish(),
    origin_address: z.string().nullish(),
    destination_address: z.string().nullish(),
  })
  .passthrough();

const listaCertSchema = z.object({ certificates: z.array(certSchema) });

function aViaje(row: z.infer<typeof viajeSchema>): ViajeInicio {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    status: row.status,
    origen: row.origin_address_raw,
    destino: row.destination_address_raw,
    pickupInicio: row.pickup_window_start ?? null,
    precioClp: row.proposed_price_clp ?? null,
    transportista: row.transportista_nombre ?? null,
    avancePct: row.avance_pct ?? null,
    ofertasPendientes: row.ofertas_pendientes ?? null,
  };
}

function aCert(row: z.infer<typeof certSchema>): CertificadoInicio {
  return {
    trackingCode: row.tracking_code,
    kg: kgDe(row.kg_co2e),
    emitidoEn: row.certificate_issued_at ?? null,
    origen: row.origin_address ?? '',
    destino: row.destination_address ?? '',
  };
}

function aPanel<T>(query: { isError: boolean; data: T | undefined }): Panel<T> {
  if (query.isError) {
    return { estado: 'error' };
  }
  if (query.data === undefined) {
    return { estado: 'cargando' };
  }
  return { estado: 'listo', valor: query.data };
}

export function useInicioData(rol: RolInicio): {
  viajes: Panel<ViajeInicio[]>;
  certificados: Panel<CertificadoInicio[]>;
  reintentar: (fuente: 'viajes' | 'certificados') => void;
} {
  const scope = useEmpresaScope();
  const pideGenerador = rol === 'generador' || rol === 'mixta';

  const viajesQ = useQuery({
    queryKey: scope.key('cargas', 'inicio'),
    queryFn: async () => {
      const raw = await api.get<unknown>('/trip-requests-v2', scope.init);
      return listaViajesSchema.parse(raw).trip_requests.map(aViaje);
    },
    enabled: pideGenerador,
    retry: false,
  });

  const certQ = useQuery({
    queryKey: scope.key('certificates', 'inicio'),
    queryFn: async () => {
      const raw = await api.get<unknown>('/certificates', scope.init);
      return listaCertSchema.parse(raw).certificates.map(aCert);
    },
    enabled: pideGenerador,
    retry: false,
  });

  return {
    viajes: pideGenerador ? aPanel(viajesQ) : { estado: 'vacio' },
    certificados: pideGenerador ? aPanel(certQ) : { estado: 'vacio' },
    reintentar: (fuente) => {
      if (fuente === 'certificados') {
        void certQ.refetch();
        return;
      }
      void viajesQ.refetch();
    },
  };
}
