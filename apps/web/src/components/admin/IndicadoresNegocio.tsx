import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '../../lib/api-client.js';
import { formatoEmisiones } from '../../lib/formato-emisiones.js';

/**
 * Indicadores del negocio en el Inicio del panel
 * (`.specs/una-sola-verdad-por-dato`). Lee `GET /admin/plataforma/indicadores`:
 * cada cifra sale del mismo cálculo que la pantalla de la empresa que la
 * muestra (Flota, Cumplimiento, Certificados). Se puede ver la plataforma
 * completa o una empresa.
 */
const respuestaSchema = z.object({
  empresa_id: z.string().nullable(),
  empresas: z.array(z.object({ id: z.string(), nombre: z.string() })),
  indicadores: z.object({
    empresas_activas: z.number().nullable(),
    cargas: z.number(),
    camiones: z.number(),
    camiones_con_huella_medida: z.number(),
    certificados: z.object({
      certificados: z.number(),
      medidos: z.number(),
      estimados: z.number(),
      kgco2e: z.number(),
      ahorro_kgco2e: z.number(),
    }),
    documentos_pendientes: z.number(),
  }),
});

type Respuesta = z.infer<typeof respuestaSchema>;

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; datos: Respuesta };

const PLATAFORMA = '';

export function IndicadoresNegocio() {
  const [empresaId, setEmpresaId] = useState(PLATAFORMA);
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [empresas, setEmpresas] = useState<Respuesta['empresas']>([]);

  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    const ruta = empresaId
      ? `/admin/plataforma/indicadores?empresa_id=${encodeURIComponent(empresaId)}`
      : '/admin/plataforma/indicadores';
    api
      .get<unknown>(ruta)
      .then((crudo) => {
        const leido = respuestaSchema.safeParse(crudo);
        if (!vigente) {
          return;
        }
        if (!leido.success) {
          setEstado({ tipo: 'error', mensaje: 'La respuesta de los indicadores no es válida.' });
          return;
        }
        setEmpresas(leido.data.empresas);
        setEstado({ tipo: 'listo', datos: leido.data });
      })
      .catch((err: unknown) => {
        if (vigente) {
          setEstado({
            tipo: 'error',
            mensaje: err instanceof Error ? err.message : 'No se pudieron leer los indicadores.',
          });
        }
      });
    return () => {
      vigente = false;
    };
  }, [empresaId]);

  return (
    <section
      aria-labelledby="indicadores-titulo"
      className="mt-6"
      data-testid="indicadores-negocio"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="indicadores-titulo" className="font-semibold text-lg text-neutral-900">
          Indicadores del negocio
        </h2>
        <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          <span className="font-medium text-neutral-800">Empresa</span>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="w-full min-w-0 max-w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm sm:w-72"
            data-testid="indicadores-empresa"
          >
            <option value={PLATAFORMA}>Toda la plataforma</option>
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>
                {empresa.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {estado.tipo === 'cargando' ? (
        <p className="mt-3 inline-flex items-center gap-2 text-neutral-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando indicadores…
        </p>
      ) : null}
      {estado.tipo === 'error' ? (
        <p role="alert" className="mt-3 text-danger-700 text-sm">
          {estado.mensaje}
        </p>
      ) : null}
      {estado.tipo === 'listo' ? <Cifras datos={estado.datos} /> : null}
    </section>
  );
}

function Cifras({ datos }: { datos: Respuesta }) {
  const { indicadores } = datos;
  const { certificados } = indicadores;
  return (
    <dl
      className="mt-3 grid divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4"
      data-testid={`indicadores-de-${datos.empresa_id ?? 'plataforma'}`}
    >
      {indicadores.empresas_activas !== null ? (
        <Cifra
          etiqueta="Empresas activas"
          valor={String(indicadores.empresas_activas)}
          id="empresas-activas"
        />
      ) : null}
      <Cifra etiqueta="Cargas" valor={String(indicadores.cargas)} id="cargas" />
      <Cifra
        etiqueta="Camiones"
        valor={String(indicadores.camiones)}
        nota={`${indicadores.camiones_con_huella_medida} con huella medida`}
        id="camiones"
      />
      <Cifra
        etiqueta="Documentos pendientes"
        valor={String(indicadores.documentos_pendientes)}
        id="documentos-pendientes"
      />
      <Cifra
        etiqueta="Certificados"
        valor={String(certificados.certificados)}
        nota={`${certificados.medidos} medidos · ${certificados.estimados} estimados`}
        id="certificados"
      />
      <Cifra
        etiqueta="Emisiones certificadas"
        valor={formatoEmisiones(certificados.kgco2e)}
        id="emisiones"
      />
    </dl>
  );
}

function Cifra({
  etiqueta,
  valor,
  nota,
  id,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  id: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="font-medium text-neutral-600 text-xs">{etiqueta}</dt>
      <dd className="mt-1">
        <span
          className="font-semibold text-2xl text-neutral-900 tabular-nums"
          data-testid={`indicador-${id}`}
        >
          {valor}
        </span>
        {nota ? (
          <span
            className="mt-1 block text-neutral-500 text-xs"
            data-testid={`indicador-${id}-nota`}
          >
            {nota}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
