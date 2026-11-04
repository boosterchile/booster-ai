import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { z } from 'zod';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { PlatformAdminFrame } from '../components/admin/PlatformAdminFrame.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * /app/platform-admin/observatorio — observatorio urbano, vista interna
 * (T10-24, ADR-012 Capa 2; el ADR la nombra `/admin/observatory/coquimbo`).
 *
 * Lee `GET /admin/observatorio/:region`: agregados de BigQuery con k ≥ 10
 * vehículos distintos por grupo. Nunca muestra vehículos ni viajes
 * individuales. Coquimbo (IV) es el piloto y la región por defecto.
 */
const REGIONES: Array<[string, string]> = [
  ['XV', 'Arica y Parinacota'],
  ['I', 'Tarapacá'],
  ['II', 'Antofagasta'],
  ['III', 'Atacama'],
  ['IV', 'Coquimbo'],
  ['V', 'Valparaíso'],
  ['XIII', 'Metropolitana'],
  ['VI', "O'Higgins"],
  ['VII', 'Maule'],
  ['XVI', 'Ñuble'],
  ['VIII', 'Biobío'],
  ['IX', 'La Araucanía'],
  ['XIV', 'Los Ríos'],
  ['X', 'Los Lagos'],
  ['XI', 'Aysén'],
  ['XII', 'Magallanes'],
];

const base = { mes: z.string(), viajes: z.number(), vehiculos: z.number() };
const respuestaSchema = z.object({
  region: z.string(),
  k_min_vehiculos: z.number(),
  franjas: z.array(
    z.object({
      ...base,
      comuna: z.string(),
      tipo_dia: z.string(),
      franja: z.string(),
      clase_vehiculo: z.string(),
    }),
  ),
  emisiones: z.array(
    z.object({
      ...base,
      comuna: z.string(),
      clase_vehiculo: z.string(),
      kgco2e: z.number(),
      kgco2e_evitado: z.number(),
    }),
  ),
  od: z.array(
    z.object({
      ...base,
      origen_region: z.string(),
      origen_comuna: z.string(),
      destino_region: z.string(),
      destino_comuna: z.string(),
    }),
  ),
  activos: z.array(z.object({ ...base, comuna: z.string() })),
});

type Respuesta = z.infer<typeof respuestaSchema>;

const n = (v: number) => v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
const comuna = (c: string) => (c === 'sin_comuna' ? 'Sin comuna' : c);
const TIPO_DIA: Record<string, string> = { laboral: 'Laboral', fin_semana: 'Fin de semana' };
const CLASE: Record<string, string> = { liviano: 'Liviano', pesado: 'Pesado' };

export function PlatformAdminObservatorioRoute() {
  return (
    <ProtectedRoute meRequirement="skip">
      {() => (
        <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
          <Observatorio />
        </PlatformAdminFrame>
      )}
    </ProtectedRoute>
  );
}

function Observatorio() {
  const [region, setRegion] = useState('IV');
  const q = useQuery({
    queryKey: ['admin-observatorio', region],
    queryFn: async () => respuestaSchema.parse(await api.get(`/admin/observatorio/${region}`)),
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <>
      <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Observatorio urbano</h1>
      <p className="mt-2 max-w-2xl text-neutral-600 text-sm">
        Flujos, emisiones y orígenes-destinos de la carga entregada. Solo se muestran grupos con al
        menos 10 vehículos distintos; nunca vehículos ni viajes individuales.
      </p>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <span className="font-medium text-neutral-800">Región</span>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1"
        >
          {REGIONES.map(([codigo, nombre]) => (
            <option key={codigo} value={codigo}>
              {nombre}
            </option>
          ))}
        </select>
      </label>

      {q.isLoading && (
        <p className="mt-6 flex items-center gap-2 text-neutral-600 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando observatorio…
        </p>
      )}
      {q.error && (
        <p role="alert" className="mt-6 text-danger-700 text-sm">
          {q.error instanceof ApiError && q.error.status === 503
            ? 'El observatorio no está configurado en este entorno.'
            : 'No se pudo cargar el observatorio.'}
        </p>
      )}
      {q.data && <Secciones datos={q.data} />}
    </>
  );
}

function Seccion(props: {
  id: string;
  titulo: string;
  columnas: string[];
  filas: ReactNode[][];
}) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-lg text-neutral-900">{props.titulo}</h2>
      {props.filas.length === 0 ? (
        <p data-testid={`observatorio-${props.id}-vacio`} className="mt-2 text-neutral-600 text-sm">
          Sin datos suficientes (menos de 10 vehículos por grupo).
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-700">
              <tr>
                {props.columnas.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.filas.map((fila, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: filas agregadas sin id propio; el orden viene del API.
                <tr key={i} className="border-neutral-100 border-t">
                  {fila.map((celda, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas por sección.
                    <td key={j} className="px-3 py-1.5 text-neutral-800">
                      {celda}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Secciones({ datos }: { datos: Respuesta }) {
  return (
    <>
      <Seccion
        id="activos"
        titulo="Vehículos activos"
        columnas={['Mes', 'Comuna', 'Vehículos', 'Viajes']}
        filas={datos.activos.map((f) => [f.mes, comuna(f.comuna), n(f.vehiculos), n(f.viajes)])}
      />
      <Seccion
        id="franjas"
        titulo="Flujos por franja horaria"
        columnas={['Mes', 'Comuna', 'Día', 'Franja', 'Vehículo', 'Viajes', 'Vehículos']}
        filas={datos.franjas.map((f) => [
          f.mes,
          comuna(f.comuna),
          TIPO_DIA[f.tipo_dia] ?? f.tipo_dia,
          f.franja,
          CLASE[f.clase_vehiculo] ?? f.clase_vehiculo,
          n(f.viajes),
          n(f.vehiculos),
        ])}
      />
      <Seccion
        id="emisiones"
        titulo="Emisiones (kgCO2e)"
        columnas={['Mes', 'Comuna', 'Vehículo', 'Emitido', 'Evitado por matching', 'Viajes']}
        filas={datos.emisiones.map((f) => [
          f.mes,
          comuna(f.comuna),
          CLASE[f.clase_vehiculo] ?? f.clase_vehiculo,
          n(f.kgco2e),
          n(f.kgco2e_evitado),
          n(f.viajes),
        ])}
      />
      <Seccion
        id="od"
        titulo="Origen-destino"
        columnas={['Mes', 'Origen', 'Destino', 'Viajes', 'Vehículos']}
        filas={datos.od.map((f) => [
          f.mes,
          `${f.origen_region} · ${comuna(f.origen_comuna)}`,
          `${f.destino_region} · ${comuna(f.destino_comuna)}`,
          n(f.viajes),
          n(f.vehiculos),
        ])}
      />
    </>
  );
}
