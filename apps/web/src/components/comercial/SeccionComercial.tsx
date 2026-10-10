import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api-client.js';

/**
 * ADR-079 §1 — lo que el generador ve antes de publicar: el precio del
 * transportista, la comisión de Booster (porcentaje y monto), el IVA de la
 * comisión y el total a pagar. Solo pantallas de generador (§5: nunca
 * transportista ni conductor). Con el modelo v3 apagado el endpoint de
 * cotización responde 404 y esta sección no se muestra.
 */
const desgloseSchema = z.object({
  modalidad_carga: z.enum(['spot', 'programada']),
  precio_transportista_clp: z.number(),
  comision_pct: z.number(),
  comision_clp: z.number(),
  iva_comision_clp: z.number(),
  precio_generador_clp: z.number(),
  total_factura_generador_clp: z.number(),
});

const cotizacionSchema = z.object({
  configuracion_version: z.number(),
  programada_disponible: z.boolean(),
  desglose: desgloseSchema,
});

export type DesgloseGeneradorDto = z.infer<typeof desgloseSchema>;
export type ModalidadCarga = DesgloseGeneradorDto['modalidad_carga'];

const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;

export function DesgloseGenerador({ desglose }: { desglose: DesgloseGeneradorDto }) {
  const filas: Array<[string, string]> = [
    ['Precio del transportista', clp(desglose.precio_transportista_clp)],
    [`Comisión Booster (${desglose.comision_pct} %)`, clp(desglose.comision_clp)],
    ['IVA de la comisión', clp(desglose.iva_comision_clp)],
    ['Total a pagar', clp(desglose.precio_generador_clp + desglose.iva_comision_clp)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="desglose-generador">
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="contents">
          <dt className="text-neutral-600">{etiqueta}</dt>
          <dd className="text-right font-medium text-neutral-900">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SeccionComercial({
  precioClp,
  modalidad,
  onModalidad,
}: {
  precioClp: number | null;
  modalidad: ModalidadCarga;
  onModalidad: (m: ModalidadCarga) => void;
}) {
  const precio =
    precioClp !== null && Number.isInteger(precioClp) && precioClp >= 0 ? precioClp : 0;
  const cotizacionQ = useQuery({
    queryKey: ['cotizacion-comercial', precio, modalidad],
    queryFn: async () =>
      cotizacionSchema.parse(
        await api.get(
          `/trip-requests-v2/cotizacion?precio_transportista_clp=${precio}&modalidad_carga=${modalidad}`,
        ),
      ),
    retry: false,
    staleTime: 30_000,
  });

  // v3 apagado (404), error o respuesta fuera de contrato: sin sección.
  if (!cotizacionQ.data) {
    return null;
  }
  const { programada_disponible, desglose } = cotizacionQ.data;

  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h2 className="font-semibold text-lg text-neutral-900">Costo del servicio</h2>
      {programada_disponible && (
        <fieldset className="mt-3 flex gap-4 text-sm">
          <legend className="sr-only">Modalidad de la carga</legend>
          {(
            [
              ['spot', 'Carga spot'],
              ['programada', 'Carga programada'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <label key={valor} className="flex items-center gap-2">
              <input
                type="radio"
                name="modalidad_carga"
                checked={modalidad === valor}
                onChange={() => onModalidad(valor)}
              />
              {etiqueta}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-3">
        {precioClp === null ? (
          <p className="text-neutral-600 text-sm">
            Ingresa el precio del transportista para ver la comisión y el total a pagar.
          </p>
        ) : (
          <DesgloseGenerador desglose={desglose} />
        )}
      </div>
      <p className="mt-2 text-neutral-500 text-xs">
        La comisión queda fija al publicar. El transportista ve solo su precio.
      </p>
    </section>
  );
}
