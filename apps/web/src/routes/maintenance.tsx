import { ExternalLink, Wrench } from 'lucide-react';
import { useSiteSettings } from '../hooks/use-site-settings.js';

/**
 * /maintenance — Página de mantenimiento del subdominio
 * demo.boosterchile.com. Renderizada por `DemoRoute` cuando el flag
 * `demo_mode_activated` está en false (período de construcción
 * documentado en spec sec-001-cierre SC-INT-1).
 *
 * Sin fetches ni state — componente puramente presentacional. La
 * decisión de mostrarla vive en el caller (demo.tsx) para que el flag
 * gobierne el toggle, no dos llamadas independientes al backend.
 */
export function MaintenanceRoute() {
  const { config } = useSiteSettings();

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <img
            src={config.identity.logo_url ?? '/icons/icon.svg'}
            alt={config.identity.logo_alt}
            className="h-9 w-9"
          />
          <span className="font-semibold text-base text-neutral-900 tracking-tight">
            {config.identity.logo_alt}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700">
          <Wrench className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="mt-6 font-bold text-3xl text-neutral-900 tracking-tight sm:text-4xl">
          Modo demo en mantenimiento
        </h1>
        <p className="mt-4 text-lg text-neutral-700 leading-relaxed">Volvemos pronto.</p>
        <p className="mt-2 max-w-md text-neutral-500 text-sm leading-relaxed">
          Estamos reconstruyendo el entorno demo para que muestre la versión actual del producto. Si
          necesitas usar Booster en producción, continúa abajo.
        </p>

        <a
          href="https://app.boosterchile.com"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 font-semibold text-sm text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
        >
          Ir a app.boosterchile.com
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </main>

      <footer className="border-neutral-200 border-t py-6 text-center text-neutral-500 text-xs">
        <p>
          Booster AI ·{' '}
          <a href="https://boosterchile.com" className="underline hover:text-neutral-700">
            boosterchile.com
          </a>
        </p>
      </footer>
    </div>
  );
}
