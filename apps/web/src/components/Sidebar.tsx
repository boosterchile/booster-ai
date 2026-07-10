import { cn } from '@booster-ai/ui-components';
import { Link, useRouterState } from '@tanstack/react-router';
import { LogOut, Settings, User as UserIcon } from 'lucide-react';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useSwitchCompany } from '../hooks/use-switch-company.js';
import { CompanySwitcher } from './CompanySwitcher.js';
import { navSectionsForMe } from './nav-items.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * Sidebar del shell de operador (D2). Navegación vertical role-aware
 * (`navSectionsForMe`), con el item activo resaltado con el **acento** del
 * registro. Consume el registro operador vía las custom properties del theme
 * (`--touch-min`/`--pad-y`/`--pad-x`) heredadas del `RegisterProvider` del
 * Layout. Mantiene accesible el `CompanySwitcher` (multi-tenant) y el
 * perfil/Salir. En móvil el Layout lo monta como drawer y pasa `onNavigate`
 * para cerrarlo al navegar.
 */
export function Sidebar({ me, onNavigate }: { me: MeOnboarded; onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { switchTo, isPending } = useSwitchCompany();
  const sections = navSectionsForMe(me);
  const activeEmpresaId = me.active_membership?.empresa?.id ?? null;

  function handleSwitch(empresaId: string) {
    onNavigate?.();
    void switchTo(empresaId);
  }

  return (
    <div className="flex h-full flex-col bg-neutral-0">
      <Link
        to="/app"
        onClick={onNavigate}
        className="flex shrink-0 items-center gap-2 border-neutral-200 border-b px-4 py-4"
      >
        <img src="/icons/icon.svg" alt="" aria-hidden className="h-7 w-7" />
        <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
      </Link>

      <div className="shrink-0 border-neutral-200 border-b px-3 py-3">
        <CompanySwitcher
          memberships={me.memberships}
          activeEmpresaId={activeEmpresaId}
          onSelect={handleSwitch}
          disabled={isPending}
        />
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-3">
        {sections.map((section, i) => (
          <div key={section.heading ?? `section-${i}`} className={i > 0 ? 'mt-4' : ''}>
            {section.heading && (
              <div className="px-2 pb-1 font-medium text-neutral-500 text-xs uppercase tracking-wider">
                {section.heading}
              </div>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active =
                  item.to === '/app' ? pathname === '/app' : pathname.startsWith(item.to);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md font-medium text-sm transition-colors',
                        active
                          ? 'bg-accent-50 text-accent-800'
                          : 'text-neutral-700 hover:bg-neutral-100',
                      )}
                      style={{
                        minHeight: 'var(--touch-min)',
                        paddingBlock: 'var(--pad-y)',
                        paddingInline: 'var(--pad-x)',
                      }}
                    >
                      <item.icon
                        className={cn(
                          'h-5 w-5 shrink-0',
                          active ? 'text-accent-600' : 'text-neutral-400',
                        )}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-neutral-200 border-t px-3 py-3">
        <Link
          to="/app/perfil"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-2 text-neutral-700 text-sm hover:bg-neutral-100"
          style={{ minHeight: 'var(--touch-min)' }}
        >
          <UserIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{me.user.full_name}</span>
          <Settings className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            void signOutUser();
          }}
          className="mt-1 flex w-full items-center gap-2 rounded-md px-2 text-neutral-600 text-sm hover:bg-neutral-100"
          style={{ minHeight: 'var(--touch-min)' }}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          Salir
        </button>
      </div>
    </div>
  );
}
