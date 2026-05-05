import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useState } from 'react';
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
  ultima_ip_origen: string | null;
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
 * Panel admin para asociar dispositivos Teltonika pendientes (open
 * enrollment) a vehículos. Solo accesible a roles 'dueno' o 'admin'.
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

  const devicesQ = useQuery({
    queryKey: ['admin-pending-devices'],
    queryFn: async () => {
      const res = await api.get<{ devices: PendingDevice[] }>(
        '/admin/dispositivos-pendientes?estado=pendiente',
      );
      return res.devices;
    },
    refetchInterval: 30_000,
  });

  const vehiclesQ = useQuery({
    queryKey: ['my-vehicles'],
    queryFn: async () => {
      // GET /vehiculos retorna los del activeMembership.empresa.
      const res = await api.get<{ vehicles: VehicleOption[] }>('/vehiculos');
      return res.vehicles;
    },
  });

  return (
    <Layout me={me} title="Dispositivos pendientes">
      <div className="mb-6 flex items-center gap-3">
        <Link to="/app" className="text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-bold text-3xl">Dispositivos pendientes</h1>
      </div>
      <p className="text-neutral-600 text-sm">
        Dispositivos Teltonika que se conectaron al gateway y esperan asociación a un vehículo.
      </p>

      {devicesQ.isLoading && <p className="mt-6 text-neutral-500">Cargando…</p>}
      {devicesQ.error && <p className="mt-6 text-danger-700">Error al cargar dispositivos.</p>}
      {devicesQ.data && devicesQ.data.length === 0 && (
        <p className="mt-6 rounded-md border border-neutral-200 bg-white p-4 text-neutral-600 text-sm">
          No hay dispositivos pendientes.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {devicesQ.data?.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            vehicles={vehiclesQ.data ?? []}
            onAssociated={() => {
              queryClient.invalidateQueries({ queryKey: ['admin-pending-devices'] });
            }}
            onRejected={() => {
              queryClient.invalidateQueries({ queryKey: ['admin-pending-devices'] });
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
  onRejected,
}: {
  device: PendingDevice;
  vehicles: VehicleOption[];
  onAssociated: () => void;
  onRejected: () => void;
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

  const rejectM = useMutation({
    mutationFn: async () => {
      return await api.post(`/admin/dispositivos-pendientes/${device.id}/rechazar`, {});
    },
    onSuccess: () => onRejected(),
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
            {device.ultima_ip_origen ? ` · IP ${device.ultima_ip_origen}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            disabled={associateM.isPending || rejectM.isPending}
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
          <button
            type="button"
            onClick={() => rejectM.mutate()}
            disabled={rejectM.isPending}
            className="flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1 text-neutral-700 text-sm hover:bg-neutral-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Rechazar
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-danger-700 text-sm">{error}</div>}
    </li>
  );
}
