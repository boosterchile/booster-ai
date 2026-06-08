import Link from 'next/link';

/**
 * Home stub (T1). El home definitivo —Hero + segmentos por rol— se construye
 * en T7 (contenido de conversión), apoyado en los primitivos de T6. Este stub
 * existe para que el scaffold compile, despliegue y pase coverage de forma
 * atómica, sin acoplar T1 a tareas posteriores.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <h1 className="font-bold text-3xl text-neutral-900">Booster AI</h1>
      <p className="mt-4 text-neutral-600">
        Marketplace B2B de logística sostenible. Conectamos generadores de carga con transportistas
        y certificamos la huella de carbono de cada viaje.
      </p>
      <Link
        href="/signup"
        className="mt-8 inline-block rounded-lg bg-primary-600 px-5 py-3 font-semibold text-sm text-white transition hover:bg-primary-700"
      >
        Solicitar acceso
      </Link>
    </main>
  );
}
