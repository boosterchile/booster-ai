import { MapPinned } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { REGIONS_CHILE } from '../lib/regions-chile.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type ZoneType = 'recogida' | 'entrega' | 'ambos';

interface Zona {
  id: string;
  empresa_id: string;
  region_code: string;
  comuna_codes: string[] | null;
  zone_type: ZoneType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const TIPO_LABEL: Record<ZoneType, string> = {
  recogida: 'Recogida',
  entrega: 'Entrega',
  ambos: 'Ambos',
};

/**
 * `/app/zonas` — el transportista define dónde puede recoger.
 *
 * Matching exige una fila activa en `zonas` con `codigo_region` romano igual
 * al origen del viaje. Sin esta pantalla, las zonas solo se sembraban por SQL.
 */
export function ZonasRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ZonasPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function ZonasPage({ me }: { me: MeOnboarded }) {
  const empresa = me.active_membership?.empresa;
  const role = me.active_membership?.role;
  const canManage = empresa?.is_transportista === true && (role === 'dueno' || role === 'admin');

  const [zonas, setZonas] = useState<Zona[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState('XIII');
  const [tipo, setTipo] = useState<ZoneType>('ambos');
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ zonas: Zona[] }>('/me/zonas');
      setZonas(res.zonas);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) {
      void cargar();
    }
  }, [canManage, cargar]);

  async function handleAlta(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/me/zonas', { region_code: region, zone_type: tipo });
      await cargar();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'zona_duplicada') {
        setError('Ya tenés una zona de ese tipo en esa región. Activála o cambialé el tipo.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActiva(zona: Zona) {
    setPendingId(zona.id);
    setError(null);
    try {
      await api.patch(`/me/zonas/${zona.id}`, { is_active: !zona.is_active });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  const regionName = (code: string) => REGIONS_CHILE.find((r) => r.code === code)?.name ?? code;

  return (
    <Layout me={me} title="Zonas de matching">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-start gap-3">
          <MapPinned className="mt-1 h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">
              Zonas de matching
            </h1>
            <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
              Definí las regiones donde podés recoger carga. Si el origen de un viaje no cae en una
              zona activa, no te llega la oferta.
            </p>
          </div>
        </div>

        {!canManage && (
          <output className="mt-6 block rounded-md border border-warning-500/30 bg-warning-50 p-4 text-sm text-warning-700">
            Solo el dueño o un administrador de una empresa transportista puede gestionar las zonas
            de matching.
          </output>
        )}

        {canManage && (
          <>
            <form
              onSubmit={handleAlta}
              className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto]"
              data-testid="zona-alta-form"
            >
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-700 text-sm">Región</span>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  data-testid="zona-region"
                >
                  {REGIONS_CHILE.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium text-neutral-700 text-sm">Tipo</span>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as ZoneType)}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  data-testid="zona-tipo"
                >
                  <option value="ambos">Ambos (recogida y entrega)</option>
                  <option value="recogida">Recogida</option>
                  <option value="entrega">Entrega</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50 sm:w-auto"
                  data-testid="zona-agregar"
                >
                  {submitting ? 'Agregando…' : 'Agregar'}
                </button>
              </div>
            </form>

            {error && (
              <div
                className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
                data-testid="zona-error"
              >
                {error}
              </div>
            )}

            {loading && <p className="mt-6 text-neutral-500 text-sm">Cargando zonas…</p>}

            {!loading && zonas.length === 0 && (
              <p className="mt-6 text-neutral-500 text-sm" data-testid="zona-empty">
                Todavía no tenés zonas. Agregá al menos la región Metropolitana (XIII) para que te
                lleguen ofertas de Santiago.
              </p>
            )}

            {!loading && zonas.length > 0 && (
              <ul className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                {zonas.map((z) => (
                  <li
                    key={z.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    data-testid={`zona-row-${z.id}`}
                  >
                    <div>
                      <div className="font-medium text-neutral-900">
                        {regionName(z.region_code)}
                      </div>
                      <div className="text-neutral-500 text-xs">
                        {TIPO_LABEL[z.zone_type]}
                        {z.comuna_codes == null ? ' · toda la región' : ''}
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={z.is_active}
                        disabled={pendingId === z.id}
                        onChange={() => void toggleActiva(z)}
                        data-testid={`zona-toggle-${z.id}`}
                      />
                      <span className={z.is_active ? 'text-success-700' : 'text-neutral-500'}>
                        {z.is_active ? 'Activa' : 'Inactiva'}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
