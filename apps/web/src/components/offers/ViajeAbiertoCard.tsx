import { Button } from '@booster-ai/ui-components';
import { useNavigate } from '@tanstack/react-router';
import { Check, Loader2, MapPin, Package } from 'lucide-react';
import { useState } from 'react';
import { type ViajeAbiertoPayload, useReclamarViajeMutation } from '../../hooks/use-marketplace.js';
import { ApiError } from '../../lib/api-client.js';

const CARGO_LABELS: Record<string, string> = {
  carga_seca: 'Carga seca',
  perecible: 'Perecible',
  refrigerada: 'Refrigerada',
  congelada: 'Congelada',
  fragil: 'Frágil',
  peligrosa: 'Peligrosa',
  liquida: 'Líquida',
  construccion: 'Construcción',
  agricola: 'Agrícola',
  ganado: 'Ganado',
  otra: 'Otra',
};

export interface ViajeAbiertoCardProps {
  viaje: ViajeAbiertoPayload;
  puedeReclamar: boolean;
}

/**
 * BARH-23 — tarjeta de carga en zona sin oferta propia (marketplace abierto).
 */
export function ViajeAbiertoCard({ viaje, puedeReclamar }: ViajeAbiertoCardProps) {
  const navigate = useNavigate();
  const reclamar = useReclamarViajeMutation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onReclamar() {
    setErrorMsg(null);
    try {
      await reclamar.mutateAsync({ viajeId: viaje.id });
      void navigate({ to: '/app/servicios' });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrorMsg('Esta carga ya no está disponible.');
          return;
        }
        if (err.status === 403) {
          setErrorMsg('Tu zona no cubre esta carga o no tienes permiso.');
          return;
        }
      }
      setErrorMsg('No pudimos reclamar la carga. Intenta de nuevo.');
    }
  }

  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-neutral-900 text-sm">
            {viaje.tracking_code}{' '}
            <span className="font-normal text-neutral-500">· sin oferta directa</span>
          </p>
          <p className="mt-1 flex items-center gap-1 text-neutral-600 text-sm">
            <Package className="h-3.5 w-3.5" aria-hidden />
            {CARGO_LABELS[viaje.cargo_type] ?? viaje.cargo_type}
            {viaje.cargo_weight_kg != null
              ? ` · ${viaje.cargo_weight_kg.toLocaleString('es-CL')} kg`
              : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1 text-neutral-700 text-sm">
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" aria-hidden />
          <span>
            <span className="text-neutral-500">Origen · </span>
            {viaje.origin_address_raw}
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
          <span>
            <span className="text-neutral-500">Destino · </span>
            {viaje.destination_address_raw}
          </span>
        </p>
      </div>
      {errorMsg && (
        <p className="mt-3 rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-danger-700 text-sm">
          {errorMsg}
        </p>
      )}
      {puedeReclamar && (
        <div className="mt-4">
          <Button variant="primary" onClick={() => void onReclamar()} disabled={reclamar.isPending}>
            {reclamar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Check className="h-4 w-4" aria-hidden />
            )}
            Reclamar carga
          </Button>
          <p className="mt-2 text-neutral-500 text-xs">
            Al reclamar te asignas la carga. Después debes declarar un vehículo de tu flota que
            cumpla capacidad y carrocería.
          </p>
        </div>
      )}
    </article>
  );
}
