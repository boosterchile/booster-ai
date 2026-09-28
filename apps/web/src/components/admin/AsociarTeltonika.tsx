import { chileanPlateSchema, normalizePlate } from '@booster-ai/shared-schemas';
import { Cpu, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * Platform-admin: habilita un Teltonika ya instalado para una empresa de
 * transportes. Booster puede cargar los datos del vehículo (queda asignado
 * a esa empresa, con el IMEI) o solo escribir el IMEI si la empresa ya lo
 * cargó en su flota.
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

type Modo = 'alta' | 'existente';

type TipoVehiculo =
  | 'camioneta'
  | 'furgon_pequeno'
  | 'furgon_mediano'
  | 'camion_pequeno'
  | 'camion_mediano'
  | 'camion_pesado'
  | 'semi_remolque'
  | 'refrigerado'
  | 'tanque';

const TIPOS: Array<{ id: TipoVehiculo; label: string }> = [
  { id: 'camioneta', label: 'Camioneta' },
  { id: 'furgon_pequeno', label: 'Furgón pequeño' },
  { id: 'furgon_mediano', label: 'Furgón mediano' },
  { id: 'camion_pequeno', label: 'Camión pequeño' },
  { id: 'camion_mediano', label: 'Camión mediano' },
  { id: 'camion_pesado', label: 'Camión pesado' },
  { id: 'semi_remolque', label: 'Semi-remolque' },
  { id: 'refrigerado', label: 'Refrigerado' },
  { id: 'tanque', label: 'Tanque' },
];

const COMBUSTIBLES: Array<{ id: string; label: string }> = [
  { id: 'diesel', label: 'Diésel' },
  { id: 'gasolina', label: 'Gasolina' },
  { id: 'gas_glp', label: 'GLP' },
  { id: 'gas_gnc', label: 'GNC' },
  { id: 'electrico', label: 'Eléctrico' },
  { id: 'hibrido_diesel', label: 'Híbrido diésel' },
  { id: 'hibrido_gasolina', label: 'Híbrido gasolina' },
  { id: 'hidrogeno', label: 'Hidrógeno' },
];

function esTipoVehiculo(value: string): value is TipoVehiculo {
  return TIPOS.some((tipo) => tipo.id === value);
}

const IMEI_RE = /^\d{15}$/;
const inputClass = 'rounded-md border border-neutral-300 px-3 py-2 text-sm';

export function AsociarTeltonika() {
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [vehiculos, setVehiculos] = useState<VehiculoOption[]>([]);
  const [modo, setModo] = useState<Modo>('alta');
  const [empresaId, setEmpresaId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [imei, setImei] = useState('');
  const [patente, setPatente] = useState('');
  const [tipo, setTipo] = useState<TipoVehiculo>('camion_pequeno');
  const [capacidad, setCapacidad] = useState('');
  const [pesoVacio, setPesoVacio] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [anio, setAnio] = useState('');
  const [combustible, setCombustible] = useState('');
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
    if (empresaId === '' || modo !== 'existente') {
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
  }, [empresaId, modo]);

  function mensajeError(err: unknown): string {
    if (!(err instanceof ApiError)) {
      return String(err);
    }
    switch (err.code) {
      case 'imei_en_uso':
        return 'Ese IMEI ya está asignado a otro camión.';
      case 'imei_rechazado':
        return 'Ese IMEI fue rechazado antes. No se reasigna desde aquí.';
      case 'imei_espejo_activo':
        return 'Ese camión mira el GPS de otro equipo. No se le puede poner un IMEI propio.';
      case 'plate_duplicate':
        return 'Ya existe un vehículo con esa patente.';
      case 'empresa_no_transportista':
        return 'Esa empresa no es de transportes.';
      case 'arrastre_curb_weight_requerido':
        return 'Un semi-remolque necesita el peso vacío.';
      default:
        return `${err.status}: ${err.message}`;
    }
  }

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
      setError(mensajeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function habilitar() {
    setError(null);
    setOk(null);
    const plate = chileanPlateSchema.safeParse(patente);
    if (!plate.success) {
      setError(plate.error.issues[0]?.message ?? 'Patente inválida');
      return;
    }
    const kilos = Number.parseInt(capacidad, 10);
    if (!Number.isInteger(kilos) || kilos < 1 || kilos > 100_000) {
      setError('Ingresa la capacidad de carga en kilos, entre 1 y 100.000.');
      return;
    }
    const tara = pesoVacio.trim() === '' ? null : Number.parseInt(pesoVacio, 10);
    if (tipo === 'semi_remolque' && (tara === null || !Number.isInteger(tara) || tara < 1)) {
      setError('Un semi-remolque necesita el peso vacío.');
      return;
    }
    if (tara !== null && (!Number.isInteger(tara) || tara < 1 || tara > 50_000)) {
      setError('El peso vacío tiene que ser un entero entre 1 y 50.000 kg.');
      return;
    }
    const year = anio.trim() === '' ? null : Number.parseInt(anio, 10);
    if (year !== null && (!Number.isInteger(year) || year < 1980 || year > 2100)) {
      setError('El año tiene que estar entre 1980 y 2100.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await api.post<{
        patente: string;
        razon_social: string;
        teltonika_imei: string;
        ya_existia?: boolean;
        movido?: boolean;
      }>('/admin/plataforma/dispositivos/habilitar', {
        empresa_id: empresaId,
        teltonika_imei: imei.trim(),
        plate: normalizePlate(patente),
        vehicle_type: tipo,
        capacity_kg: kilos,
        ...(marca.trim() ? { brand: marca.trim() } : {}),
        ...(modelo.trim() ? { model: modelo.trim() } : {}),
        ...(year !== null ? { year } : {}),
        ...(combustible !== '' && tipo !== 'semi_remolque' ? { fuel_type: combustible } : {}),
        ...(tara !== null ? { curb_weight_kg: tara } : {}),
      });
      if (res.ya_existia && res.movido) {
        setOk(
          `El camión ${res.patente} ya existía en otra empresa. Quedó en ${res.razon_social} con el IMEI ${res.teltonika_imei}.`,
        );
      } else if (res.ya_existia) {
        setOk(
          `El camión ${res.patente} ya estaba en ${res.razon_social}. Quedó con el IMEI ${res.teltonika_imei}.`,
        );
      } else {
        setOk(
          `El camión ${res.patente} quedó en ${res.razon_social} con el IMEI ${res.teltonika_imei}.`,
        );
      }
      setImei('');
      setPatente('');
      setCapacidad('');
      setPesoVacio('');
      setMarca('');
      setModelo('');
      setAnio('');
      setCombustible('');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const imeiValido = IMEI_RE.test(imei.trim());
  const puedeAsignar = imeiValido && vehiculoId !== '' && !submitting;
  const puedeHabilitar = imeiValido && empresaId !== '' && patente.trim() !== '' && !submitting;

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Dispositivos Teltonika</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Booster instala el Teltonika en el vehículo y después lo habilita para la empresa de
            transportes. Habilitarlo es cargar los datos del vehículo para que quede asignado a esa
            empresa, junto con el IMEI. Si la patente ya está en Booster, ese vehículo pasa a la
            empresa elegida. La empresa también puede cargar esos datos desde su flota.
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
        <div className="mt-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="font-medium text-neutral-700 text-sm">
              ¿Quién carga los datos del vehículo?
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="teltonika-modo"
                checked={modo === 'alta'}
                onChange={() => setModo('alta')}
                data-testid="teltonika-modo-alta"
              />
              <span>Los cargo yo, desde Booster</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="teltonika-modo"
                checked={modo === 'existente'}
                onChange={() => setModo('existente')}
                data-testid="teltonika-modo-existente"
              />
              <span>La empresa ya los cargó. Solo escribo el IMEI</span>
            </label>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-neutral-700 text-sm">Transportista</span>
              <select
                value={empresaId}
                onChange={(e) => {
                  setEmpresaId(e.target.value);
                  setVehiculoId('');
                }}
                className={inputClass}
                data-testid="teltonika-empresa"
              >
                <option value="">Elige la empresa</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razon_social} · {e.rut}
                  </option>
                ))}
              </select>
            </label>

            {modo === 'existente' ? (
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-700 text-sm">Camión</span>
                <select
                  value={vehiculoId}
                  onChange={(e) => setVehiculoId(e.target.value)}
                  disabled={empresaId === ''}
                  className={inputClass}
                  data-testid="teltonika-vehiculo"
                >
                  <option value="">
                    {empresaId === '' ? 'Primero la empresa' : 'Elige la patente'}
                  </option>
                  {vehiculos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.patente}
                      {v.teltonika_imei ? ` · IMEI ${v.teltonika_imei}` : ' · sin IMEI'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Patente</span>
                  <input
                    type="text"
                    value={patente}
                    onChange={(e) => setPatente(e.target.value.toUpperCase())}
                    placeholder="ABCD12"
                    className={inputClass}
                    data-testid="teltonika-patente"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Tipo</span>
                  <select
                    value={tipo}
                    onChange={(e) => {
                      if (esTipoVehiculo(e.target.value)) {
                        setTipo(e.target.value);
                      }
                    }}
                    className={inputClass}
                    data-testid="teltonika-tipo"
                  >
                    {TIPOS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Capacidad (kg)</span>
                  <input
                    type="number"
                    min={1}
                    max={100_000}
                    value={capacidad}
                    onChange={(e) => setCapacidad(e.target.value)}
                    className={inputClass}
                    data-testid="teltonika-capacidad"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Marca</span>
                  <input
                    type="text"
                    value={marca}
                    onChange={(e) => setMarca(e.target.value)}
                    maxLength={50}
                    className={inputClass}
                    data-testid="teltonika-marca"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Modelo</span>
                  <input
                    type="text"
                    value={modelo}
                    onChange={(e) => setModelo(e.target.value)}
                    maxLength={100}
                    className={inputClass}
                    data-testid="teltonika-modelo"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Año</span>
                  <input
                    type="number"
                    min={1980}
                    max={2100}
                    value={anio}
                    onChange={(e) => setAnio(e.target.value)}
                    className={inputClass}
                    data-testid="teltonika-anio"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Combustible</span>
                  <select
                    value={combustible}
                    onChange={(e) => setCombustible(e.target.value)}
                    disabled={tipo === 'semi_remolque'}
                    className={inputClass}
                    data-testid="teltonika-combustible"
                  >
                    <option value="">Sin especificar</option>
                    {COMBUSTIBLES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-neutral-700 text-sm">Peso vacío (kg)</span>
                  <input
                    type="number"
                    min={1}
                    max={50_000}
                    value={pesoVacio}
                    onChange={(e) => setPesoVacio(e.target.value)}
                    placeholder={tipo === 'semi_remolque' ? 'Obligatorio en un semi' : 'Opcional'}
                    className={inputClass}
                    data-testid="teltonika-peso"
                  />
                </label>
              </>
            )}

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
                className={`${inputClass} font-mono`}
                data-testid="teltonika-imei"
              />
            </label>
            <div className="sm:col-span-2">
              {modo === 'existente' ? (
                <button
                  type="button"
                  disabled={!puedeAsignar}
                  onClick={() => void asignar()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  data-testid="teltonika-asociar"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Asignar IMEI
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!puedeHabilitar}
                  onClick={() => void habilitar()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  data-testid="teltonika-habilitar"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Habilitar para la empresa
                </button>
              )}
            </div>
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
