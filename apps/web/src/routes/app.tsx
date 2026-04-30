import { Navigate } from '@tanstack/react-router';
import { LogOut, User as UserIcon } from 'lucide-react';
import { signOutUser, useAuth } from '../hooks/use-auth.js';
import { useMe } from '../hooks/use-me.js';

/**
 * /app — dashboard post-login.
 *
 * Slice B.3.b: layout mínimo con header + main column placeholder. Las
 * vistas reales (lista de ofertas para carrier, lista de cargas para
 * shipper, dashboard admin) se construyen en B.5+.
 *
 * Routing protection: si no hay user → /login. Si user pero
 * needs_onboarding → /onboarding.
 */
export function AppRoute() {
  const { user, loading: authLoading } = useAuth();
  const { data: me, isLoading: meLoading, error: meError } = useMe({ enabled: !!user });

  if (authLoading || meLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="font-medium text-neutral-500 text-sm">Cargando…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (meError || !me || me.needs_onboarding) {
    return <Navigate to="/onboarding" />;
  }

  const activeEmpresa = me.active_membership?.empresa;

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
            <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
            {activeEmpresa && (
              <span className="ml-3 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                {activeEmpresa.legal_name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-md px-2 py-1 text-neutral-700 text-sm">
              <UserIcon className="h-4 w-4" aria-hidden />
              <span>{me.user.full_name}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Bienvenido a Booster
          </h1>

          {activeEmpresa ? (
            <p className="mt-2 text-neutral-600">
              Empresa activa: <span className="font-medium">{activeEmpresa.legal_name}</span>
              {activeEmpresa.is_carrier && ' · Carrier'}
              {activeEmpresa.is_shipper && ' · Shipper'}
            </p>
          ) : (
            <p className="mt-2 text-neutral-600">Sin empresa activa.</p>
          )}

          <section className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-neutral-900 text-xl">Dashboard en construcción</h2>
            <p className="mt-2 text-neutral-700 text-sm">
              Las vistas reales (ofertas activas para carrier, lista de cargas para shipper, panel
              admin) se entregan en los próximos slices del pre-launch (B.5+).
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
