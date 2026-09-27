import { Cpu, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Platform-admin: escribe el IMEI de un Teltonika ya instalado en un camión
 * que ya existe. No espera a que el equipo llame al gateway ni abre la
 * sesión del transportista.
 */

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

const IMEI_RE = /^\d{15}$/;

export function AsociarTeltonika() {
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [vehiculos, setVehiculos] = useState<VehiculoOption[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [imei, setImei] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ empresas?: EmpresaOption[] }>('/admin/empresas')
      .then((res) => {
        if (!cancelled) {
          setEmpresas((res.empresas ?? []).filter((e) => e.es_transportista));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function asignar() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await api.post<{ patente: string; teltonika_imei: string }>(
        '/admin/plataforma/dispositivos/asignar',
        { vehiculo_id: vehiculoId, teltonika_imei: imei.trim() },
      );
      setOk(`El camión ${res.patente} quedó con el IMEI ${res.teltonika_imei}.`);
      setImei('');
      setVehiculoId('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'imei_en_uso') {
        setError('Ese IMEI ya está asignado a otro camión.');
      } else if (err instanceof ApiError && err.code === 'imei_rechazado') {
        setError('Ese IMEI fue rechazado antes. No se reasigna desde aquí.');
      } else if (err instanceof ApiError && err.code === 'imei_espejo_activo') {
        setError('Ese camión mira el GPS de otro equipo. No se le puede poner un IMEI propio.');
      } else {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const imeiValido = IMEI_RE.test(imei.trim());

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Dispositivos Teltonika</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            El equipo ya está instalado y configurado en el camión. Acá se escribe su IMEI en ese
            vehículo. No hace falta entrar a la cuenta del transportista ni esperar a que el
            dispositivo llame al gateway.
          </p>
        </div>
      </div>

      {loading && (
        <p className="mt-4 inline-flex items-center gap-2 text-neutral-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando transportistas…
        </p>
      )}

      {!loading && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {empresas.map((e) => (
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
                  {v.teltonika_imei ? ` · IMEI ${v.teltonika_imei}` : ' · sin IMEI'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="font-medium text-neutral-700 text-sm">
              IMEI del Teltonika instalado
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={imei}
              onChange={(e) => setImei(e.target.value.replace(/\s/g, ''))}
              placeholder="15 dígitos"
              className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
              data-testid="teltonika-imei"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={!imeiValido || vehiculoId === '' || submitting}
              onClick={() => void asignar()}
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              data-testid="teltonika-asociar"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Asignar IMEI
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
