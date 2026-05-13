import { useNavigate } from '@tanstack/react-router';
import { signOutUser } from '../hooks/use-auth.js';
import { useIsDemo } from '../hooks/use-is-demo.js';

/**
 * Banner persistente "MODO DEMO" que se muestra cuando el user actual
 * tiene el custom claim `is_demo: true` (custom token minteado por
 * `POST /demo/login`).
 *
 * Renderiza nada si el user no es demo — el componente se monta global
 * en `__root` y se self-gatea.
 */
export function DemoBanner() {
  const isDemo = useIsDemo();
  const navigate = useNavigate();

  if (isDemo !== true) {
    return null;
  }

  async function handleExit() {
    await signOutUser();
    void navigate({ to: '/demo' });
  }

  return (
    <div
      data-testid="demo-banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-4 border-amber-300 border-b bg-amber-100 px-4 py-2 text-amber-900 text-sm"
    >
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden>
          🎭
        </span>
        <span className="font-medium">
          MODO DEMO — Estás operando con datos sintéticos en{' '}
          <span className="font-semibold">demo.boosterchile.com</span>. Esta sesión NO afecta
          producción.
        </span>
      </div>
      <button
        type="button"
        onClick={handleExit}
        className="rounded border border-amber-400 bg-white px-3 py-1 font-medium text-amber-900 text-xs hover:bg-amber-50"
      >
        Salir del demo
      </button>
    </div>
  );
}
