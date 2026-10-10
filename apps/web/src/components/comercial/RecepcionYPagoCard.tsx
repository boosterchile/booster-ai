import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldAlert, Wallet } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { ApiError, api } from '../../lib/api-client.js';

/**
 * ADR-080 — recepción y pago de una carga, vista del generador.
 *
 * - **Confirmar recepción**: el generador marca la carga como recibida
 *   (`PATCH /trip-requests-v2/:id/confirmar-recepcion`). Antes ninguna pantalla
 *   llamaba a este endpoint (precondición 5 de ADR-080 §6).
 * - **Pago** (solo bajo mandato de cobro): lo que el generador paga a Booster
 *   y cuándo vence, y si el transportista ya recibió su pago.
 * - **Objetar recepción**: abre una disputa que congela la liberación al
 *   transportista mientras Booster la revisa.
 *
 * Sin mandato de cobro (flag apagado o liquidación conector) el endpoint de
 * pago responde 404 y la tarjeta solo muestra la confirmación de recepción.
 */

const lineaSchema = z.object({
  estado: z.string(),
  en: z.string().nullable(),
  monto_clp: z.number().nullable(),
  vence_en: z.string().nullable(),
});
const pagoSchema = z.object({
  modo_flujo: z.enum(['conector', 'mandato_cobro']),
  recepcion_conforme_en: z.string().nullable(),
  cobro: lineaSchema,
  liberacion: lineaSchema,
  montos_esperados: z.object({ cobro_clp: z.number(), liberacion_clp: z.number() }),
});
export type PagoGenerador = z.infer<typeof pagoSchema>;

const ESTADO_COBRO: Record<string, string> = {
  sin_recepcion: 'Se activa al confirmar la recepción',
  pendiente: 'Pendiente de pago',
  mora: 'Vencido',
  cobrado: 'Pagado',
};
const ESTADO_LIBERACION: Record<string, string> = {
  sin_recepcion: 'Se activa al confirmar la recepción',
  pendiente: 'Pendiente',
  disputa: 'En revisión por tu objeción',
  liberado_por_booster: 'Pagado al transportista',
  anticipado_por_operador: 'Pagado al transportista (pronto pago)',
};

const MENSAJE_ERROR: Record<string, string> = {
  documento_requerido:
    'Para confirmar la recepción, sube primero el documento del viaje (guía de despacho o factura).',
  sin_documento:
    'Sube el documento del viaje (guía de despacho o factura) para registrar la recepción conforme.',
  liberacion_no_pendiente: 'El transportista ya recibió su pago; la objeción sigue por contrato.',
  liberacion_en_disputa: 'Ya hay una objeción abierta para esta carga.',
};

const clp = (n: number) =>
  n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fecha = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

function mensajeDe(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.code ?? err.message;
    return MENSAJE_ERROR[code] ?? 'No pudimos completar la acción. Inténtalo de nuevo.';
  }
  return 'No pudimos completar la acción. Inténtalo de nuevo.';
}

const CONFIRMABLES = new Set(['asignado', 'en_proceso']);

export function RecepcionYPagoCard({ tripId, status }: { tripId: string; status: string }) {
  const queryClient = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const [objetando, setObjetando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const pagoQ = useQuery({
    queryKey: ['cargas', tripId, 'pago'],
    queryFn: async (): Promise<PagoGenerador | null> => {
      try {
        const r = await api.get<unknown>(`/trip-requests-v2/${tripId}/pago`);
        return pagoSchema.parse(z.object({ pago: z.unknown() }).parse(r).pago);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
    // La liquidación (y su pago) existe recién después de la entrega.
    enabled: status === 'entregado',
    retry: false,
  });
  const pago = pagoQ.data ?? null;

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['cargas'] });
  };

  const confirmarM = useMutation({
    mutationFn: async () =>
      api.patch<{ recepcion_conforme_pendiente?: string }>(
        `/trip-requests-v2/${tripId}/confirmar-recepcion`,
      ),
    onSuccess: (r) => {
      setAviso(
        r.recepcion_conforme_pendiente
          ? (MENSAJE_ERROR[r.recepcion_conforme_pendiente] ?? null)
          : 'Recepción confirmada.',
      );
      refrescar();
    },
    onError: (err) => setAviso(mensajeDe(err)),
  });

  const disputaM = useMutation({
    mutationFn: async () =>
      api.post(`/trip-requests-v2/${tripId}/disputa`, { motivo: motivo.trim() }),
    onSuccess: () => {
      setObjetando(false);
      setMotivo('');
      setAviso('Registramos tu objeción. Booster la revisará antes de pagar al transportista.');
      refrescar();
    },
    onError: (err) => setAviso(mensajeDe(err)),
  });

  const puedeConfirmar =
    CONFIRMABLES.has(status) ||
    (status === 'entregado' && pago !== null && !pago.recepcion_conforme_en);
  const puedeObjetar = pago?.liberacion.estado === 'pendiente';

  if (!puedeConfirmar && !pago) {
    return null;
  }

  return (
    <section
      aria-label="Recepción y pago"
      className="rounded-lg border border-neutral-200 bg-white p-5"
      data-testid="recepcion-pago-card"
    >
      <h2 className="flex items-center gap-2 font-semibold text-neutral-900">
        <Wallet className="h-5 w-5 text-primary-700" aria-hidden />
        Recepción y pago
      </h2>

      {puedeConfirmar && (
        <div className="mt-3">
          <p className="text-neutral-700 text-sm">
            Cuando la carga llegue a destino, confirma que la recibiste. Si hay guía o factura del
            viaje, súbela antes en «Documentos».
          </p>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
              confirmarM.mutate();
            }}
            disabled={confirmarM.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary-600 px-4 py-2 font-medium text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {confirmarM.isPending ? 'Confirmando…' : 'Confirmar recepción'}
          </button>
        </div>
      )}

      {pago && (
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-neutral-600">Tu pago a Booster</dt>
            <dd className="font-medium text-neutral-900">
              {clp(pago.montos_esperados.cobro_clp)} ·{' '}
              {ESTADO_COBRO[pago.cobro.estado] ?? pago.cobro.estado}
            </dd>
            {pago.cobro.vence_en && pago.cobro.estado !== 'cobrado' && (
              <dd className="text-neutral-600">Vence el {fecha(pago.cobro.vence_en)}</dd>
            )}
          </div>
          <div>
            <dt className="text-neutral-600">Pago al transportista</dt>
            <dd className="font-medium text-neutral-900">
              {ESTADO_LIBERACION[pago.liberacion.estado] ?? pago.liberacion.estado}
            </dd>
          </div>
        </dl>
      )}

      {puedeObjetar && !objetando && (
        <button
          type="button"
          onClick={() => setObjetando(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-danger-300 px-3 py-1.5 text-danger-700 text-sm hover:bg-danger-50"
        >
          <ShieldAlert className="h-4 w-4" aria-hidden />
          Objetar recepción
        </button>
      )}

      {objetando && (
        <div className="mt-4 rounded-md border border-danger-200 bg-danger-50 p-3">
          <label htmlFor="motivo-objecion" className="block font-medium text-danger-900 text-sm">
            ¿Qué problema tuvo la carga?
          </label>
          <textarea
            id="motivo-objecion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
            className="mt-1 w-full rounded-md border border-neutral-300 p-2 text-sm"
          />
          <p className="mt-1 text-danger-800 text-xs">
            Mientras se revisa, el pago al transportista queda detenido. Mínimo 10 caracteres.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setObjetando(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-700 text-sm hover:bg-neutral-100"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => {
                setAviso(null);
                disputaM.mutate();
              }}
              disabled={motivo.trim().length < 10 || disputaM.isPending}
              className="rounded-md bg-danger-600 px-3 py-1.5 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
            >
              {disputaM.isPending ? 'Enviando…' : 'Enviar objeción'}
            </button>
          </div>
        </div>
      )}

      {aviso && <output className="mt-3 block text-neutral-800 text-sm">{aviso}</output>}
    </section>
  );
}
