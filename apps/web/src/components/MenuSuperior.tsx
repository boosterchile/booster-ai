import { cn } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { type NavGroup, type NavGroupId, type NavItem, itemActivo } from './nav-items.js';
import type { BadgeNav } from './use-badges-transporte.js';

export interface BadgesMenu {
  ofertas: BadgeNav | null;
  servicios: BadgeNav | null;
  cumplimiento: BadgeNav | null;
}

/** El conteo que acompaña a cada pantalla del menú. */
function badgeDeItem(to: string, badges: BadgesMenu): BadgeNav | null {
  if (to === '/app/ofertas') {
    return badges.ofertas;
  }
  if (to === '/app/servicios') {
    return badges.servicios;
  }
  if (to === '/app/cumplimiento') {
    return badges.cumplimiento;
  }
  return null;
}

const TESTID_BADGE: Partial<Record<NavGroupId, string>> = {
  ofertas: 'nav-badge-ofertas',
  viajes: 'nav-badge-servicios',
  flota: 'nav-badge-cumplimiento',
};

/** El conteo de un grupo: el de la pantalla que lo lleva dentro del grupo. */
function badgeDeGrupo(group: NavGroup, badges: BadgesMenu): BadgeNav | null {
  for (const item of group.items) {
    const badge = badgeDeItem(item.to, badges);
    if (badge) {
      return badge;
    }
  }
  return null;
}

function Pastilla({ badge, testId }: { badge: BadgeNav; testId?: string | undefined }) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-semibold text-white text-xs',
        badge.tono === 'warning' ? 'bg-warning-500' : 'bg-danger-600',
      )}
    >
      {badge.n}
      <span className="sr-only"> pendientes</span>
    </span>
  );
}

const TOQUE: CSSProperties = { minHeight: 'var(--touch-min)' };

/** Entradas del menú en la cabecera, desde 640 px. */
export function MenuSuperior({
  groups,
  active,
  badges,
}: {
  groups: NavGroup[];
  active: NavGroup | null;
  badges: BadgesMenu;
}) {
  return (
    <nav aria-label="Navegación principal" className="hidden min-w-0 sm:block">
      <ul className="flex items-center gap-1 overflow-x-auto">
        {groups.map((group) => {
          const actual = active?.id === group.id;
          const badge = badgeDeGrupo(group, badges);
          return (
            <li key={group.id} className="shrink-0">
              <Link
                to={group.items[0]?.to ?? '/app'}
                aria-current={actual ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 font-medium text-sm transition-colors',
                  actual
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'text-neutral-700 hover:bg-neutral-100',
                )}
                style={TOQUE}
              >
                {group.label}
                {badge ? <Pastilla badge={badge} testId={TESTID_BADGE[group.id]} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pestañas con las pantallas del grupo activo, cuando tiene más de una. */
export function PestanasGrupo({
  group,
  pathname,
  badges,
}: {
  group: NavGroup | null;
  pathname: string;
  badges: BadgesMenu;
}) {
  if (!group || group.items.length < 2) {
    return null;
  }
  const actual: NavItem | null = itemActivo([group], pathname);
  return (
    <nav
      aria-label={`Secciones de ${group.label}`}
      className="border-neutral-200 border-b bg-neutral-0"
    >
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {group.items.map((item) => {
          const esActual = actual?.to === item.to;
          const badge = badgeDeItem(item.to, badges);
          return (
            <li key={item.to} className="shrink-0">
              <Link
                to={item.to}
                aria-current={esActual ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-2 text-sm transition-colors',
                  esActual
                    ? 'border-primary-600 font-medium text-neutral-900'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900',
                )}
                style={TOQUE}
              >
                {item.label}
                {badge ? <Pastilla badge={badge} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barra inferior fija con las entradas del menú, bajo 640 px. */
export function BarraInferior({
  groups,
  active,
  badges,
}: {
  groups: NavGroup[];
  active: NavGroup | null;
  badges: BadgesMenu;
}) {
  return (
    <nav
      aria-label="Navegación principal en móvil"
      data-testid="barra-inferior"
      className="fixed inset-x-0 bottom-0 z-40 border-neutral-200 border-t bg-neutral-0 pb-safe sm:hidden"
    >
      <ul className="flex">
        {groups.map((group) => {
          const actual = active?.id === group.id;
          const badge = badgeDeGrupo(group, badges);
          return (
            <li key={group.id} className="min-w-0 flex-1">
              <Link
                to={group.items[0]?.to ?? '/app'}
                aria-current={actual ? 'page' : undefined}
                aria-label={group.label}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 border-t-2 px-1 text-xs',
                  actual
                    ? 'border-primary-600 font-semibold text-primary-700'
                    : 'border-transparent text-neutral-600',
                )}
                style={{ minHeight: '3.5rem' }}
              >
                <group.icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="max-w-full truncate">{group.shortLabel}</span>
                {badge ? (
                  <span className="absolute top-1 right-1/4">
                    <Pastilla badge={badge} />
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
