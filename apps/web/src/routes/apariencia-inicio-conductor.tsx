import { TripHeroCard } from '../components/inicio/trip-hero-card.js';

/**
 * Preview público del inicio del conductor. No llama al API y no afirma
 * que el micrófono o el GPS estén prendidos.
 */
export function AparienciaInicioConductorRoute() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-neutral-50 px-4 py-6">
      <p className="text-neutral-500 text-sm">Transportes Van Oosterwyk · KXJR-42</p>
      <h1 className="mt-1 font-bold text-2xl text-neutral-900">Buenas tardes, Juan</h1>
      <div className="mt-4">
        <TripHeroCard
          cuando="Tu próximo viaje · Hoy 16:30"
          ruta="Quilicura → San Antonio"
          retiro={{
            lugar: 'Av. Lo Echevers 550',
            detalle: 'Ventana 16:30–17:30 · Carga seca 12 t',
          }}
          entrega={{ lugar: 'Puerto San Antonio', detalle: 'Ventana 19:00–20:00' }}
        >
          <button
            type="button"
            className="inline-flex w-full items-center justify-center rounded-md bg-white px-3 py-2.5 font-semibold text-primary-800 text-sm"
          >
            Iniciar viaje
          </button>
        </TripHeroCard>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-neutral-200 bg-white px-2 py-3 text-center font-medium text-xs">
          Cómo llegar
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-2 py-3 text-center font-medium text-xs">
          Documentos
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-2 py-3 text-center font-medium text-xs">
          Incidente
        </div>
      </div>
      <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-3">
        <p className="font-semibold text-neutral-900 text-sm">Di «Oye Booster»</p>
        <p className="mt-0.5 text-neutral-600 text-sm">Maneja con la voz, sin mirar el teléfono.</p>
      </section>
      <h2 className="mt-6 font-semibold text-neutral-500 text-xs uppercase tracking-wider">
        Después
      </h2>
      <p className="mt-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
        <span className="font-semibold">08:00</span> Lampa → Rancagua
      </p>
      <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-sm">
        <span className="h-2 w-2 rounded-full bg-success-500" aria-hidden />
        GPS activo
      </p>
    </main>
  );
}
