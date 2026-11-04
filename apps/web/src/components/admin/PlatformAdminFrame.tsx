import { Link } from '@tanstack/react-router';
import { ArrowLeft, LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { signOutUser } from '../../hooks/use-auth.js';

/**
 * Marco del platform-admin. Cada pantalla, incluida la primera, ofrece un
 * regreso explícito: el índice vuelve al login y el resto vuelve al índice.
 */
export function PlatformAdminFrame({
  volver,
  children,
}: {
  volver: { to: '/login' | '/app/platform-admin'; label: string };
  children: ReactNode;
}) {
  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white pt-safe">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-primary-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-semibold text-neutral-900">Booster · Platform Admin</div>
              <div className="text-neutral-500 text-xs">Operaciones internas de plataforma</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={volver.to}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-neutral-700 text-sm transition hover:bg-neutral-100"
              data-testid="platform-admin-volver"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {volver.label}
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
