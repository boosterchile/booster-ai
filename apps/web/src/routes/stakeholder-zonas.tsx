import { STAKEHOLDER_ORG_TYPE_LABEL } from '@booster-ai/shared-schemas';
import { Link, Navigate } from '@tanstack/react-router';
import { ArrowLeft, Building2, Info, MapPin, Shield, Star, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * D11 — Surface stakeholder de análisis geográfico anónimo (skeleton).
 *
 * Objetivo de producto: stakeholders (mandantes regulatorios, asociaciones
 * gremiales, mesas público-privadas) analizan flujos de transporte en
 * zonas críticas (puertos, mercados de abastos, polos industriales) sin
 * exponer PII ni data identificable de empresas individuales.
 *
 * Garantía: k-anonymity ≥ 5 — un dato sólo se muestra si hay ≥ 5 viajes
 * únicos en la celda temporal-geográfica. Sin agregación suficiente, la
 * UI muestra "Sin data suficiente para preservar anonimato".
 *
 * **Estado actual**: skeleton. Las cards de zona están con data mock para
 * que el stakeholder pueda recorrer la pantalla y entender la propuesta
 * de valor. La integración con `trip-metrics` agregadas se ship en un PR
 * posterior cuando el seed demo tenga viajes históricos.
 *
 * Zonas predefinidas (estáticas en el frontend por ahora):
 *   - Puerto de Coquimbo (zona destacada — exportación frutícola + minería IV región)
 *   - Puerto Valparaíso
 *   - Puerto San Antonio (mayor volumen contenedores Chile)
 *   - Mercado Lo Valledor (abastos Stgo)
 *   - Polo industrial Quilicura
 *   - Zona Franca Iquique
 *
 * `destacado: true` marca zonas prioritarias para el contexto de demo
 * actual. Se muestran arriba en el grid con badge "Zona prioritaria"
 * para que el stakeholder vea primero el caso de uso central. No es un
 * concepto de producto permanente — pasa a feature flag o configuración
 * por organización cuando salga del modo demo.
 */

interface ZonaPredefinida {
  id: string;
  nombre: string;
  region: string;
  /**
   * Código ISO 3166-2:CL (e.g. `CL-VS`, `CL-RM`). Usado para filtrar las
   * zonas mostradas por el ámbito declarado de la organización stakeholder
   * (ADR-034 — `organizacion_stakeholder.region_ambito`).
   */
  region_iso: string;
  tipo: 'puerto' | 'mercado_abastos' | 'polo_industrial' | 'zona_franca';
  /**
   * Datos demo en este sprint — la próxima iteración pulla esto del API
   * `/stakeholder/zonas/:id/agregaciones` con queries reales sobre trips
   * filtradas por bounding box + ventana temporal + k-anonymity ≥ 5.
   */
  demo_viajes_30d: number;
  demo_co2e_kg: number;
  demo_horario_pico: string;
  /**
   * Marca la zona como prioritaria en el contexto de demo actual. Las
   * destacadas se ordenan primero en el grid y muestran badge visual.
   * Default undefined (no destacada).
   */
  destacado?: boolean;
  /** Etiqueta corta del foco de la zona (mostrada en cards destacadas). */
  destacado_foco?: string;
}

const ZONAS_DEMO: ZonaPredefinida[] = [
  {
    id: 'puerto-coquimbo',
    nombre: 'Puerto de Coquimbo',
    region: 'IV Coquimbo',
    region_iso: 'CL-CO',
    tipo: 'puerto',
    // Movimiento real ~1.5 Mt/año, dominado por concentrado de cobre
    // (Carmen, Andacollo) + uva de mesa y vinos para exportación
    // (refrigerados con ventana pico madrugada).
    demo_viajes_30d: 728,
    demo_co2e_kg: 287_400,
    demo_horario_pico: '04:00 – 08:00',
    destacado: true,
    destacado_foco: 'Exportación frutícola + concentrado de cobre',
  },
  {
    id: 'puerto-valparaiso',
    nombre: 'Puerto Valparaíso',
    region: 'V Valparaíso',
    region_iso: 'CL-VS',
    tipo: 'puerto',
    demo_viajes_30d: 1247,
    demo_co2e_kg: 312_400,
    demo_horario_pico: '06:00 – 10:00',
  },
  {
    id: 'puerto-san-antonio',
    nombre: 'Puerto San Antonio',
    region: 'V Valparaíso',
    region_iso: 'CL-VS',
    tipo: 'puerto',
    demo_viajes_30d: 1893,
    demo_co2e_kg: 478_900,
    demo_horario_pico: '05:00 – 09:00',
  },
  {
    id: 'mercado-lo-valledor',
    nombre: 'Mercado Lo Valledor',
    region: 'XIII Metropolitana',
    region_iso: 'CL-RM',
    tipo: 'mercado_abastos',
    demo_viajes_30d: 2104,
    demo_co2e_kg: 89_300,
    demo_horario_pico: '03:00 – 07:00',
  },
  {
    id: 'polo-quilicura',
    nombre: 'Polo industrial Quilicura',
    region: 'XIII Metropolitana',
    region_iso: 'CL-RM',
    tipo: 'polo_industrial',
    demo_viajes_30d: 856,
    demo_co2e_kg: 167_200,
    demo_horario_pico: '07:00 – 11:00',
  },
  {
    id: 'zofri-iquique',
    nombre: 'Zona Franca Iquique',
    region: 'I Tarapacá',
    region_iso: 'CL-TA',
    tipo: 'zona_franca',
    demo_viajes_30d: 425,
    demo_co2e_kg: 198_500,
    demo_horario_pico: '08:00 – 12:00',
  },
];

/**
 * Filtra las zonas según el ámbito geográfico de la organización
 * stakeholder. NULL `region_ambito` = ámbito nacional → todas las zonas
 * visibles. Cualquier otro valor filtra a las que matchean.
 *
 * Sin región matcheante: devuelve array vacío. El caller debe mostrar
 * estado "No hay zonas en el ámbito de tu organización".
 */
export function filterZonasByRegion(
  zonas: ZonaPredefinida[],
  regionAmbito: string | null | undefined,
): ZonaPredefinida[] {
  if (!regionAmbito) {
    return zonas;
  }
  return zonas.filter((z) => z.region_iso === regionAmbito);
}

/**
 * Ordena destacadas primero. Estable dentro de cada grupo (mantiene el
 * orden de declaración en ZONAS_DEMO para que la curaduría editorial
 * del array sea visible en la UI).
 */
export function sortZonasDestacadasPrimero(zonas: ZonaPredefinida[]): ZonaPredefinida[] {
  return [...zonas].sort((a, b) => {
    if (!!a.destacado === !!b.destacado) {
      return 0;
    }
    return a.destacado ? -1 : 1;
  });
}

const TIPO_LABEL: Record<ZonaPredefinida['tipo'], string> = {
  puerto: 'Puerto',
  mercado_abastos: 'Mercado de abastos',
  polo_industrial: 'Polo industrial',
  zona_franca: 'Zona franca',
};

const TIPO_COLOR: Record<ZonaPredefinida['tipo'], string> = {
  puerto: 'bg-sky-50 text-sky-700',
  mercado_abastos: 'bg-amber-50 text-amber-700',
  polo_industrial: 'bg-neutral-100 text-neutral-700',
  zona_franca: 'bg-violet-50 text-violet-700',
};

export function StakeholderZonasRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const role = ctx.me.active_membership?.role;
        if (role !== 'stakeholder_sostenibilidad') {
          // Otros roles no ven este dashboard — redirige a su inicio.
          return <Navigate to="/app" />;
        }
        return <StakeholderZonasPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function StakeholderZonasPage({ me }: { me: MeOnboarded }) {
  // ADR-034 — el active_membership de un stakeholder apunta a una
  // `organizacion_stakeholder` (no a una `empresa`). Extraemos el scope
  // declarado para filtrar las zonas mostradas.
  const org = me.active_membership?.organizacion_stakeholder ?? null;
  const zonasVisibles = sortZonasDestacadasPrimero(
    filterZonasByRegion(ZONAS_DEMO, org?.region_ambito),
  );

  return (
    <Layout me={me} title="Zonas de impacto">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Inicio
        </Link>
      </div>

      <header className="mt-4 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
          <TrendingUp className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Zonas de impacto logístico
          </h1>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Visualiza los flujos de transporte agregados en zonas críticas (puertos, mercados, polos
            industriales) para tomar decisiones sobre regulación, infraestructura y
            descarbonización. Toda la data está agregada con <strong>k-anonymity ≥ 5</strong>:
            ninguna celda identifica a empresas individuales.
          </p>
        </div>
      </header>

      {/* ADR-034 — Contexto de la organización stakeholder del usuario.
          Muestra a qué organización pertenece y cuál es su ámbito de
          datos (regional / sectorial / nacional). Esto da transparencia:
          el stakeholder ve por qué algunas zonas no aparecen (filtro). */}
      {org && (
        <div
          className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-violet-200 bg-violet-50/50 p-4 text-sm"
          data-testid="stakeholder-org-context"
        >
          <Building2 className="h-4 w-4 shrink-0 text-violet-700" aria-hidden />
          <div className="text-violet-900">
            <span className="font-semibold">{org.nombre_legal}</span>{' '}
            <span className="text-violet-700 text-xs">
              · {STAKEHOLDER_ORG_TYPE_LABEL[org.tipo]}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-violet-700 text-xs">
            <span className="rounded bg-violet-100 px-2 py-0.5">
              Ámbito: {org.region_ambito ? `Región ${org.region_ambito}` : 'Nacional'}
            </span>
            {org.sector_ambito && (
              <span className="rounded bg-violet-100 px-2 py-0.5">Sector: {org.sector_ambito}</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-md border border-amber-200 bg-amber-50/60 p-4 text-sm">
        <div className="flex items-start gap-2 text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong>Datos de demostración</strong>. Esta vista muestra el modelo de presentación con
            cifras ilustrativas. La integración con agregaciones reales de la base de trips va en el
            próximo PR del programa de stakeholders (ETA esta semana).
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-semibold text-neutral-900 text-xl">
          {org?.region_ambito ? `Zonas monitoreadas en ${org.region_ambito}` : 'Zonas monitoreadas'}
        </h2>
        <p className="mt-1 text-neutral-600 text-sm">
          {org?.region_ambito
            ? `Tu organización tiene ámbito regional ${org.region_ambito}. Solo ves zonas dentro de esa región.`
            : 'Selecciona una zona para drill-down a flujos por hora, tipo de carga y mix de combustible.'}
        </p>

        {zonasVisibles.length === 0 ? (
          <div
            className="mt-4 rounded-md border border-neutral-200 bg-white p-6 text-center text-neutral-600 text-sm"
            data-testid="stakeholder-zonas-empty"
          >
            <Info className="mx-auto h-8 w-8 text-neutral-300" aria-hidden />
            <p className="mt-2">
              No hay zonas dentro del ámbito de tu organización
              {org?.region_ambito && ` (${org.region_ambito})`}. Pídele a Booster que extienda el
              ámbito o agregue zonas nuevas si tu organización las necesita.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {zonasVisibles.map((z) => (
              <ZonaCard key={z.id} zona={z} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-900 text-lg">Metodología</h2>
        <ul className="mt-3 space-y-2 text-neutral-700 text-sm">
          <li className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <span>
              <strong>k-anonymity ≥ 5</strong>: cualquier celda (zona × hora × tipo de carga) sólo
              se publica si tiene ≥ 5 viajes únicos. Por debajo del umbral, la celda se rellena con
              "Sin data suficiente".
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" aria-hidden />
            <span>
              <strong>Bounding boxes geográficos</strong> predefinidos por zona (no se inputea libre
              por el stakeholder). Empezamos con 5 zonas; expandible con curaduría de la mesa
              pública.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-neutral-700" aria-hidden />
            <span>
              <strong>Sin PII ni empresas individuales</strong>: todo se reporta a nivel de
              agregado, jamás se expone la identidad de un shipper, carrier o conductor. Stakeholder
              firma consentimiento de uso ético al activar acceso.
            </span>
          </li>
        </ul>
      </section>
    </Layout>
  );
}

function ZonaCard({ zona }: { zona: ZonaPredefinida }) {
  const containerClass = zona.destacado
    ? 'relative overflow-hidden rounded-lg border-2 border-primary-300 bg-gradient-to-br from-white to-primary-50/50 p-4 shadow-md ring-1 ring-primary-100 transition hover:border-primary-400 hover:shadow-lg'
    : 'rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-primary-300';

  return (
    <div className={containerClass}>
      {zona.destacado && (
        <span className="-translate-y-1/2 absolute top-0 right-3 inline-flex translate-y-0 items-center gap-1 rounded-full bg-primary-600 px-2.5 py-0.5 font-semibold text-[10px] text-white uppercase tracking-wider shadow-sm">
          <Star className="h-3 w-3 fill-current" aria-hidden />
          Zona prioritaria
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-neutral-900">{zona.nombre}</h3>
          <p className="text-neutral-500 text-xs">{zona.region}</p>
          {zona.destacado && zona.destacado_foco && (
            <p className="mt-1 text-primary-800 text-xs italic">{zona.destacado_foco}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 font-medium text-xs ${TIPO_COLOR[zona.tipo]}`}
        >
          {TIPO_LABEL[zona.tipo]}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Stat label="Viajes (30 días)" value={zona.demo_viajes_30d.toLocaleString('es-CL')} />
        <Stat label="CO₂e total" value={`${(zona.demo_co2e_kg / 1000).toFixed(1)} t`} />
        <Stat label="Horario pico" value={zona.demo_horario_pico} className="col-span-2" />
      </dl>

      <button
        type="button"
        disabled
        className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-500 text-xs"
      >
        Drill-down — próximamente
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  className = '',
}: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-neutral-500 uppercase tracking-wider">{label}</dt>
      <dd className="mt-0.5 font-semibold text-neutral-900 text-sm">{value}</dd>
    </div>
  );
}
