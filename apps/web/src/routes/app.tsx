import { Link, Navigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Banknote,
  Building2,
  Bus,
  Leaf,
  MapPinned,
  Package,
  PackagePlus,
  Radio,
  Receipt,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
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

  // Platform admin surface guard. El admin de plataforma no es tenant: no
  // tiene empresa propia ni rol de tenant. Su único hub es
  // /app/platform-admin (seed, ops platform-wide). Si además tuviera
  // memberships de testing, puede navegar manualmente a las otras
  // surfaces — pero el landing por defecto es el panel admin.
  if (me.user.is_platform_admin) {
    return <Navigate to="/app/platform-admin" />;
  }

  // D9 — Driver surface guard. Si el rol activo es 'conductor', el user
  // no debería ver el dashboard carrier (ofertas/vehículos/cargas).
  // Redirigimos a /app/conductor (su único hub: dashboard con servicios
  // asignados + alerta WhatsApp + reporte GPS). Excepción: si el mismo
  // user tiene OTRA membership donde es dueño/admin/etc., puede hacer
  // switch desde Layout y vuelve al dashboard carrier normalmente.
  if (myRole === 'conductor') {
    return <Navigate to="/app/conductor" />;
  }

  // D11 — Stakeholder surface guard. Si el rol activo es stakeholder,
  // su único hub útil es /app/stakeholder/zonas — el dashboard general
  // (carrier/shipper) no le aplica.
  if (myRole === 'stakeholder_sostenibilidad') {
    return <Navigate to="/app/stakeholder/zonas" />;
  }

  return (
    <Layout me={me} title="Inicio">
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight sm:text-3xl">
        Bienvenido a Booster
      </h1>

      {activeEmpresa ? (
        <p className="mt-2 text-neutral-600 text-sm sm:text-base">
          Empresa activa: <span className="font-medium">{activeEmpresa.legal_name}</span>
          {activeEmpresa.is_transportista && ' · Transportista'}
          {activeEmpresa.is_generador_carga && ' · Generador de carga'}
        </p>
      ) : (
        <p className="mt-2 text-neutral-600 text-sm sm:text-base">Sin empresa activa.</p>
      )}

      {activeEmpresa?.is_transportista && (
        <section className="mt-10">
          <h2 className="font-semibold text-neutral-900 text-xl">Como transportista</h2>
          <Link
            to="/app/flota"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
            data-testid="dashboard-link-flota"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                aria-hidden
              >
                <MapPinned className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Seguimiento de flota</div>
                <div className="text-neutral-600 text-sm">
                  Ubicación en tiempo real de todos tus vehículos en un mapa, con histórico.
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
          </Link>

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
                  Gestiona tu flota: alta, edición, asociación a Teltonika.
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
          </Link>

          <Link
            to="/app/conductores"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
            data-testid="dashboard-link-conductores"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                aria-hidden
              >
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Conductores</div>
                <div className="text-neutral-600 text-sm">
                  Crea, edita y monitorea licencias y vencimientos de los conductores de tu empresa.
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
          </Link>

          <Link
            to="/app/cumplimiento"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-amber-500 hover:shadow-md"
            data-testid="dashboard-link-cumplimiento"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700"
                aria-hidden
              >
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Cumplimiento</div>
                <div className="text-neutral-600 text-sm">
                  Documentos vencidos o por vencer de vehículos y conductores (revisión técnica,
                  SOAP, licencia, antecedentes…).
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
          </Link>

          <Link
            to="/app/cobra-hoy/historial"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-success-700 hover:shadow-md"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-success-50 text-success-700"
                aria-hidden
              >
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Cobra hoy</div>
                <div className="text-neutral-600 text-sm">
                  Solicita pronto pago de viajes entregados y revisa tu historial de adelantos.
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-neutral-400" aria-hidden />
          </Link>

          <Link
            to="/app/liquidaciones"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                aria-hidden
              >
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Liquidaciones</div>
                <div className="text-neutral-600 text-sm">
                  Desglose de cada viaje entregado: monto bruto, comisión, IVA y DTE Tipo 33.
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
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700"
            >
              Crear empresa
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {/* Atajo discreto para admins de plataforma (validación de
                    autorización es server-side en el backend). */}
            <Link
              to="/app/platform-admin"
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 text-sm hover:bg-neutral-100"
              data-testid="empty-state-link-platform-admin"
            >
              Soy admin de plataforma
            </Link>
          </div>
        </section>
      )}

      {activeEmpresa && !activeEmpresa.is_transportista && !activeEmpresa.is_generador_carga && (
        <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-neutral-900 text-xl">Tu empresa todavía no opera</h2>
          <p className="mt-2 text-neutral-700 text-sm">
            Configura si vas a operar como generador de carga, transportista o ambos desde el perfil
            de empresa.
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
            to="/app/sucursales"
            className="mt-3 flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-primary-500 hover:shadow-md"
            data-testid="dashboard-link-sucursales"
          >
            <div className="flex items-center gap-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-50 text-primary-600"
                aria-hidden
              >
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="font-medium text-neutral-900">Sucursales</div>
                <div className="text-neutral-600 text-sm">
                  Bodegas, plantas y centros de distribución. Puntos físicos de origen y destino
                  para tus cargas.
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
    </Layout>
  );
}
