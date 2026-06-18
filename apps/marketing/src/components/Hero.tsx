import Link from 'next/link';

/** Hero de la home: propuesta de valor + CTAs a /signup y /precios. */
export function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 text-center">
      <h1 className="font-bold text-4xl text-neutral-900 tracking-tight sm:text-5xl">
        Logística sostenible para Chile
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-600">
        Conecta tu carga con transportistas, optimiza retornos vacíos y certifica tu huella de
        carbono bajo estándares GLEC y GHG Protocol.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          href="/signup"
          className="cursor-pointer rounded-md bg-primary-600 px-5 py-3 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
        >
          Solicitar acceso
        </Link>
        <Link
          href="/precios"
          className="cursor-pointer rounded-md border border-neutral-300 px-5 py-3 font-medium text-neutral-900 text-sm transition hover:bg-neutral-100"
        >
          Ver precios
        </Link>
      </div>
    </section>
  );
}
