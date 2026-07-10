import { Card, cn } from '@booster-ai/ui-components';
import { Link, Navigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Banknote,
  Building2,
  Bus,
  Leaf,
  type LucideIcon,
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
 * /app — dashboard post-login (hub de navegación role-aware). Migrado a D2:
 * las cards son la primitiva `Card` (padding por registro **operador**), los
 * acentos por card son tokens semánticos (no hex hardcodeado). Sin datos —
 * pura navegación (el detalle vive en cada surface).
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

type Tone = 'primary' | 'warning' | 'success';

interface DashCard {
  to: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  tone?: Tone;
  testId?: string;
}

const TONE_CLASS: Record<Tone, { badge: string; hover: string }> = {
  primary: { badge: 'bg-primary-50 text-primary-600', hover: 'hover:border-primary-500' },
  warning: { badge: 'bg-warning-50 text-warning-700', hover: 'hover:border-warning-500' },
  success: { badge: 'bg-success-50 text-success-700', hover: 'hover:border-success-600' },
};

/** Card de navegación del dashboard (primitiva D2 `Card` + acento semántico). */
function DashboardCard({ to, icon: Icon, title, desc, tone = 'primary', testId }: DashCard) {
  const t = TONE_CLASS[tone];
  return (
    <Link to={to} data-testid={testId} className="mt-3 block">
      <Card className={cn('flex items-center justify-between transition hover:shadow-md', t.hover)}>
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
              t.badge,
            )}
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-neutral-900">{title}</div>
            <div className="text-neutral-600 text-sm">{desc}</div>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden />
      </Card>
    </Link>
  );
}

const TRANSPORTISTA_CARDS: DashCard[] = [
  {
    to: '/app/flota',
    icon: MapPinned,
    title: 'Seguimiento de flota',
    desc: 'Ubicación en tiempo real de todos tus vehículos en un mapa, con histórico.',
    testId: 'dashboard-link-flota',
  },
  {
    to: '/app/ofertas',
    icon: Truck,
    title: 'Ofertas activas',
    desc: 'Cargas disponibles para tu empresa. Acepta o rechaza rápido.',
  },
  {
    to: '/app/vehiculos',
    icon: Bus,
    title: 'Vehículos',
    desc: 'Gestiona tu flota: alta, edición, asociación a Teltonika.',
  },
  {
    to: '/app/conductores',
    icon: Users,
    title: 'Conductores',
    desc: 'Crea, edita y monitorea licencias y vencimientos de los conductores de tu empresa.',
    testId: 'dashboard-link-conductores',
  },
  {
    to: '/app/cumplimiento',
    icon: ShieldAlert,
    title: 'Cumplimiento',
    desc: 'Documentos vencidos o por vencer de vehículos y conductores (revisión técnica, SOAP, licencia, antecedentes…).',
    tone: 'warning',
    testId: 'dashboard-link-cumplimiento',
  },
  {
    to: '/app/cobra-hoy/historial',
    icon: Banknote,
    title: 'Cobra hoy',
    desc: 'Solicita pronto pago de viajes entregados y revisa tu historial de adelantos.',
    tone: 'success',
  },
  {
    to: '/app/liquidaciones',
    icon: Receipt,
    title: 'Liquidaciones',
    desc: 'Desglose de cada viaje entregado: monto bruto, comisión, IVA y DTE Tipo 33.',
  },
];

const GENERADOR_CARDS: DashCard[] = [
  {
    to: '/app/cargas/nueva',
    icon: PackagePlus,
    title: 'Crear carga',
    desc: 'Origen, destino, tipo de carga y ventana de pickup. Matching automático con transportistas.',
  },
  {
    to: '/app/cargas',
    icon: Package,
    title: 'Mis cargas',
    desc: 'Estado del matching, asignaciones, seguimiento en vivo.',
  },
  {
    to: '/app/sucursales',
    icon: Building2,
    title: 'Sucursales',
    desc: 'Bodegas, plantas y centros de distribución. Puntos físicos de origen y destino para tus cargas.',
    testId: 'dashboard-link-sucursales',
  },
  {
    to: '/app/certificados',
    icon: Leaf,
    title: 'Certificados de huella de carbono',
    desc: 'Descarga los certificados firmados (GLEC v3.0 + SEC Chile 2024) de tus viajes entregados.',
  },
];

function AppDashboard({ me }: { me: MeOnboarded }) {
  const activeEmpresa = me.active_membership?.empresa;
  const myRole = me.active_membership?.role;
  const isAdmin = myRole === 'dueno' || myRole === 'admin';

  // Surface guards (platform-admin / conductor / stakeholder tienen shell propio).
  if (me.user.is_platform_admin) {
    return <Navigate to="/app/platform-admin" />;
  }
  if (myRole === 'conductor') {
    return <Navigate to="/app/conductor" />;
  }
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
          {TRANSPORTISTA_CARDS.map((c) => (
            <DashboardCard key={c.to} {...c} />
          ))}
          {isAdmin && (
            <DashboardCard
              to="/app/admin/dispositivos"
              icon={Radio}
              title="Dispositivos pendientes"
              desc="Aprueba dispositivos Teltonika que conectaron y asignalos a vehículos."
            />
          )}
        </section>
      )}

      {activeEmpresa?.is_generador_carga && (
        <section className="mt-10">
          <h2 className="font-semibold text-neutral-900 text-xl">Como generador de carga</h2>
          {GENERADOR_CARDS.map((c) => (
            <DashboardCard key={c.to} {...c} />
          ))}
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
    </Layout>
  );
}
