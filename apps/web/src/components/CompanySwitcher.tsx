import { Building2, Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MembershipPayload } from '../hooks/use-me.js';

interface CompanySwitcherProps {
  memberships: MembershipPayload[];
  activeEmpresaId: string | null;
  onSelect: (empresaId: string) => void;
  disabled?: boolean | undefined;
}

/**
 * Muestra la empresa activa del usuario y permite cambiarla.
 *
 * Comportamiento:
 *   - 0 memberships activas: no renderiza nada (el usuario debe
 *     onboardearse, otro flow).
 *   - 1 membership activa:    badge no clickeable con el nombre de la
 *     empresa (mismo aspecto que el badge anterior, sin afordancia
 *     visual de switcher porque no hay otras opciones).
 *   - 2+ memberships activas: dropdown con todas las opciones, marca
 *     la activa con un check, click en otra invoca onSelect(empresaId).
 *
 * El componente es puro: no toca localStorage ni queryClient. El
 * caller (típicamente vía `useSwitchCompany`) maneja el side effect.
 */
export function CompanySwitcher({
  memberships,
  activeEmpresaId,
  onSelect,
  disabled,
}: CompanySwitcherProps) {
  // ADR-034 — el switcher solo lista memberships a empresas comerciales,
  // no a organizaciones stakeholder. Stakeholder users tienen su propia
  // surface (`/app/stakeholder/zonas`) y normalmente single org; no
  // necesitan switcher acá.
  const activas = memberships.filter(
    (m): m is typeof m & { empresa: NonNullable<typeof m.empresa> } =>
      m.status === 'activa' && m.empresa != null,
  );
  const active = activas.find((m) => m.empresa.id === activeEmpresaId) ?? activas[0];
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!active) {
    return null;
  }

  if (activas.length === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
        <Building2 className="h-3 w-3" aria-hidden />
        {active.empresa.legal_name}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Building2 className="h-3 w-3" aria-hidden />
        <span>{active.empresa.legal_name}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-64 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          <div className="border-neutral-100 border-b px-3 py-2">
            <p className="font-medium text-neutral-900 text-xs">Cambiar de empresa</p>
            <p className="mt-0.5 text-neutral-500 text-xs">
              Pertenecés a {activas.length} empresas activas.
            </p>
          </div>
          <ul>
            {activas.map((m) => {
              const isActive = m.empresa.id === active.empresa.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isActive || disabled}
                    onClick={() => {
                      setOpen(false);
                      onSelect(m.empresa.id);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-neutral-50 disabled:cursor-default disabled:bg-neutral-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-neutral-900">
                        {m.empresa.legal_name}
                      </div>
                      <div className="mt-0.5 text-neutral-500 text-xs">{roleLabel(m.role)}</div>
                    </div>
                    {isActive && (
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary-600"
                        aria-label="Activa"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function roleLabel(role: MembershipPayload['role']): string {
  switch (role) {
    case 'dueno':
      return 'Dueño';
    case 'admin':
      return 'Administrador';
    case 'despachador':
      return 'Despachador';
    case 'conductor':
      return 'Conductor';
    case 'visualizador':
      return 'Visualizador';
    case 'stakeholder_sostenibilidad':
      return 'Stakeholder';
    default:
      return role;
  }
}
