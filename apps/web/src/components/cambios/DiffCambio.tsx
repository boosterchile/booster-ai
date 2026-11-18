import { comunaPorCodigo } from '@booster-ai/shared-schemas';
import { CARGO_TYPE_LABELS, type CargoType, regionLabel } from '../../lib/etiquetas-carga.js';
import type { RegionCode } from '../../lib/etiquetas-carga.js';

/**
 * Diff campo a campo de un cambio de carga propuesto (editar-anular-cargas §9).
 * Lo usan el generador (su propuesta), la oficina del transportista (para
 * responder) y el historial. Nunca se muestra al conductor (§12-P7).
 */

export interface LugarCambio {
  address_raw: string;
  region_code: string | null;
  comuna_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CambiosCarga {
  origin?: LugarCambio;
  destination?: LugarCambio;
  cargo_type?: string;
  weight_kg?: number | null;
  volume_m3?: number | null;
  description?: string | null;
  pickup_window?: { start_at: string; end_at: string } | null;
  proposed_price_clp?: number | null;
  modalidad_carga?: 'spot' | 'programada';
}

export type CampoCambio = keyof CambiosCarga;

export const ORDEN_CAMPOS: readonly CampoCambio[] = [
  'origin',
  'destination',
  'cargo_type',
  'weight_kg',
  'volume_m3',
  'description',
  'pickup_window',
  'proposed_price_clp',
  'modalidad_carga',
];

export const ETIQUETA_CAMPO: Record<CampoCambio, string> = {
  origin: 'Origen',
  destination: 'Destino',
  cargo_type: 'Tipo de carga',
  weight_kg: 'Peso',
  volume_m3: 'Volumen',
  description: 'Descripción',
  pickup_window: 'Ventana de recogida',
  proposed_price_clp: 'Precio del transportista',
  modalidad_carga: 'Modalidad',
};

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});
const kg = new Intl.NumberFormat('es-CL');

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  });
}

function esCargoType(v: string): v is CargoType {
  return v in CARGO_TYPE_LABELS;
}

/** Valor de un campo en texto, tal como lo lee una persona. */
export function valorLegible<C extends CampoCambio>(campo: C, valor: CambiosCarga[C]): string {
  if (valor === null || valor === undefined || valor === '') {
    return 'Sin dato';
  }
  switch (campo) {
    case 'origin':
    case 'destination': {
      const l = valor as LugarCambio;
      const region = regionLabel(l.region_code as RegionCode | null);
      const comuna = l.comuna_code ? comunaPorCodigo(l.comuna_code)?.name : undefined;
      return `${l.address_raw} (${comuna ? `${comuna}, ${region}` : region})`;
    }
    case 'cargo_type': {
      const t = valor as string;
      return esCargoType(t) ? CARGO_TYPE_LABELS[t] : t;
    }
    case 'weight_kg':
      return `${kg.format(valor as number)} kg`;
    case 'volume_m3':
      return `${kg.format(valor as number)} m³`;
    case 'pickup_window': {
      const w = valor as { start_at: string; end_at: string };
      return `${fechaHora(w.start_at)} → ${fechaHora(w.end_at)}`;
    }
    case 'proposed_price_clp':
      return clp.format(valor as number);
    case 'modalidad_carga':
      return valor === 'programada' ? 'Programada' : 'Spot';
    default:
      return String(valor);
  }
}

export function DiffCambio({
  cambios,
  anteriores,
}: {
  cambios: CambiosCarga;
  anteriores: CambiosCarga;
}) {
  const campos = ORDEN_CAMPOS.filter((c) => cambios[c] !== undefined);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-neutral-500 text-xs">
          <th scope="col" className="py-1 pr-3 font-medium">
            Campo
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Antes
          </th>
          <th scope="col" className="py-1 font-medium">
            Propuesto
          </th>
        </tr>
      </thead>
      <tbody>
        {campos.map((campo) => (
          <tr key={campo} className="border-neutral-200 border-t align-top">
            <th scope="row" className="py-1.5 pr-3 font-medium text-neutral-700">
              {ETIQUETA_CAMPO[campo]}
            </th>
            <td className="py-1.5 pr-3 text-neutral-500 line-through">
              {valorLegible(campo, anteriores[campo])}
            </td>
            <td className="py-1.5 font-medium text-neutral-900">
              {valorLegible(campo, cambios[campo])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
