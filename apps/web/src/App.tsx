import { type ReactElement, useState } from 'react';

/**
 * Placeholder App. El thin slice de Fase 6 reemplaza con TanStack Router
 * + Firebase Auth + RoleGuard + layouts por rol.
 */
export function App(): ReactElement {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="bg-teal-600 px-6 py-4 text-white">
        <h1 className="font-semibold text-2xl">Booster AI</h1>
        <p className="text-sm text-teal-100">Plataforma de logística sostenible</p>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <section>
          <h2 className="mb-2 font-semibold text-xl">Skeleton activo</h2>
          <p className="text-neutral-700">
            Esta es la vista placeholder del monorepo. La implementación real vendrá en la Fase 6
            con routing multi-rol (shipper, carrier, driver, admin, stakeholder).
          </p>
        </section>
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setCount((c) => c + 1)}
            className="rounded-md bg-teal-600 px-4 py-2 text-white transition hover:bg-teal-700"
          >
            Clicks: {count}
          </button>
        </section>
      </main>
    </div>
  );
}
