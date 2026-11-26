import type { Medicion } from '../../lib/presentacion-huella.js';

/**
 * Qué se midió en el viaje (distancia, combustible, peso), cada fila con su
 * fuente y su clase, y el nivel de certificación con lo que le faltaría
 * (`.specs/frente2-cierre` §3.1). La clase se dice con palabra, no con color.
 */
const MAGNITUD: Record<Medicion['filas'][number]['magnitud'], string> = {
  distancia: 'Distancia',
  combustible: 'Combustible',
  peso: 'Peso',
};

const CLASE: Record<Medicion['filas'][number]['clase'], string> = {
  medido: 'Medido',
  modelado: 'Modelado',
  declarado: 'Declarado',
  estimado: 'Estimado',
  sin_dato: 'Sin dato',
};

export function TablaMedicion({
  medicion,
  'data-testid': testId,
}: {
  medicion: Medicion;
  'data-testid'?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Qué se midió en el viaje</caption>
        <thead className="text-neutral-500 text-xs">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              Dato
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Fuente
            </th>
            <th scope="col" className="py-1 font-medium">
              Clase
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {medicion.filas.map((f) => (
            <tr key={f.magnitud} data-clase={f.clase}>
              <th scope="row" className="py-1.5 pr-3 font-medium text-neutral-900">
                {MAGNITUD[f.magnitud]}
              </th>
              <td className="py-1.5 pr-3 text-neutral-700">{f.fuente}</td>
              <td className="py-1.5 font-medium text-neutral-900">{CLASE[f.clase]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-neutral-700 text-sm" data-testid={testId ? `${testId}-nivel` : undefined}>
        <span className="font-semibold text-neutral-900">Nivel: {medicion.nivel.nombre}.</span>{' '}
        {medicion.nivel.frase}
      </p>
    </div>
  );
}
