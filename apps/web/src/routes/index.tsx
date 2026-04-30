import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/use-auth.js';

/**
 * `/` — landing redirect.
 *
 *   - User no logueado → /login
 *   - User logueado    → /app
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

  return <Navigate to={user ? '/app' : '/login'} />;
}
