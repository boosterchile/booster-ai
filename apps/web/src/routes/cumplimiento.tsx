import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, CheckCircle, Clock, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChileanPlate } from '../components/ChileanPlate.js';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

const VEHICLE_DOC_LABELS: Record<string, string> = {
  revision_tecnica: 'Revisión técnica',
  permiso_circulacion: 'Permiso de circulación',
  soap: 'SOAP',
  padron: 'Padrón',
  seguro_carga: 'Seguro de carga',
  poliza_responsabilidad: 'Póliza responsabilidad civil',
  certificado_emisiones: 'Certificado de emisiones',
  otro: 'Otro',
};

const DRIVER_DOC_LABELS: Record<string, string> = {
  licencia_conducir: 'Licencia de conducir',
  curso_b6: 'Curso B6 (cargas peligrosas)',
  certificado_antecedentes: 'Certificado de antecedentes',
  examen_psicotecnico: 'Examen psicotécnico',
  hoja_vida_conductor: 'Hoja de vida del conductor',
  certificado_salud: 'Certificado de salud',
  otro: 'Otro',
};

interface CumplimientoVehicleDoc {
  documento_id: string;
  vehiculo_id: string;
  plate: string;
  tipo: string;
  estado: 'vencido' | 'por_vencer' | 'vigente';
  fecha_vencimiento: string | null;
}

interface CumplimientoDriverDoc {
  documento_id: string;
  conductor_id: string;
  full_name: string;
  rut: string;
  tipo: string;
  estado: 'vencido' | 'por_vencer' | 'vigente';
  fecha_vencimiento: string | null;
}

interface CumplimientoResponse {
  resumen: {
    vencidos: number;
    por_vencer_30d: number;
    total_pendientes: number;
  };
  vehiculos: CumplimientoVehicleDoc[];
  conductores: CumplimientoDriverDoc[];
}

/**
 * /app/cumplimiento — Dashboard de documentos del carrier que están
 * vencidos o por vencer. Surface dedicada para el flujo "cultura de
 * mantenimiento preventivo" — el dueño/admin entra y ve de un golpe qué
 * necesita renovar pronto en su flota o entre sus conductores.
 *
 * Solo visible a carriers (transportistas). Shipper no ve esto.
 */
export function CumplimientoRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        const empresa = ctx.me.active_membership?.empresa;
        if (!empresa?.is_transportista) {
          return (
            <Layout me={ctx.me} title="Cumplimiento">
              <NoCarrierPermission />
            </Layout>
          );
        }
        return <CumplimientoPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function CumplimientoPage({ me }: { me: MeOnboarded }) {
  const q = useQuery({
    queryKey: ['cumplimiento'],
    queryFn: async () => await api.get<CumplimientoResponse>('/cumplimiento'),
  });

  return (
    <Layout me={me} title="Cumplimiento">
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
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Cumplimiento normativo
          </h1>
          <p className="mt-1 max-w-2xl text-neutral-600 text-sm">
            Documentos del vehículo (revisión técnica, permiso de circulación, SOAP) y del conductor
            (licencia, antecedentes, examen psicotécnico) que están <strong>vencidos</strong> o{' '}
            <strong>por vencer en los próximos 30 días</strong>. Mantenlos al día para evitar
            incidentes legales y multas.
          </p>
        </div>
      </header>

      {q.isLoading && <p className="mt-8 text-neutral-500">Cargando…</p>}
      {q.error && (
        <p className="mt-8 text-danger-700">Error al cargar el dashboard de cumplimiento.</p>
      )}

      {q.data && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard
              title="Vencidos"
              value={q.data.resumen.vencidos.toString()}
              icon={<AlertTriangle className="h-5 w-5 text-danger-700" aria-hidden />}
              tone="danger"
            />
            <SummaryCard
              title="Por vencer (30 días)"
              value={q.data.resumen.por_vencer_30d.toString()}
              icon={<Clock className="h-5 w-5 text-amber-700" aria-hidden />}
              tone="warning"
            />
            <SummaryCard
              title="Total a gestionar"
              value={q.data.resumen.total_pendientes.toString()}
              icon={<ShieldAlert className="h-5 w-5 text-primary-700" aria-hidden />}
              tone="neutral"
            />
          </div>

          {q.data.resumen.total_pendientes === 0 ? (
            <div className="mt-8 rounded-lg border border-success-200 bg-success-50/40 p-6 text-center">
              <CheckCircle className="mx-auto h-10 w-10 text-success-700" aria-hidden />
              <p className="mt-3 font-medium text-neutral-900">Todos los documentos están al día</p>
              <p className="mt-1 text-neutral-600 text-sm">
                Tu flota y conductores no tienen documentos pendientes de renovación.
              </p>
            </div>
          ) : (
            <>
              {q.data.vehiculos.length > 0 && (
                <section className="mt-10">
                  <h2 className="font-semibold text-neutral-900 text-xl">Vehículos</h2>
                  <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-neutral-200">
                      <thead className="bg-neutral-50">
                        <tr>
                          <Th>Patente</Th>
                          <Th>Documento</Th>
                          <Th>Estado</Th>
                          <Th>Vence</Th>
                          <Th>{''}</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 bg-white">
                        {q.data.vehiculos.map((d) => (
                          <tr key={d.documento_id} className="hover:bg-neutral-50">
                            <Td>
                              <ChileanPlate plate={d.plate} size="sm" />
                            </Td>
                            <Td>{VEHICLE_DOC_LABELS[d.tipo] ?? d.tipo}</Td>
                            <Td>
                              <EstadoBadge estado={d.estado} />
                            </Td>
                            <Td className="text-neutral-700 text-xs">
                              {d.fecha_vencimiento ?? '—'}
                            </Td>
                            <Td>
                              <Link
                                to="/app/vehiculos/$id"
                                params={{ id: d.vehiculo_id }}
                                className="text-primary-600 text-sm hover:underline"
                              >
                                Abrir vehículo →
                              </Link>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {q.data.conductores.length > 0 && (
                <section className="mt-10">
                  <h2 className="font-semibold text-neutral-900 text-xl">Conductores</h2>
                  <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-neutral-200">
                      <thead className="bg-neutral-50">
                        <tr>
                          <Th>Conductor</Th>
                          <Th>RUT</Th>
                          <Th>Documento</Th>
                          <Th>Estado</Th>
                          <Th>Vence</Th>
                          <Th>{''}</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 bg-white">
                        {q.data.conductores.map((d) => (
                          <tr key={d.documento_id} className="hover:bg-neutral-50">
                            <Td className="font-medium">{d.full_name}</Td>
                            <Td className="font-mono text-xs">{d.rut}</Td>
                            <Td>{DRIVER_DOC_LABELS[d.tipo] ?? d.tipo}</Td>
                            <Td>
                              <EstadoBadge estado={d.estado} />
                            </Td>
                            <Td className="text-neutral-700 text-xs">
                              {d.fecha_vencimiento ?? '—'}
                            </Td>
                            <Td>
                              <Link
                                to="/app/conductores/$id"
                                params={{ id: d.conductor_id }}
                                className="text-primary-600 text-sm hover:underline"
                              >
                                Abrir conductor →
                              </Link>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          <p className="mt-8 text-neutral-500 text-xs">
            La columna "Estado" se calcula automáticamente: <strong>Vencido</strong> si la fecha ya
            pasó, <strong>Por vencer</strong> si vence en los próximos 30 días. Carga o renueva los
            documentos desde el detalle del vehículo o conductor.
          </p>
        </>
      )}
    </Layout>
  );
}

function NoCarrierPermission() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-neutral-900 text-xl">Sin permisos</h2>
      <p className="mt-2 text-neutral-600 text-sm">
        El dashboard de cumplimiento es para empresas que operan como transportista.
      </p>
      <Link to="/app" className="mt-4 inline-block text-primary-600 underline">
        Volver al inicio
      </Link>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: 'vencido' | 'por_vencer' | 'vigente' }) {
  if (estado === 'vencido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-danger-50 px-2 py-0.5 font-medium text-danger-700 text-xs">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Vencido
      </span>
    );
  }
  if (estado === 'por_vencer') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700 text-xs">
        <Clock className="h-3 w-3" aria-hidden />
        Por vencer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-success-50 px-2 py-0.5 font-medium text-success-700 text-xs">
      <CheckCircle className="h-3 w-3" aria-hidden />
      Vigente
    </span>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  tone: 'danger' | 'warning' | 'neutral';
}) {
  const toneClasses =
    tone === 'danger'
      ? 'border-danger-200 bg-danger-50/40'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/40'
        : 'border-neutral-200 bg-white';
  return (
    <div className={`rounded-lg border ${toneClasses} p-4 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-neutral-500 text-xs uppercase tracking-wider">{title}</div>
          <div className="mt-1 font-bold text-3xl text-neutral-900">{value}</div>
        </div>
        {icon}
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-2 text-left font-medium text-neutral-500 text-xs uppercase tracking-wider">
      {children}
    </th>
  );
}

function Td({ className = '', children }: { className?: string; children: ReactNode }) {
  return <td className={`px-4 py-3 text-neutral-800 text-sm ${className}`}>{children}</td>;
}
