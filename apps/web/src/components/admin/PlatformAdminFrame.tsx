import { Link } from '@tanstack/react-router';
import { ArrowLeft, Building2, LogOut, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { signOutUser } from '../../hooks/use-auth.js';
import { useMe } from '../../hooks/use-me.js';
import { elegirVistaEmpresa } from '../../lib/vista-admin.js';

/**
 * «Ir a mi empresa» para la persona de Booster que también es de una empresa
 * (acceso-usuarios-empresa-panel SC9). Solo con membresía activa a una
 * empresa; la elección queda en la pestaña y `/app` deja de redirigir al panel.
 */
function IrAMiEmpresa() {
  const { data: me } = useMe({ enabled: true });
  if (!me || me.needs_onboarding) {
    return null;
  }
  const membresia = me.active_membership;
  if (!membresia || membresia.status !== 'activa' || !membresia.empresa) {
    return null;
  }
  return (
    <Link
      to="/app"
      onClick={elegirVistaEmpresa}
      className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-primary-700 text-sm transition hover:bg-primary-50"
      data-testid="platform-admin-ir-a-mi-empresa"
    >
      <Building2 className="h-4 w-4 shrink-0" aria-hidden />
      <span className="shrink-0">Ir a mi empresa</span>
      <span className="max-w-[10rem] truncate text-neutral-500">
        · {membresia.empresa.legal_name}
      </span>
    </Link>
  );
}

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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-primary-700">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="font-semibold text-neutral-900">Booster · Platform Admin</div>
              <div className="text-neutral-500 text-xs">Operaciones internas de plataforma</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IrAMiEmpresa />
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
