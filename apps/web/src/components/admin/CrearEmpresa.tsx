import { ensureRutHasDash, rutSchema } from '@booster-ai/shared-schemas';
import { Building2, Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError, api } from '../../lib/api-client.js';
import { REGIONS_CHILE } from '../../lib/regions-chile.js';

/**
 * Alta de la ficha legal desde platform-admin.
 *
 * Un generador de carga y un transportista son la misma fila `empresas`,
 * con uno u otro rol (o los dos). No crea la persona ni su clave: eso queda
 * en «Agregar persona a una empresa». La ficha nace en verificación.
 */

interface EmpresaCreada {
  ok: boolean;
  empresa_id: string;
  razon_social: string;
  rut: string;
  estado: string;
  es_generador_carga: boolean;
  es_transportista: boolean;
  plan_slug: string;
}

const inputClass =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';

export function CrearEmpresa({ onCreated }: { onCreated: (empresaId: string) => void }) {
  const [legalName, setLegalName] = useState('');
  const [rut, setRut] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+569');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('XIII');
  const [generador, setGenerador] = useState(true);
  const [transportista, setTransportista] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<EmpresaCreada | null>(null);

  const canSubmit =
    legalName.trim() !== '' &&
    rut.trim() !== '' &&
    email.trim() !== '' &&
    phone.trim() !== '' &&
    street.trim() !== '' &&
    city.trim() !== '' &&
    region !== '' &&
    (generador || transportista) &&
    !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreada(null);
    const rutNormalizado = ensureRutHasDash(rut);
    if (!rutSchema.safeParse(rutNormalizado).success) {
      setError('RUT inválido (ej: 76.274.900-9)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<EmpresaCreada>('/admin/empresas', {
        legal_name: legalName.trim(),
        rut: rutNormalizado,
        contact_email: email.trim(),
        contact_phone: phone.trim(),
        address_street: street.trim(),
        address_city: city.trim(),
        address_region: region,
        is_generador_carga: generador,
        is_transportista: transportista,
      });
      setCreada(res);
      onCreated(res.empresa_id);
      setLegalName('');
      setRut('');
      setEmail('');
      setPhone('+569');
      setStreet('');
      setCity('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rut_already_registered') {
        setError('Ya existe una empresa con ese RUT.');
      } else if (err instanceof ApiError && err.code === 'invalid_plan') {
        setError('El plan por defecto no está disponible. Avisa a ingeniería.');
      } else {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const roles = [
    creada?.es_generador_carga ? 'generador de carga' : null,
    creada?.es_transportista ? 'transportista' : null,
  ].filter((rol): rol is string => rol !== null);

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Crear empresa</h2>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Da de alta la ficha legal. Un generador de carga publica cargas; un transportista las
            mueve. Puedes marcar los dos. La empresa queda pendiente de verificación y no entra al
            matching hasta que la actives. La persona se agrega aparte, con su código: aquí no se
            crea ninguna clave.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-neutral-700 text-sm">Razón social</span>
          <input
            type="text"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            className={inputClass}
            placeholder="Ej: Retail Norte SpA"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">RUT de la empresa</span>
          <input
            type="text"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            className={inputClass}
            placeholder="12.345.678-5"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">Email de contacto</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="contacto@empresa.cl"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">Teléfono</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
            placeholder="+56912345678"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-neutral-700 text-sm">Ciudad</span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
            placeholder="Santiago"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-neutral-700 text-sm">Calle y número</span>
          <input
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className={inputClass}
            placeholder="Av. Apoquindo 3000"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium text-neutral-700 text-sm">Región</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass}>
            {REGIONS_CHILE.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-neutral-800 text-sm">
          <input
            type="checkbox"
            checked={generador}
            onChange={(e) => setGenerador(e.target.checked)}
          />
          Generador de carga
        </label>

        <label className="flex items-center gap-2 text-neutral-800 text-sm">
          <input
            type="checkbox"
            checked={transportista}
            onChange={(e) => setTransportista(e.target.checked)}
          />
          Transportista
        </label>

        {!generador && !transportista && (
          <p className="text-danger-700 text-sm sm:col-span-2">
            Marca al menos generador de carga o transportista.
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Crear empresa
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-3 text-danger-700 text-sm" role="alert">
          {error}
        </p>
      )}

      {creada && (
        <p className="mt-3 text-neutral-800 text-sm" data-testid="empresa-creada">
          {creada.razon_social} ({creada.rut}) quedó en verificación
          {roles.length > 0 ? ` como ${roles.join(' y ')}` : ''}. Actívala cuando corresponda y
          agrega a la primera persona en el formulario de abajo.
        </p>
      )}
    </section>
  );
}
