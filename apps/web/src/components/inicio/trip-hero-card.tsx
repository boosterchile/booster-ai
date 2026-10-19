import type { ReactNode } from 'react';

/**
 * Próximo tramo del conductor. Las ventanas salen del viaje; no hay ETA
 * en vivo ni puntaje.
 */
export function TripHeroCard({
  cuando,
  ruta,
  retiro,
  entrega,
  children,
}: {
  cuando: string;
  ruta: string;
  retiro: { lugar: string; detalle: string | null };
  entrega: { lugar: string; detalle: string | null };
  children?: ReactNode;
}) {
  return (
    <section data-testid="trip-hero" className="rounded-2xl bg-primary-800 p-4 text-white">
      <p className="font-semibold text-primary-100 text-xs uppercase tracking-wide">{cuando}</p>
      <h2 className="mt-1 font-bold text-2xl tracking-tight">{ruta}</h2>
      <ol className="mt-4 space-y-3">
        <li>
          <p className="font-semibold text-sm">Retiro · {retiro.lugar}</p>
          {retiro.detalle ? <p className="text-primary-100 text-sm">{retiro.detalle}</p> : null}
        </li>
        <li>
          <p className="font-semibold text-sm">Entrega · {entrega.lugar}</p>
          {entrega.detalle ? <p className="text-primary-100 text-sm">{entrega.detalle}</p> : null}
        </li>
      </ol>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
