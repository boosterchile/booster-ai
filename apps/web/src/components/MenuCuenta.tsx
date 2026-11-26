import { Button, cn } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse, MembershipPayload } from '../hooks/use-me.js';
import { useSwitchCompany } from '../hooks/use-switch-company.js';
import { volverAlPanel } from '../lib/vista-admin.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

export function etiquetaRol(role: MembershipPayload['role']): string {
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
      return 'Sostenibilidad';
    default:
      return role;
  }
}

const CLASE_ENLACE =
  'flex w-full items-center gap-2 rounded-md px-3 text-left text-neutral-700 text-sm hover:bg-neutral-100';

/**
 * Menú de cuenta del armazón (frente 8): el nombre de la empresa activa a la
 * derecha de la cabecera y, al abrirlo, el cambio de empresa, el perfil,
 * «Panel de Booster» para el personal de Booster y «Salir».
 */
export function MenuCuenta({ me }: { me: MeOnboarded }) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { switchTo, isPending } = useSwitchCompany();

  // ADR-034: solo empresas comerciales; las organizaciones stakeholder no se cambian aquí.
  const activas = me.memberships.filter(
    (m): m is typeof m & { empresa: NonNullable<typeof m.empresa> } =>
      m.status === 'activa' && m.empresa != null,
  );
  const empresaActivaId = me.active_membership?.empresa?.id ?? null;
  const nombre = me.active_membership?.empresa?.legal_name ?? me.user.full_name;

  useEffect(() => {
    if (!abierto) {
      return;
    }
    function alClic(e: MouseEvent) {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    function alTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTecla);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTecla);
    };
  }, [abierto]);

  const cerrar = () => setAbierto(false);

  return (
    <div ref={contenedor} className="relative min-w-0">
      <Button
        variant="ghost"
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((v) => !v)}
        data-testid="menu-cuenta"
        className="max-w-[14rem] sm:max-w-xs"
      >
        <span className="truncate">{nombre}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </Button>
      {abierto && (
        <div
          id={panelId}
          className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-neutral-0 p-2 shadow-lg"
        >
          <p className="px-3 pt-1 pb-2 text-neutral-500 text-xs">{me.user.full_name}</p>
          {activas.length > 1 && (
            <section aria-label="Cambiar de empresa" className="border-neutral-100 border-b pb-2">
              <p className="px-3 pb-1 font-medium text-neutral-900 text-xs">Cambiar de empresa</p>
              <ul>
                {activas.map((m) => {
                  const activa = m.empresa.id === empresaActivaId;
                  return (
                    <li key={m.id}>
                      <Button
                        variant="ghost"
                        disabled={activa || isPending}
                        aria-current={activa ? 'true' : undefined}
                        onClick={() => {
                          cerrar();
                          void switchTo(m.empresa.id);
                        }}
                        className="w-full justify-start text-left disabled:opacity-100"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-neutral-900">
                            {m.empresa.legal_name}
                          </span>
                          <span className="block font-normal text-neutral-500 text-xs">
                            {etiquetaRol(m.role)}
                          </span>
                        </span>
                        {activa && (
                          <Check
                            className="h-4 w-4 shrink-0 text-primary-600"
                            aria-label="Activa"
                          />
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <div className={cn('flex flex-col gap-1', activas.length > 1 && 'pt-2')}>
            {me.user.is_platform_admin && (
              <Link
                to="/app/platform-admin"
                onClick={() => {
                  volverAlPanel();
                  cerrar();
                }}
                className={cn(CLASE_ENLACE, 'text-primary-700 hover:bg-primary-50')}
                style={{ minHeight: 'var(--touch-min)' }}
                data-testid="menu-panel-booster"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                Panel de Booster
              </Link>
            )}
            <Link
              to="/app/perfil"
              onClick={cerrar}
              className={CLASE_ENLACE}
              style={{ minHeight: 'var(--touch-min)' }}
            >
              <UserIcon className="h-4 w-4 shrink-0" aria-hidden />
              Mi perfil
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                cerrar();
                void signOutUser();
              }}
              className="w-full justify-start"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              Salir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
