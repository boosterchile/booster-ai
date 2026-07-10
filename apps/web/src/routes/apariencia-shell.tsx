import { useSearch } from '@tanstack/react-router';
import { Layout } from '../components/Layout.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /apariencia/shell — preview del shell de operador (sidebar D2) con `me` MOCK
 * por rol (`?rol=transportista|generador|dual|stakeholder`). Ruta pública sin
 * datos reales: sirve para la revisión visual del PO y para el E2E del sidebar
 * (que no puede autenticarse contra el backend en e2e-local). Demostrador, como
 * `/apariencia`.
 */
function mockMe(rol: string): MeOnboarded {
  const transportista = rol === 'transportista' || rol === 'dual';
  const generador = rol === 'generador' || rol === 'dual';
  const stakeholder = rol === 'stakeholder';

  const membership = stakeholder
    ? {
        id: 'm-1',
        role: 'stakeholder_sostenibilidad' as const,
        status: 'activa' as const,
        joined_at: null,
        empresa: null,
      }
    : {
        id: 'm-1',
        role: 'dueno' as const,
        status: 'activa' as const,
        joined_at: null,
        empresa: {
          id: 'e-1',
          legal_name: 'Demo Operador SpA',
          rut: '76.123.456-7',
          is_generador_carga: generador,
          is_transportista: transportista,
          status: 'activa' as const,
        },
      };

  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'demo@boosterchile.com',
      full_name: 'Demo Operador',
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [membership],
    active_membership: membership,
  } as MeOnboarded;
}

export function AparienciaShellRoute() {
  const search = (useSearch({ strict: false }) ?? {}) as { rol?: string };
  const rol = search.rol ?? 'dual';

  return (
    <Layout me={mockMe(rol)} title="Preview del shell">
      <h1 className="font-bold text-2xl text-neutral-900 tracking-tight">
        Preview del shell operador
      </h1>
      <p className="mt-2 text-neutral-600 text-sm">
        Sidebar D2 role-aware (registro operador) con datos mock. Rol activo:{' '}
        <span className="font-medium">{rol}</span>. En móvil, el sidebar colapsa a drawer.
      </p>
    </Layout>
  );
}
