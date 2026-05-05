import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Bus,
  Leaf,
  LogOut,
  Package,
  PackagePlus,
  Radio,
  Settings,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app — dashboard post-login.
 *
 * Slice B.3.b/c: layout mínimo con header + main column placeholder. Las
 * vistas reales (lista de ofertas para carrier, lista de cargas para
 * shipper, dashboard admin) se construyen en B.5+.
 *
 * ProtectedRoute con `require-onboarded`: si no hay user → /login,
 * si needs_onboarding → /onboarding, sino render con `me` ya tipado.
 */
export function AppRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <AppDashboard me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function AppDashboard({ me }: { me: MeOnboarded }) {
  const activeEmpresa = me.active_membership?.empresa;
  const myRole = me.active_membership?.role;
  const isAdmin = myRole === 'dueno' || myRole === 'admin';

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
            <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
            {activeEmpresa && (
              <span className="ml-3 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                {activeEmpresa.legal_name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/app/perfil"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
            >
              <UserIcon className="h-4 w-4" aria-hidden />
              <span>{me.user.full_name}</span>
              <Settings className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Bienvenido a Booster
          </h1>

          {activeEmpresa ? (
            <p className="mt-2 text-neutral-600">
              Empresa activa: <span className="font-medium">{activeEmpresa.legal_name}</span>
              {activeEmpresa.is_transportista && ' · Transportista'}
              {activeEmpresa.is_generador_carga && ' · Generador de carga'}
            </p>
          ) : (
            <p className="mt-2 text-neutral-600">Sin empresa activa.</p>
          )}

          {activeEmpresa?.is_transportista && (
            <section className="mt-10">
              <h2 className="font-semibold text-neutral-900 text-xl">Como transportista</h2>
              <Link
                to="/app/ofertas"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                    aria-hidden
                  >
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">Ofertas activas</div>
                    <div className="text-neutral-600 text-sm">
                      Cargas disponibles para tu empresa. Acepta o rechaza rápido.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>

              <Link
                to="/app/vehiculos"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                    aria-hidden
                  >
                    <Bus className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">Vehículos</div>
                    <div className="text-neutral-600 text-sm">
                      Tu flota: agregar, editar, asociar dispositivos Teltonika.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>
            </section>
          )}

          {!activeEmpresa && (
            <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold text-neutral-900 text-xl">Aún no tienes empresa</h2>
              <p className="mt-2 text-neutral-700 text-sm">
                Para usar Booster necesitas crear una empresa o unirte a una existente. Si recién te
                registraste, hace falta completar el onboarding (RUT, datos legales, plan).
              </p>
              <Link
                to="/onboarding"
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
              >
                Crear empresa
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </section>
          )}

          {activeEmpresa &&
            !activeEmpresa.is_transportista &&
            !activeEmpresa.is_generador_carga && (
              <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
                <h2 className="font-semibold text-neutral-900 text-xl">
                  Tu empresa todavía no opera
                </h2>
                <p className="mt-2 text-neutral-700 text-sm">
                  Configura si vas a operar como generador de carga, transportista o ambos desde el
                  perfil de empresa.
                </p>
              </section>
            )}

          {activeEmpresa?.is_generador_carga && (
            <section className="mt-10">
              <h2 className="font-semibold text-neutral-900 text-xl">Como generador de carga</h2>
              <Link
                to="/app/cargas/nueva"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                    aria-hidden
                  >
                    <PackagePlus className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">Crear carga</div>
                    <div className="text-neutral-600 text-sm">
                      Origen, destino, tipo de carga y ventana de pickup. Matching automático con
                      transportistas.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>

              <Link
                to="/app/cargas"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                    aria-hidden
                  >
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">Mis cargas</div>
                    <div className="text-neutral-600 text-sm">
                      Estado del matching, asignaciones, seguimiento en vivo.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>

              <Link
                to="/app/certificados"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-emerald-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"
                    aria-hidden
                  >
                    <Leaf className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">
                      Certificados de huella de carbono
                    </div>
                    <div className="text-neutral-600 text-sm">
                      Descarga los certificados firmados (GLEC v3.0 + SEC Chile 2024) de tus viajes
                      entregados.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>
            </section>
          )}

          {isAdmin && activeEmpresa?.is_transportista && (
            <section className="mt-10">
              <h2 className="font-semibold text-neutral-900 text-xl">Administración</h2>
              <Link
                to="/app/admin/dispositivos"
                className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                    aria-hidden
                  >
                    <Radio className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium text-neutral-900">Dispositivos pendientes</div>
                    <div className="text-neutral-600 text-sm">
                      Aprueba dispositivos Teltonika que conectaron y asignalos a vehículos.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
              </Link>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
