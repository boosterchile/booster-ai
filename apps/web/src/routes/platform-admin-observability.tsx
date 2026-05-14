import { Link } from '@tanstack/react-router';
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowLeft,
  BarChart3Icon,
  GaugeIcon,
  Loader2,
  TrendingUpIcon,
  WalletIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';

/**
 * /app/platform-admin/observability — dashboard de costos y operaciones
 * para platform-admin Booster (spec 2026-05-13).
 *
 * Auth: server-side BOOSTER_PLATFORM_ADMIN_EMAILS allowlist (403 si no).
 * `meRequirement=skip` — admin no requiere membership/empresa propia.
 *
 * Esta route es el skeleton del C5. Los 5 tabs se implementan en C6
 * (apps/web/src/components/observability/{Costos,Salud,Uso,Capacity,Forecast}Tab.tsx).
 */

type TabId = 'costos' | 'salud' | 'uso' | 'capacity' | 'forecast';

interface TabSpec {
  id: TabId;
  label: string;
  icon: ReactNode;
  description: string;
}

const TABS: TabSpec[] = [
  {
    id: 'costos',
    label: 'Costos',
    icon: <WalletIcon className="h-4 w-4" aria-hidden />,
    description: 'GCP + Twilio + Workspace en CLP, breakdown por servicio y proyecto',
  },
  {
    id: 'salud',
    label: 'Salud',
    icon: <ActivityIcon className="h-4 w-4" aria-hidden />,
    description: 'Uptime checks + Cloud Run + Cloud SQL — semáforos por componente',
  },
  {
    id: 'uso',
    label: 'Uso',
    icon: <BarChart3Icon className="h-4 w-4" aria-hidden />,
    description: 'Twilio (balance + categorías), Google Workspace (seats + costo)',
  },
  {
    id: 'capacity',
    label: 'Capacity',
    icon: <GaugeIcon className="h-4 w-4" aria-hidden />,
    description: 'Headroom CPU/RAM/disco/conexiones para Cloud Run + Cloud SQL',
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: <TrendingUpIcon className="h-4 w-4" aria-hidden />,
    description: 'Proyección fin de mes vs MONTHLY_BUDGET_USD, FX dinámico mindicador.cl',
  },
];

export function PlatformAdminObservabilityRoute() {
  return (
    <ProtectedRoute meRequirement="skip">{() => <PlatformAdminObservabilityPage />}</ProtectedRoute>
  );
}

function PlatformAdminObservabilityPage() {
  const [activeTab, setActiveTab] = useState<TabId>('costos');

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <BarChart3Icon className="h-6 w-6 text-primary-600" aria-hidden />
            <div>
              <div className="font-semibold text-neutral-900">Observabilidad de plataforma</div>
              <div className="text-neutral-500 text-xs">
                Costos GCP + Twilio + Google Workspace · Salud técnica · Forecast
              </div>
            </div>
          </div>
          <Link
            to="/app/platform-admin"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Volver a Platform Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <nav
          className="-mb-px flex flex-wrap gap-1 border-neutral-200 border-b"
          aria-label="Tabs"
          role="tablist"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              data-testid={`observability-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          <div className="mb-4 text-neutral-600 text-sm">
            {TABS.find((t) => t.id === activeTab)?.description}
          </div>
          <TabContent active={activeTab} />
        </div>
      </main>
    </div>
  );
}

/**
 * Placeholder de cada tab — C6 reemplaza con componentes reales
 * (CostosTab, SaludTab, UsoTab, CapacityTab, ForecastTab).
 */
function TabContent({ active }: { active: TabId }) {
  return (
    <section
      role="tabpanel"
      data-testid={`observability-panel-${active}`}
      className="rounded-lg border border-neutral-300 border-dashed bg-white p-8"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" aria-hidden />
        <div>
          <h2 className="font-semibold text-neutral-900">Tab {active}</h2>
          <p className="mt-1 text-neutral-600 text-sm">
            Skeleton del C5 — la implementación de este tab llega en el commit C6 del PR de
            observability dashboard. Endpoints del backend ya operativos en
            <code className="ml-1 rounded bg-neutral-100 px-1 text-xs">/admin/observability/*</code>
            .
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
            <AlertTriangleIcon className="h-3.5 w-3.5" aria-hidden />
            Pendiente C6 · backend está listo y respondiendo.
          </div>
        </div>
      </div>
    </section>
  );
}
