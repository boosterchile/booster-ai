import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Cpu } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { EmptyState, emptyStateActionClass } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface PendingDevice {
  id: string;
  imei: string;
  primera_conexion_en: string;
  ultima_conexion_en: string;
  cantidad_conexiones: number;
  modelo_detectado: string | null;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'reemplazado';
}

interface VehicleOption {
  id: string;
  plate: string;
  brand: string | null;
  model: string | null;
}

/**
 * La empresa asocia el Teltonika cuyo IMEI tiene en el equipo. No ve la
 * bandeja de la plataforma ni puede rechazar un pending ajeno.
 */
export function AdminDispositivosRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const active = ctx.me.active_membership;
        if (!active || (active.role !== 'dueno' && active.role !== 'admin')) {
          return (
            <div className="mx-auto max-w-xl px-6 py-12">
              <h1 className="font-bold text-2xl">Acceso restringido</h1>
              <p className="mt-2 text-neutral-600">
                Solo dueños o administradores pueden ver esta página.
              </p>
              <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
                Volver al inicio
              </Link>
            </div>
          );
        }
        return <AdminDispositivosBody me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function AdminDispositivosBody({ me }: { me: MeOnboarded }) {
  const queryClient = useQueryClient();
  const empresaId = me.active_membership?.empresa?.id ?? '';
  const [imei, setImei] = useState('');
  const [buscado, setBuscado] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const devicesQ = useQuery({
    queryKey: ['admin-pending-device', empresaId, buscado],
    enabled: buscado !== null,
    queryFn: async () => {
      const res = await api.get<{ devices: PendingDevice[] }>(
        `/admin/dispositivos-pendientes?estado=pendiente&imei=${buscado}`,
      );
      return res.devices;
    },
  });

  const vehiclesQ = useQuery({
    queryKey: ['my-vehicles', empresaId],
    queryFn: async () => {
      const res = await api.get<{ vehicles: VehicleOption[] }>('/vehiculos');
      return res.vehicles;
    },
  });

  function buscar(event: FormEvent) {
    event.preventDefault();
    const limpio = imei.trim();
    if (!/^\d{15}$/.test(limpio)) {
      setFormError('El IMEI tiene 15 dígitos.');
      setBuscado(null);
      return;
    }
    setFormError(null);
    setBuscado(limpio);
  }

  return (
    <Layout me={me} title="Asociar dispositivo">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-600 text-sm hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </Link>
        <h1 className="font-bold text-3xl">Asociar dispositivo</h1>
      </div>
      <p className="text-neutral-600 text-sm">
        Escribe el IMEI de 15 dígitos impreso en el equipo Teltonika. Solo ves ese dispositivo.
      </p>

      <form onSubmit={buscar} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor="imei-dispositivo">
          IMEI del dispositivo
          <input
            id="imei-dispositivo"
            inputMode="numeric"
            autoComplete="off"
            value={imei}
            onChange={(event) => setImei(event.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700"
        >
          Buscar
        </button>
      </form>
      {formError && <p className="mt-2 text-danger-700 text-sm">{formError}</p>}

      {devicesQ.isLoading && <p className="mt-6 text-neutral-500">Buscando…</p>}
      {devicesQ.error && <p className="mt-6 text-danger-700">Error al buscar el dispositivo.</p>}
      {devicesQ.data && devicesQ.data.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<Cpu className="h-10 w-10" aria-hidden />}
            title="No hay un dispositivo pendiente con ese IMEI"
            description="Revisa los 15 dígitos del equipo. Si aún no se ha conectado al gateway, espera unos minutos y vuelve a buscar."
            action={
              <Link to="/app/vehiculos" className={emptyStateActionClass}>
                Ver mis vehículos
              </Link>
            }
          />
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {devicesQ.data?.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            vehicles={vehiclesQ.data ?? []}
            onAssociated={() => {
              queryClient.invalidateQueries({
                queryKey: ['admin-pending-device', empresaId, buscado],
              });
            }}
          />
        ))}
      </ul>
    </Layout>
  );
}

function DeviceRow({
  device,
  vehicles,
  onAssociated,
}: {
  device: PendingDevice;
  vehicles: VehicleOption[];
  onAssociated: () => void;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const associateM = useMutation({
    mutationFn: async (selectedVehicleId: string) => {
      return await api.post(`/admin/dispositivos-pendientes/${device.id}/asociar`, {
        vehiculo_id: selectedVehicleId,
      });
    },
    onSuccess: () => {
      setError(null);
      onAssociated();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono font-semibold text-neutral-900">{device.imei}</div>
          <div className="mt-1 text-neutral-500 text-xs">
            {device.cantidad_conexiones} conexiones · última{' '}
            {new Date(device.ultima_conexion_en).toLocaleString('es-CL')}
            {device.modelo_detectado ? ` · ${device.modelo_detectado}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            disabled={associateM.isPending}
          >
            <option value="">Seleccionar vehículo…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
                {v.brand ? ` · ${v.brand}` : ''}
                {v.model ? ` ${v.model}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => vehicleId && associateM.mutate(vehicleId)}
            disabled={!vehicleId || associateM.isPending}
            className="flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Asociar
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-danger-700 text-sm">{error}</div>}
    </li>
  );
}
