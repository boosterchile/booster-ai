/**
 * Resultado del viaje en la tarjeta del conductor, tras confirmar la entrega
 * (Slot 3, paso 4 — decisión D3: solo lectura). Muestra kg CO2e, distancia,
 * cobertura, nivel de certificación y la línea de método de ADR-077, y deja
 * descargar el certificado cuando existe. La emisión del PDF es asíncrona
 * (fire-and-forget tras la entrega): mientras no exista se reconsulta cada
 * 3 s durante un minuto y se dice «Certificado en proceso».
 */
import { Download, Leaf, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type ResultadoAsignacion,
  descargarCertificadoDeAsignacion,
  getResultadoAsignacion,
} from '../../services/assignment-resultado.js';

const REINTENTO_MS = 3_000;
const MAX_REINTENTOS = 20;

const NIVEL_EN_PALABRAS: Record<string, string> = {
  primario_verificable: 'Primario verificable',
  secundario_modeled: 'Secundario modelado',
  secundario_default: 'Secundario por defecto',
};

function numero(valor: string | null, decimales: number): string | null {
  if (valor == null) {
    return null;
  }
  const n = Number.parseFloat(valor);
  return Number.isFinite(n)
    ? n.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: decimales })
    : null;
}

export function ResultadoViaje({ assignmentId }: { assignmentId: string }) {
  const [resultado, setResultado] = useState<ResultadoAsignacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descargaError, setDescargaError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let intentos = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const consultar = async () => {
      try {
        const r = await getResultadoAsignacion(assignmentId);
        if (cancelado) {
          return;
        }
        setResultado(r);
        setError(null);
        intentos += 1;
        if (!r.certificate && intentos < MAX_REINTENTOS) {
          timer = setTimeout(() => void consultar(), REINTENTO_MS);
        }
      } catch {
        if (!cancelado) {
          setError('No pudimos cargar el resultado. Tu empresa lo verá en Servicios.');
        }
      }
    };
    void consultar();
    return () => {
      cancelado = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [assignmentId]);

  async function descargar() {
    setDescargaError(null);
    setDescargando(true);
    try {
      await descargarCertificadoDeAsignacion(assignmentId);
    } catch (err) {
      setDescargaError(
        err instanceof Error && err.name === 'CertNotIssuedError'
          ? 'El certificado todavía se está emitiendo. Intenta en unos segundos.'
          : 'No pudimos abrir el certificado. Intenta de nuevo.',
      );
    } finally {
      setDescargando(false);
    }
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="resultado-viaje"
        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm"
      >
        {error}
      </div>
    );
  }
  if (!resultado) {
    return (
      <div
        data-testid="resultado-viaje"
        className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-600 text-sm"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Calculando la huella del viaje…
      </div>
    );
  }

  const m = resultado.metrics;
  const medida = m?.carbon_emissions_kgco2e_actual != null;
  const kg = numero(
    medida ? m.carbon_emissions_kgco2e_actual : (m?.carbon_emissions_kgco2e_estimated ?? null),
    2,
  );
  const km = numero(m?.distance_km_actual ?? m?.distance_km_estimated ?? null, 1);
  const cobertura = numero(m?.coverage_pct ?? null, 0);
  const nivel = m?.certification_level ? NIVEL_EN_PALABRAS[m.certification_level] : null;

  return (
    <section
      data-testid="resultado-viaje"
      aria-label="Resultado del viaje"
      className="rounded-md border border-success-200 bg-success-50 p-3 text-sm"
    >
      <div className="flex items-center gap-2 font-semibold text-success-800">
        <Leaf className="h-4 w-4" aria-hidden />
        Resultado del viaje {resultado.trip.tracking_code}
      </div>
      {m ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-neutral-800">
          <div className="col-span-2">
            <dt className="text-neutral-500 text-xs">
              {medida ? 'Huella medida' : 'Huella estimada (cobertura insuficiente para medir)'}
            </dt>
            <dd className="font-semibold text-lg">{kg != null ? `${kg} kg CO2e` : 'Sin dato'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 text-xs">
              {m.distance_km_actual != null ? 'Distancia medida' : 'Distancia estimada'}
            </dt>
            <dd className="font-medium">{km != null ? `${km} km` : 'Sin dato'}</dd>
          </div>
          <div>
            <dt className="text-neutral-500 text-xs">Cobertura de posición</dt>
            <dd className="font-medium">{cobertura != null ? `${cobertura} %` : 'Sin dato'}</dd>
          </div>
          {nivel && (
            <div className="col-span-2">
              <dt className="text-neutral-500 text-xs">Nivel de certificación</dt>
              <dd className="font-medium">{nivel}</dd>
            </div>
          )}
          {m.linea_metodo && (
            <div className="col-span-2">
              <dt className="text-neutral-500 text-xs">Método</dt>
              <dd className="text-neutral-700">{m.linea_metodo}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="mt-2 text-neutral-700">La huella se está calculando.</p>
      )}
      <div className="mt-3">
        {resultado.certificate ? (
          <button
            type="button"
            onClick={() => void descargar()}
            disabled={descargando}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-success-300 bg-white px-4 py-3 font-medium text-base text-success-800 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {descargando ? 'Abriendo…' : 'Descargar certificado'}
          </button>
        ) : (
          <output className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Certificado en proceso. Tu empresa lo recibe en Servicios.
          </output>
        )}
        {descargaError && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-700 text-xs"
          >
            {descargaError}
          </div>
        )}
      </div>
    </section>
  );
}
