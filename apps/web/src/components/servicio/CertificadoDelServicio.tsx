import { Button } from '@booster-ai/ui-components';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Mail } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../lib/api-client.js';
import { campoPorPresentacion } from '../../lib/presentacion-huella.js';
import {
  descargarCertificadoDeAsignacion,
  enviarCertificadoAlCliente,
  getResultadoAsignacion,
} from '../../services/assignment-resultado.js';
import { CifraHuella, TotalHuella } from '../huella/CifraHuella.js';
import { TablaMedicion } from '../huella/TablaMedicion.js';

/**
 * El servicio entregado visto por la transportista (`.specs/frente2-cierre`
 * §3.3): la huella con su sello, lo que se midió y el certificado. En un
 * viaje propio, «Viaje propio entregado y certificado», con «Enviar al
 * cliente» cuando hay correo y la huella del mes para ese cliente.
 */
export function CertificadoDelServicio({ assignmentId }: { assignmentId: string }) {
  const q = useQuery({
    queryKey: ['assignments', assignmentId, 'resultado'],
    queryFn: () => getResultadoAsignacion(assignmentId),
  });
  const [descargaError, setDescargaError] = useState<string | null>(null);
  const envio = useMutation({ mutationFn: () => enviarCertificadoAlCliente(assignmentId) });

  if (q.isError) {
    return (
      <p role="alert" className="text-danger-700 text-sm">
        No se pudo leer el resultado del viaje.
      </p>
    );
  }
  if (!q.data) {
    return <p className="text-neutral-500 text-sm">Cargando el resultado del viaje…</p>;
  }
  const r = q.data;
  const m = r.metrics;
  const propio = r.viaje_propio ?? null;
  const kg = m?.carbon_emissions_kgco2e_actual ?? m?.carbon_emissions_kgco2e_estimated ?? null;

  return (
    <section
      aria-labelledby="certificado-servicio-titulo"
      data-testid="certificado-servicio"
      className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
    >
      <h2 id="certificado-servicio-titulo" className="font-semibold text-base text-neutral-900">
        {propio ? 'Viaje propio entregado y certificado' : 'Viaje entregado y certificado'}
      </h2>
      {propio?.cliente_nombre ? (
        <p className="mt-1 text-neutral-600 text-sm">Cliente: {propio.cliente_nombre}</p>
      ) : null}

      {m ? (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="font-medium text-neutral-500 text-xs">Huella del viaje</p>
            <CifraHuella
              valor={kg}
              presentacion={m.presentacion ?? 'estimado'}
              disposicion="apilada"
              className="mt-1 font-semibold text-lg text-neutral-900"
              data-testid="certificado-servicio-huella"
            />
          </div>
          {m.medicion ? <TablaMedicion medicion={m.medicion} /> : null}
        </div>
      ) : (
        <p className="mt-3 text-neutral-600 text-sm">La huella se está calculando.</p>
      )}

      {r.certificate ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={async () => {
              setDescargaError(null);
              try {
                await descargarCertificadoDeAsignacion(assignmentId);
              } catch (err) {
                setDescargaError(err instanceof Error ? err.message : 'No se pudo descargar.');
              }
            }}
          >
            <Download className="h-4 w-4" aria-hidden />
            Descargar certificado
          </Button>
          {propio?.cliente_correo ? (
            <Button
              variant="primary"
              type="button"
              onClick={() => envio.mutate()}
              disabled={envio.isPending || envio.isSuccess}
              data-testid="enviar-al-cliente"
            >
              <Mail className="h-4 w-4" aria-hidden />
              {envio.isPending ? 'Enviando…' : 'Enviar al cliente'}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-neutral-600 text-sm">Certificado en proceso.</p>
      )}
      {descargaError ? (
        <p role="alert" className="mt-2 text-danger-700 text-sm">
          {descargaError}
        </p>
      ) : null}
      {envio.isSuccess ? (
        <output className="mt-2 block text-neutral-700 text-sm" data-testid="enviado-al-cliente">
          Enviado a {envio.data.correo}.
        </output>
      ) : null}
      {envio.isError ? (
        <p role="alert" className="mt-2 text-danger-700 text-sm">
          {envio.error instanceof ApiError && envio.error.code === 'sin_correo_cliente'
            ? 'El cliente no tiene correo registrado.'
            : 'No se pudo enviar el certificado. Intenta de nuevo en unos minutos.'}
        </p>
      ) : null}

      {propio ? (
        <div className="mt-4 border-neutral-100 border-t pt-3">
          <p className="font-medium text-neutral-500 text-xs">
            Huella del mes para {propio.cliente_nombre ?? 'este cliente'}
          </p>
          <TotalHuella
            porPresentacion={campoPorPresentacion(
              propio.total_mes_cliente.por_presentacion,
              'kgco2e',
            )}
            vacio="Sin viajes certificados este mes"
            className="mt-1 font-semibold text-base text-neutral-900"
            data-testid="huella-mes-cliente"
          />
        </div>
      ) : null}
    </section>
  );
}
