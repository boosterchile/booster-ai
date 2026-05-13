/**
 * /app/certificados — listado dedicado de certificados de huella de
 * carbono emitidos a la empresa shipper activa.
 *
 * Origen del listado: GET /certificates (auth shipper). El endpoint
 * filtra automáticamente por activeMembership.empresa.
 *
 * Acción principal: descargar el PDF firmado. El click llama al endpoint
 * de download (signed URL TTL 5 min) y abre en pestaña nueva.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Award, Download, Leaf, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, emptyStateActionClass } from '../components/EmptyState.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';
import {
  CertDisabledError,
  CertNotIssuedError,
  descargarCertificadoDeViaje,
} from '../lib/cert-download.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

interface CertificadoListItem {
  trip_id: string;
  tracking_code: string;
  origin_address: string;
  destination_address: string;
  cargo_type: string;
  kg_co2e: string | null;
  distance_km: string | null;
  precision_method: string | null;
  glec_version: string | null;
  certificate_sha256: string | null;
  certificate_kms_key_version: string | null;
  certificate_issued_at: string | null;
  // ADR-021 §6.4 — empty backhaul allocation. Null para certs legacy
  // o trips sin perfil energético del vehículo.
  factor_matching_aplicado: string | null;
  ahorro_co2e_vs_sin_matching_kgco2e: string | null;
}

interface CertificadosResponse {
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
  const certsQ = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => {
      return await api.get<CertificadosResponse>('/certificates?limit=100');
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
              value={certsQ.data.certificates.length.toString()}
              icon={<Award className="h-5 w-5 text-primary-600" aria-hidden />}
            />
            <SummaryCard
              title="Total CO₂e certificado"
              value={`${formatKg(sumKg(certsQ.data.certificates))} kg`}
              icon={<Leaf className="h-5 w-5 text-emerald-600" aria-hidden />}
            />
            <SummaryCard
              title="Ahorro CO₂e via matching"
              value={`${formatKg(sumAhorroBackhaul(certsQ.data.certificates))} kg`}
              icon={<Leaf className="h-5 w-5 text-emerald-700" aria-hidden />}
            />
            <SummaryCard
              title="Estándar"
              value="GLEC v3.0 + SEC Chile"
              icon={<ShieldCheck className="h-5 w-5 text-amber-600" aria-hidden />}
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <Th>Código</Th>
                  <Th>Trayecto</Th>
                  <Th>Carga</Th>
                  <Th className="text-right">CO₂e</Th>
                  <Th className="text-right">Ahorro matching</Th>
                  <Th>Emitido</Th>
                  <Th className="text-right">Acción</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {certsQ.data.certificates.map((c) => (
                  <tr key={c.trip_id} className="hover:bg-neutral-50">
                    <Td className="font-mono font-semibold text-neutral-900">{c.tracking_code}</Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span>{c.origin_address}</span>
                        <span className="text-neutral-500">→ {c.destination_address}</span>
                      </div>
                    </Td>
                    <Td className="text-xs">{formatCargoType(c.cargo_type)}</Td>
                    <Td className="text-right font-semibold text-emerald-700">
                      {c.kg_co2e ? `${formatKg(Number(c.kg_co2e))} kg` : '—'}
                    </Td>
                    <Td className="text-right">
                      {c.ahorro_co2e_vs_sin_matching_kgco2e &&
                      Number(c.ahorro_co2e_vs_sin_matching_kgco2e) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 text-xs">
                          −{formatKg(Number(c.ahorro_co2e_vs_sin_matching_kgco2e))} kg
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-xs">—</span>
                      )}
                    </Td>
                    <Td className="text-neutral-600 text-xs">
                      {c.certificate_issued_at ? formatDate(c.certificate_issued_at) : '—'}
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        onClick={() => downloadM.mutate(c.trip_id)}
                        disabled={downloadM.isPending && downloadM.variables === c.trip_id}
                        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 font-medium text-primary-700 text-xs transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        {downloadM.isPending && downloadM.variables === c.trip_id
                          ? 'Abriendo…'
                          : 'Descargar'}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
 * quiere entender qué hay detrás del número kg CO2e del certificado.
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
          body="Factor SEC Chile 2024 (kg CO₂e/L). Diesel: 2,68. Gasolina: 2,32. GNC: 2,07. Eléctrico: factor de la matriz CL."
        />
      </div>

      <div className="mt-4 rounded-md border border-emerald-200 bg-white p-3 font-mono text-neutral-800 text-xs">
        <div className="font-semibold text-emerald-700">Ejemplo viaje Santiago → Concepción</div>
        <div className="mt-2 space-y-0.5">
          <div>distancia = 500 km</div>
          <div>consumo = 28 L/100km · diesel (camión pesado cargado)</div>
          <div>litros = 500 × 28 / 100 = 140 L</div>
          <div>kg CO₂e = 140 × 2,68 = 375,2 kg</div>
        </div>
      </div>

      <p className="mt-3 text-neutral-600 text-xs">
        El <strong>"Ahorro CO₂e via matching"</strong> compara la emisión real del viaje contra el
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
          carga. Si tu rol cambió, contactá al admin.
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

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left font-medium text-neutral-500 text-xs uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3 align-top text-neutral-800 text-sm ${className}`}>{children}</td>
  );
}

function SummaryCard({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-500 text-xs uppercase tracking-wider">
          {title}
        </span>
        {icon}
      </div>
      <div className="mt-2 font-semibold text-2xl text-neutral-900">{value}</div>
    </div>
  );
}

function sumKg(items: CertificadoListItem[]): number {
  return items.reduce((acc, c) => acc + (c.kg_co2e ? Number(c.kg_co2e) : 0), 0);
}

function sumAhorroBackhaul(items: CertificadoListItem[]): number {
  return items.reduce(
    (acc, c) =>
      acc +
      (c.ahorro_co2e_vs_sin_matching_kgco2e ? Number(c.ahorro_co2e_vs_sin_matching_kgco2e) : 0),
    0,
  );
}

function formatKg(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  }).format(new Date(iso));
}

function formatCargoType(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
