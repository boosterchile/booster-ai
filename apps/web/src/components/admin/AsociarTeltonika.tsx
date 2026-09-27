import { Cpu, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Platform-admin: asocia un Teltonika que ya se conectó al gateway con un
 * camión de cualquier transportista. No abre la sesión de esa empresa.
 */

interface DeviceRow {
  id: string;
  imei: string;
  ultima_conexion_en: string;
  modelo_detectado: string | null;
  cantidad_conexiones: number;
}

interface EmpresaOption {
  id: string;
  razon_social: string;
  rut: string;
  es_transportista: boolean;
}

interface VehiculoOption {
  id: string;
  patente: string;
  teltonika_imei: string | null;
}

export function AsociarTeltonika() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [vehiculos, setVehiculos] = useState<VehiculoOption[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dev, emp] = await Promise.all([
        api.get<{ devices?: DeviceRow[] }>('/admin/plataforma/dispositivos'),
        api.get<{ empresas?: EmpresaOption[] }>('/admin/empresas'),
      ]);
      setDevices(dev.devices ?? []);
      setEmpresas((emp.empresas ?? []).filter((e) => e.es_transportista));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (empresaId === '') {
      setVehiculos([]);
      setVehiculoId('');
      return;
    }
    let cancelled = false;
    api
      .get<{ vehiculos?: VehiculoOption[] }>(
        `/admin/plataforma/dispositivos/vehiculos?empresa_id=${encodeURIComponent(empresaId)}`,
      )
      .then((res) => {
        if (!cancelled) {
          setVehiculos(res.vehiculos ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [empresaId]);

  async function asociar() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await api.post<{ patente: string; imei: string }>(
        `/admin/plataforma/dispositivos/${deviceId}/asociar`,
        { vehiculo_id: vehiculoId },
      );
      setOk(`El camión ${res.patente} quedó con el Teltonika ${res.imei}.`);
      setDeviceId('');
      setVehiculoId('');
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'vehicle_has_other_device') {
        setError('Ese camión ya tiene otro dispositivo.');
      } else if (err instanceof ApiError && err.code === 'imei_en_uso') {
        setError('Ese Teltonika ya está en otro camión.');
      } else if (err instanceof ApiError && err.code === 'device_not_pending') {
        setError('Ese dispositivo ya no está pendiente.');
      } else {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const transportistas = empresas;

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Dispositivos Teltonika</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Asocia un dispositivo que ya se conectó al gateway con un camión del transportista. No
            hace falta entrar a su cuenta.
          </p>
        </div>
      </div>

      {loading && (
        <p className="mt-4 inline-flex items-center gap-2 text-neutral-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando dispositivos…
        </p>
      )}

      {!loading && devices.length === 0 && (
        <p className="mt-4 text-neutral-500 text-sm" data-testid="teltonika-vacio">
          No hay Teltonika pendientes. Cuando uno se conecte al gateway, aparece aquí.
        </p>
      )}

      {!loading && devices.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="font-medium text-neutral-700 text-sm">Dispositivo pendiente</span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              data-testid="teltonika-device"
            >
              <option value="">Elegí un IMEI</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.imei}
                  {d.modelo_detectado ? ` · ${d.modelo_detectado}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Transportista</span>
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value);
                setVehiculoId('');
              }}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              data-testid="teltonika-empresa"
            >
              <option value="">Elegí la empresa</option>
              {transportistas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razon_social} · {e.rut}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-neutral-700 text-sm">Camión</span>
            <select
              value={vehiculoId}
              onChange={(e) => setVehiculoId(e.target.value)}
              disabled={empresaId === ''}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
              data-testid="teltonika-vehiculo"
            >
              <option value="">
                {empresaId === '' ? 'Primero la empresa' : 'Elegí la patente'}
              </option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.patente}
                  {v.teltonika_imei ? ` · ya tiene ${v.teltonika_imei}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={deviceId === '' || vehiculoId === '' || submitting}
              onClick={() => void asociar()}
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              data-testid="teltonika-asociar"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Asociar al camión
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-danger-700 text-sm" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-3 text-neutral-800 text-sm" data-testid="teltonika-ok">
          {ok}
        </p>
      )}
    </section>
  );
}
