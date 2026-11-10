import { type RegionCode, comunasDeRegion } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { CARGO_TYPE_LABELS, REGION_LABELS } from '../../lib/etiquetas-carga.js';
import { type CambiosCarga, DiffCambio, type LugarCambio } from './DiffCambio.js';

/**
 * «Solicitar cambio» del generador sobre una carga ya asignada
 * (editar-anular-cargas §9). Se envían solo los campos que cambiaron; el
 * transportista los acepta o rechaza y, mientras tanto, la recogida queda
 * bloqueada.
 */

export interface CargaActual {
  origin_address_raw: string;
  origin_region_code: string | null;
  /** CUT/INE de la comuna, si la carga la tiene. */
  origin_comuna_code: string | null;
  destination_address_raw: string;
  destination_region_code: string | null;
  destination_comuna_code: string | null;
  cargo_type: string;
  cargo_weight_kg: number | null;
  cargo_volume_m3: number | null;
  cargo_description: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  proposed_price_clp: number | null;
  modalidad_carga: string;
}

export function mensajeErrorSolicitud(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'sin_cambios':
        return 'No cambiaste ningún dato.';
      case 'cambio_pendiente_existente':
        return 'Ya hay un cambio esperando respuesta. Retíralo antes de proponer otro.';
      case 'trip_not_editable':
        return 'La carga ya fue recogida o terminó: no se puede proponer un cambio.';
      case 'trip_not_matched':
        return 'La carga aún no tiene transportista: edítala directamente.';
      case 'contrato_programado_no_habilitado':
        return 'Tu empresa no tiene contrato programado habilitado.';
      case 'read_only':
      case 'capability_denied':
        return 'Tu rol no puede cambiar esta carga.';
    }
    if (err.status === 400) {
      return 'Revisa los datos: la ventana debe empezar al menos 30 minutos en el futuro y el precio ser mayor a 0.';
    }
  }
  return 'No pudimos enviar la solicitud. Inténtalo de nuevo.';
}

/** ISO → valor de un `<input type="datetime-local">` en la hora del navegador. */
function aLocal(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function aIso(local: string): string {
  return new Date(local).toISOString();
}

function numeroONull(v: string): number | null {
  const t = v.trim();
  return t === '' ? null : Number(t);
}

function lugar(direccion: string, region: string, comuna: string): LugarCambio {
  return {
    address_raw: direccion.trim(),
    region_code: region,
    // Sin comuna elegida el lugar va sin ella (el API la deja vacía).
    ...(comuna ? { comuna_code: comuna } : {}),
  };
}

/** Solo los campos que cambiaron respecto de la carga actual. */
export function cambiosDesdeFormulario(
  actual: CargaActual,
  f: {
    origen: string;
    origenRegion: string;
    origenComuna: string;
    destino: string;
    destinoRegion: string;
    destinoComuna: string;
    tipo: string;
    peso: string;
    volumen: string;
    descripcion: string;
    desde: string;
    hasta: string;
    precio: string;
    modalidad: string;
  },
): CambiosCarga {
  const c: CambiosCarga = {};
  if (
    f.origen.trim() !== actual.origin_address_raw ||
    f.origenRegion !== (actual.origin_region_code ?? '') ||
    f.origenComuna !== (actual.origin_comuna_code ?? '')
  ) {
    c.origin = lugar(f.origen, f.origenRegion, f.origenComuna);
  }
  if (
    f.destino.trim() !== actual.destination_address_raw ||
    f.destinoRegion !== (actual.destination_region_code ?? '') ||
    f.destinoComuna !== (actual.destination_comuna_code ?? '')
  ) {
    c.destination = lugar(f.destino, f.destinoRegion, f.destinoComuna);
  }
  if (f.tipo !== actual.cargo_type) {
    c.cargo_type = f.tipo;
  }
  const peso = numeroONull(f.peso);
  if (peso !== null && peso !== actual.cargo_weight_kg) {
    c.weight_kg = peso;
  }
  const volumen = numeroONull(f.volumen);
  if (volumen !== actual.cargo_volume_m3) {
    c.volume_m3 = volumen;
  }
  const descripcion = f.descripcion.trim() === '' ? null : f.descripcion.trim();
  if (descripcion !== actual.cargo_description) {
    c.description = descripcion;
  }
  if (
    f.desde &&
    f.hasta &&
    (f.desde !== aLocal(actual.pickup_window_start) || f.hasta !== aLocal(actual.pickup_window_end))
  ) {
    c.pickup_window = { start_at: aIso(f.desde), end_at: aIso(f.hasta) };
  }
  const precio = numeroONull(f.precio);
  if (precio !== null && precio !== actual.proposed_price_clp) {
    c.proposed_price_clp = precio;
  }
  if (
    f.modalidad !== actual.modalidad_carga &&
    (f.modalidad === 'spot' || f.modalidad === 'programada')
  ) {
    c.modalidad_carga = f.modalidad;
  }
  return c;
}

/** Valores vigentes en la forma del diff, para la vista previa. */
function anterioresDe(actual: CargaActual): CambiosCarga {
  return {
    origin: {
      address_raw: actual.origin_address_raw,
      region_code: actual.origin_region_code,
      comuna_code: actual.origin_comuna_code,
    },
    destination: {
      address_raw: actual.destination_address_raw,
      region_code: actual.destination_region_code,
      comuna_code: actual.destination_comuna_code,
    },
    cargo_type: actual.cargo_type,
    weight_kg: actual.cargo_weight_kg,
    volume_m3: actual.cargo_volume_m3,
    description: actual.cargo_description,
    pickup_window:
      actual.pickup_window_start && actual.pickup_window_end
        ? { start_at: actual.pickup_window_start, end_at: actual.pickup_window_end }
        : null,
    proposed_price_clp: actual.proposed_price_clp,
    ...(actual.modalidad_carga === 'spot' || actual.modalidad_carga === 'programada'
      ? { modalidad_carga: actual.modalidad_carga }
      : {}),
  };
}

function esRegion(v: string): v is RegionCode {
  return v in REGION_LABELS;
}

function comunasOrdenadas(region: string) {
  return esRegion(region)
    ? [...comunasDeRegion(region)].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    : [];
}

export function SolicitarCambioForm({
  tripId,
  actual,
  onListo,
}: {
  tripId: string;
  actual: CargaActual;
  onListo: () => void;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    origen: actual.origin_address_raw,
    origenRegion: actual.origin_region_code ?? '',
    origenComuna: actual.origin_comuna_code ?? '',
    destino: actual.destination_address_raw,
    destinoRegion: actual.destination_region_code ?? '',
    destinoComuna: actual.destination_comuna_code ?? '',
    tipo: actual.cargo_type,
    peso: actual.cargo_weight_kg?.toString() ?? '',
    volumen: actual.cargo_volume_m3?.toString() ?? '',
    descripcion: actual.cargo_description ?? '',
    desde: aLocal(actual.pickup_window_start),
    hasta: aLocal(actual.pickup_window_end),
    precio: actual.proposed_price_clp?.toString() ?? '',
    modalidad: actual.modalidad_carga,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  // La comuna pertenece a la región: si cambia la región, se vacía.
  const setRegion = (extremo: 'origen' | 'destino') => (v: string) =>
    setF((p) =>
      extremo === 'origen'
        ? { ...p, origenRegion: v, origenComuna: '' }
        : { ...p, destinoRegion: v, destinoComuna: '' },
    );
  // Vista previa local de lo que se envía. El desglose comercial lo calcula
  // el servidor y se ve en el banner del cambio pendiente, después de enviar.
  const propuestos = cambiosDesdeFormulario(actual, f);
  const hayCambios = Object.keys(propuestos).length > 0;

  const enviar = useMutation({
    mutationFn: (cambios: CambiosCarga) =>
      api.post(`/trip-requests-v2/${tripId}/solicitudes-cambio`, { cambios }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cargas', tripId] });
      onListo();
    },
    onError: (err) => setError(mensajeErrorSolicitud(err)),
  });

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!hayCambios) {
      setError('No cambiaste ningún dato.');
      return;
    }
    enviar.mutate(propuestos);
  }

  const campo = 'mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2';
  const etiqueta = 'font-medium text-neutral-800';
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Solicitar cambio"
      className="space-y-3 rounded-lg border border-primary-200 bg-primary-50 p-4"
    >
      <h3 className="font-semibold text-neutral-900 text-sm">Solicitar cambio</h3>
      <p className="text-neutral-700 text-sm">
        El transportista no podrá confirmar la recogida hasta responder.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={etiqueta}>Dirección de origen</span>
          <input
            value={f.origen}
            onChange={(e) => set('origen')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Región de origen</span>
          <select
            value={f.origenRegion}
            onChange={(e) => setRegion('origen')(e.target.value)}
            className={campo}
          >
            {Object.entries(REGION_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Comuna de origen</span>
          <select
            value={f.origenComuna}
            onChange={(e) => set('origenComuna')(e.target.value)}
            className={campo}
          >
            <option value="">Sin comuna</option>
            {comunasOrdenadas(f.origenRegion).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Dirección de destino</span>
          <input
            value={f.destino}
            onChange={(e) => set('destino')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Región de destino</span>
          <select
            value={f.destinoRegion}
            onChange={(e) => setRegion('destino')(e.target.value)}
            className={campo}
          >
            {Object.entries(REGION_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Comuna de destino</span>
          <select
            value={f.destinoComuna}
            onChange={(e) => set('destinoComuna')(e.target.value)}
            className={campo}
          >
            <option value="">Sin comuna</option>
            {comunasOrdenadas(f.destinoRegion).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Tipo de carga</span>
          <select value={f.tipo} onChange={(e) => set('tipo')(e.target.value)} className={campo}>
            {Object.entries(CARGO_TYPE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Peso (kg)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.peso}
            onChange={(e) => set('peso')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Volumen (m³)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.volumen}
            onChange={(e) => set('volumen')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Precio del transportista (CLP)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.precio}
            onChange={(e) => set('precio')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Recogida desde</span>
          <input
            type="datetime-local"
            value={f.desde}
            onChange={(e) => set('desde')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Recogida hasta</span>
          <input
            type="datetime-local"
            value={f.hasta}
            onChange={(e) => set('hasta')(e.target.value)}
            className={campo}
          />
        </label>
        <label className="block text-sm">
          <span className={etiqueta}>Modalidad</span>
          <select
            value={f.modalidad}
            onChange={(e) => set('modalidad')(e.target.value)}
            className={campo}
          >
            <option value="spot">Spot</option>
            <option value="programada">Programada</option>
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className={etiqueta}>Descripción de la carga</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={f.descripcion}
          onChange={(e) => set('descripcion')(e.target.value)}
          className={campo}
        />
      </label>
      {hayCambios && (
        <section aria-label="Cambios que vas a proponer" className="space-y-1">
          <h4 className="font-medium text-neutral-800 text-sm">Cambios que vas a proponer</h4>
          <DiffCambio cambios={propuestos} anteriores={anterioresDe(actual)} />
        </section>
      )}
      {error && (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={enviar.isPending}
          className="rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {enviar.isPending ? 'Enviando…' : 'Enviar al transportista'}
        </button>
        <button
          type="button"
          onClick={onListo}
          className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm"
        >
          Volver
        </button>
      </div>
    </form>
  );
}
