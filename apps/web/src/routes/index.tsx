import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/use-auth.js';

/**
 * `/` — landing redirect.
 *
 *   - Host `demo.boosterchile.com` + no logueado → /demo (selector personas)
 *   - Host `demo.boosterchile.com` + logueado    → /app (con DemoBanner)
 *   - Otros hosts no logueado                    → /login
 *   - Otros hosts logueado                       → /app
 *
 * Mientras useAuth().loading=true mostramos splash mínimo.
 */
export function IndexRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="font-medium text-neutral-500 text-sm">Cargando…</div>
      </div>
    );
  }

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isDemoHost = host === 'demo.boosterchile.com' || host === 'demo.localhost';

  if (isDemoHost && !user) {
    return <Navigate to="/demo" />;
  }

  return <Navigate to={user ? '/app' : '/login'} />;
}
