import { Card, CardBody, CardHeader } from '@booster-ai/ui-components';
import { Leaf } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface EmpresaHuella {
  id: string;
  legal_name: string;
  carbon_measurement_enabled: boolean;
  umbral_robo_golpe_l: number | null;
  umbral_robo_hormiga_l: number | null;
}

/**
 * `/app/empresa` — configuración de la empresa activa.
 *
 * Primer control: opt-in de medición de huella
 * (`empresas.carbon_measurement_enabled`). Sin esta pantalla el cómputo
 * post-entrega (T11–T13) queda siempre OFF en prod salvo SQL.
 */
export function EmpresaRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <EmpresaPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function EmpresaPage({ me }: { me: MeOnboarded }) {
  const empresa = me.active_membership?.empresa;
  const role = me.active_membership?.role;
  const canManage = Boolean(empresa) && (role === 'dueno' || role === 'admin');

  const [huella, setHuella] = useState<EmpresaHuella | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<EmpresaHuella>('/me/empresa');
      setHuella({
        ...res,
        umbral_robo_golpe_l: res.umbral_robo_golpe_l ?? null,
        umbral_robo_hormiga_l: res.umbral_robo_hormiga_l ?? null,
      });
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

  async function guardar(enabled: boolean) {
    if (saving || !huella || huella.carbon_measurement_enabled === enabled) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.patch<{
        carbon_measurement_enabled: boolean;
      }>('/me/empresa', { carbon_measurement_enabled: enabled });
      setHuella((prev) =>
        prev ? { ...prev, carbon_measurement_enabled: res.carbon_measurement_enabled } : prev,
      );
      setSuccess(
        res.carbon_measurement_enabled
          ? 'Listo. Vamos a medir la huella en tus próximos viajes.'
          : 'Listo. Dejamos de medir la huella en viajes nuevos.',
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? 'No se pudo guardar. Probá de nuevo.'
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout me={me} title="Empresa">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-3">
          <Leaf className="mt-1 h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <div>
            <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">Empresa</h1>
            <p className="mt-1 text-neutral-600 text-sm">
              {empresa?.legal_name
                ? `Configuración de ${empresa.legal_name}.`
                : 'Configuración de la empresa activa.'}
            </p>
          </div>
        </div>

        {!canManage && (
          <p className="mt-8 rounded-md border border-neutral-200 bg-white p-4 text-neutral-700 text-sm">
            Solo el dueño o un administrador puede cambiar esta opción.
          </p>
        )}

        {canManage && empresa?.is_transportista && !loading && huella ? (
          <UmbralesCombustible
            golpeL={huella.umbral_robo_golpe_l}
            hormigaL={huella.umbral_robo_hormiga_l}
            onGuardado={(golpe, hormiga) =>
              setHuella((prev) =>
                prev
                  ? { ...prev, umbral_robo_golpe_l: golpe, umbral_robo_hormiga_l: hormiga }
                  : prev,
              )
            }
          />
        ) : null}
        {canManage && empresa?.is_transportista && (loading || !huella) ? (
          <p className="mt-8 text-neutral-500 text-sm">Cargando umbrales…</p>
        ) : null}

        {canManage && (
          <Card className="mt-8">
            <CardHeader>Huella de carbono</CardHeader>
            <CardBody>
              {loading && <p className="text-neutral-500 text-sm">Cargando configuración…</p>}

              {!loading && huella && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-xl">
                    <label htmlFor="carbon-opt-in" className="font-medium text-neutral-900 text-sm">
                      Medí la huella de carbono en mis viajes
                    </label>
                    <p id="carbon-opt-in-help" className="mt-1 text-neutral-600 text-sm">
                      Si lo activás, medimos las emisiones de cada viaje entregado sobre el
                      recorrido real (GLEC v3.0). Sin peso declarado no inventamos un 0: el
                      certificado queda degradado. Los viajes ya medidos no se borran si lo
                      desactivás.
                    </p>
                  </div>
                  <input
                    id="carbon-opt-in"
                    type="checkbox"
                    role="switch"
                    className="mt-1 h-5 w-9 shrink-0 accent-primary-600"
                    checked={huella.carbon_measurement_enabled}
                    aria-checked={huella.carbon_measurement_enabled}
                    disabled={saving}
                    aria-busy={saving || undefined}
                    aria-describedby="carbon-opt-in-help"
                    data-testid="carbon-opt-in"
                    onChange={(e) => void guardar(e.target.checked)}
                  />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700 text-sm"
                >
                  {error}
                </div>
              )}
              {success && (
                <output className="mt-4 block rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
                  {success}
                </output>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function UmbralesCombustible({
  golpeL,
  hormigaL,
  onGuardado,
}: {
  golpeL: number | null;
  hormigaL: number | null;
  onGuardado: (golpe: number | null, hormiga: number | null) => void;
}) {
  const [golpe, setGolpe] = useState(golpeL == null ? '' : String(golpeL));
  const [hormiga, setHormiga] = useState(hormigaL == null ? '' : String(hormigaL));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setGolpe(golpeL == null ? '' : String(golpeL));
    setHormiga(hormigaL == null ? '' : String(hormigaL));
  }, [golpeL, hormigaL]);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const golpeNum = golpe === '' ? null : Number(golpe);
    const hormigaNum = hormiga === '' ? null : Number(hormiga);
    try {
      const res = await api.patch<{
        umbral_robo_golpe_l: number | null;
        umbral_robo_hormiga_l: number | null;
      }>('/me/empresa/umbrales-combustible', {
        umbral_robo_golpe_l: golpeNum,
        umbral_robo_hormiga_l: hormigaNum,
      });
      onGuardado(res.umbral_robo_golpe_l, res.umbral_robo_hormiga_l);
      setSuccess('Listo. Guardamos los umbrales para toda la flota.');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? 'No se pudieron guardar los umbrales. Probá de nuevo.'
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>Avisos de combustible</CardHeader>
      <CardBody>
        <form onSubmit={(event) => void guardar(event)}>
          <fieldset className="flex flex-col gap-4" disabled={saving}>
            <legend className="font-medium text-neutral-900 text-sm">Umbrales de la empresa</legend>
            <div>
              <label htmlFor="umbral-golpe" className="font-medium text-neutral-900 text-sm">
                Umbral de golpe único
              </label>
              <p id="umbral-golpe-help" className="mt-1 text-neutral-600 text-sm">
                Si el combustible baja de una, con el vehículo quieto, marcamos «posible robo
                combustible». Menos de 5 L no se ofrece: el sensor hace ruido. Si no elegís nada,
                usamos 8 L (o el 2 % del estanque, si lo conocemos).
              </p>
              <select
                id="umbral-golpe"
                name="umbral_robo_golpe_l"
                className="mt-2 block rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                value={golpe}
                aria-describedby="umbral-golpe-help"
                onChange={(event) => setGolpe(event.target.value)}
              >
                <option value="">Predeterminado (8 L)</option>
                {rango(5, 20).map((litros) => (
                  <option key={litros} value={String(litros)}>
                    {litros} L
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="umbral-hormiga" className="font-medium text-neutral-900 text-sm">
                Umbral de robo hormiga
              </label>
              <p id="umbral-hormiga-help" className="mt-1 text-neutral-600 text-sm">
                Varias bajas chicas, separadas, suman este umbral y marcamos «posible robo hormiga».
                Es otro aviso, distinto del golpe. Si no elegís nada, usamos 10 L.
              </p>
              <select
                id="umbral-hormiga"
                name="umbral_robo_hormiga_l"
                className="mt-2 block rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                value={hormiga}
                aria-describedby="umbral-hormiga-help"
                onChange={(event) => setHormiga(event.target.value)}
              >
                <option value="">Predeterminado (10 L)</option>
                {rango(8, 30).map((litros) => (
                  <option key={litros} value={String(litros)}>
                    {litros} L
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex w-fit rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40"
              disabled={saving}
            >
              Guardar umbrales
            </button>
          </fieldset>
          {error ? (
            <p role="alert" className="mt-4 text-danger-700 text-sm">
              {error}
            </p>
          ) : null}
          {success ? (
            <output className="mt-4 block text-sm text-success-700">{success}</output>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}

function rango(desde: number, hasta: number): number[] {
  const valores: number[] = [];
  for (let litros = desde; litros <= hasta; litros++) {
    valores.push(litros);
  }
  return valores;
}
