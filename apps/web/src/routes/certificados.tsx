import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Award, Leaf, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, emptyStateActionClass } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import {
  type CertificadoListItem,
  ListaCertificados,
} from '../components/certificados/ListaCertificados.js';
import { CifraHuella, TotalHuella } from '../components/huella/CifraHuella.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';
import {
  CertDisabledError,
  CertNotIssuedError,
  descargarCertificadoDeViaje,
} from '../lib/cert-download.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';
import { CO2E, formatoFactorEmision } from '../lib/formato-emisiones.js';
import { type PorPresentacion, campoPorPresentacion } from '../lib/presentacion-huella.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/** Totales de todos los certificados de la empresa (`resumenCertificados` del API). */
interface ResumenCertificados {
  certificados: number;
  medidos: number;
  estimados: number;
  kgco2e: number;
  ahorro_kgco2e: number;
  /** Las mismas cifras separadas por presentación: ningún total mezcla clases. */
  por_presentacion?: PorPresentacion;
}

interface CertificadosResponse {
  resumen: ResumenCertificados;
  certificates: CertificadoListItem[];
  pagination: { limit: number; offset: number; returned: number };
}

export function CertificadosRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const isShipper = ctx.me.active_membership?.empresa?.is_generador_carga ?? false;
        if (!isShipper) {
          return <NoShipperPermission me={ctx.me} />;
        }
        return <CertificadosPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function CertificadosPage({ me }: { me: MeOnboarded }) {
  const scope = useEmpresaScope();
  const certsQ = useQuery({
    queryKey: scope.key('certificates'),
    queryFn: async () => {
      return await api.get<CertificadosResponse>('/certificates?limit=100', scope.init);
    },
  });

  const downloadM = useMutation({
    mutationFn: descargarCertificadoDeViaje,
    onError: (err) => {
      if (err instanceof CertNotIssuedError) {
        window.alert(
          'El certificado todavía está generándose. Espera unos segundos y reinténtalo.',
        );
      } else if (err instanceof CertDisabledError) {
        window.alert('Los certificados están deshabilitados en este entorno.');
      } else {
        window.alert('No se pudo descargar el certificado. Inténtalo en un momento.');
      }
    },
  });

  return (
    <Layout me={me} title="Certificados">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-neutral-500 text-sm hover:text-neutral-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Inicio
        </Link>
      </div>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Leaf className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              Certificados de huella de carbono
            </h1>
            <p className="mt-1 text-neutral-600 text-sm">
              Cada viaje entregado emite un certificado firmado digitalmente con la metodología GLEC
              v3.0 y los factores de emisión SEC Chile 2024. Los certificados son verificables
              públicamente.
            </p>
          </div>
        </div>
      </header>

      {certsQ.isLoading && <p className="mt-8 text-neutral-500">Cargando certificados…</p>}
      {certsQ.error && (
        <p className="mt-8 text-danger-700">
          No pudimos cargar los certificados. Inténtalo en un momento.
        </p>
      )}

      {certsQ.data && certsQ.data.certificates.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={<Award className="h-10 w-10" aria-hidden />}
            title="Aún no tienes certificados emitidos"
            description="Cuando un viaje entregado se confirme como recibido, el sistema genera el certificado automáticamente. Te avisaremos por email."
            action={
              <Link to="/app/cargas" className={emptyStateActionClass}>
                Ver mis cargas
              </Link>
            }
          />
        </div>
      )}

      {certsQ.data && certsQ.data.certificates.length > 0 && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <SummaryCard
              title="Certificados emitidos"
              value={certsQ.data.resumen.certificados.toString()}
              testId="certificados-emitidos"
              icon={<Award className="h-5 w-5 text-primary-600" aria-hidden />}
            />
            <SummaryCard
              title={`Total ${CO2E} certificado`}
              value={
                <TotalHuella
                  porPresentacion={campoPorPresentacion(
                    certsQ.data.resumen.por_presentacion,
                    'kgco2e',
                    certsQ.data.resumen.kgco2e,
                  )}
                  className="text-base"
                />
              }
              testId="certificados-emisiones"
              icon={<Leaf className="h-5 w-5 text-emerald-600" aria-hidden />}
            />
            <SummaryCard
              title={`Ahorro ${CO2E} vía matching`}
              value={
                <TotalHuella
                  porPresentacion={campoPorPresentacion(
                    certsQ.data.resumen.por_presentacion,
                    'ahorro_kgco2e',
                    certsQ.data.resumen.ahorro_kgco2e,
                  )}
                  vacio="Sin ahorro registrado"
                  className="text-base"
                  data-testid="certificados-ahorro"
                />
              }
              icon={<Leaf className="h-5 w-5 text-emerald-700" aria-hidden />}
            />
            <SummaryCard
              title="Estándar"
              value="GLEC v3.0 + SEC Chile"
              icon={<ShieldCheck className="h-5 w-5 text-amber-600" aria-hidden />}
            />
          </div>

          <ListaCertificados
            certificados={certsQ.data.certificates}
            onDescargar={(tripId) => downloadM.mutate(tripId)}
            descargando={downloadM.isPending ? (downloadM.variables ?? null) : null}
          />

          <p className="mt-4 text-neutral-500 text-xs">
            Cada certificado se firma con RSA 4096 / SHA-256 (PKCS#1 v1.5) vía Google Cloud KMS.
            Verifica la firma de cualquier certificado en{' '}
            <code>
              api.boosterchile.com/certificates/{'{'}código{'}'}/verify
            </code>
            .
          </p>

          {/* D5 — Surfacing del método de cálculo. Aparece después de la
              tabla porque el usuario suele entrar primero a "ver mi total"
              y después quiere entender "cómo se calculó". */}
          <MethodologyCard />
        </>
      )}
    </Layout>
  );
}

/**
 * D5 — Card explicativa del método de cálculo de huella. No usa data en
 * vivo — es el "explainer" que se muestra al stakeholder y al shipper que
 * quiere entender qué hay detrás de la huella del certificado.
 */
function MethodologyCard() {
  return (
    <section className="mt-8 rounded-lg border border-emerald-100 bg-emerald-50/40 p-5">
      <h2 className="font-semibold text-base text-neutral-900">
        Cómo calculamos la huella de carbono
      </h2>
      <p className="mt-1 text-neutral-700 text-sm">
        Aplicamos GLEC Framework v3.0 (Smart Freight Centre) con factores de emisión publicados por
        la Superintendencia de Electricidad y Combustibles (SEC) de Chile, edición 2024.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MethodologyItem
          step="1. Distancia"
          body="Distancia real recorrida por el vehículo, medida con telemetría Teltonika o, en su defecto, ruta calculada por Google Routes API."
        />
        <MethodologyItem
          step="2. Consumo"
          body="Consumo declarado L/100km × distancia. Si el vehículo no declara consumo, usamos default por tipo y combustible."
        />
        <MethodologyItem
          step="3. Factor emisión"
          body={`Factor SEC Chile 2024. Diésel: ${formatoFactorEmision(2.68)}. Gasolina: ${formatoFactorEmision(2.32)}. GNC: ${formatoFactorEmision(2.07)}. Eléctrico: factor de la matriz CL.`}
        />
      </div>

      <div className="mt-4 rounded-md border border-emerald-200 bg-white p-3 font-mono text-neutral-800 text-xs">
        <div className="font-semibold text-emerald-700">Ejemplo viaje Santiago → Concepción</div>
        <div className="mt-2 space-y-0.5">
          <div>distancia = 500 km</div>
          <div>consumo = 28 L/100km · diesel (camión pesado cargado)</div>
          <div>litros = 500 × 28 / 100 = 140 L</div>
          <div>
            {/* Consumo y distancia modelados: el ejemplo es «Estimado» (ADR-091). */}
            emisiones = 140 L × {formatoFactorEmision(2.68)} ={' '}
            <CifraHuella valor={140 * 2.68} presentacion="estimado" className="font-sans" />
          </div>
        </div>
      </div>

      <p className="mt-3 text-neutral-600 text-xs">
        El <strong>«Ahorro {CO2E} vía matching»</strong> compara la emisión real del viaje contra el
        escenario sin matching (vehículo regresa vacío). Con backhaul ese viaje contraflujo no
        ocurre, así que el ahorro es la emisión evitada del trip espejo.
      </p>
    </section>
  );
}

function MethodologyItem({ step, body }: { step: string; body: string }) {
  return (
    <div className="rounded-md border border-emerald-100 bg-white p-3">
      <div className="font-semibold text-emerald-700 text-xs uppercase tracking-wider">{step}</div>
      <p className="mt-1 text-neutral-700 text-xs">{body}</p>
    </div>
  );
}

function NoShipperPermission({ me }: { me: MeOnboarded }) {
  void me;
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
        <p className="mt-2 text-neutral-600 text-sm">
          Los certificados de huella de carbono son para empresas que operan como generador de
          carga. Si tu rol cambió, contacta al admin.
        </p>
        <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers de presentación
// =============================================================================

function SummaryCard({
  title,
  value,
  icon,
  testId,
}: {
  title: string;
  value: ReactNode;
  icon: ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-500 text-xs uppercase tracking-wider">
          {title}
        </span>
        {icon}
      </div>
      <div className="mt-2 font-semibold text-2xl text-neutral-900" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}
