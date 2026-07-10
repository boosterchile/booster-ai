import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { navSectionsForMe } from './nav-items.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Role = MeOnboarded['memberships'][number]['role'];

function buildMe(opts: {
  role?: Role;
  transportista?: boolean;
  generador?: boolean;
  stakeholder?: boolean;
}): MeOnboarded {
  const membership = opts.stakeholder
    ? {
        id: 'm-1',
        role: 'stakeholder_sostenibilidad' as const,
        status: 'activa' as const,
        joined_at: null,
        empresa: null,
      }
    : {
        id: 'm-1',
        role: (opts.role ?? 'dueno') as Role,
        status: 'activa' as const,
        joined_at: null,
        empresa: {
          id: 'e-1',
          legal_name: 'ACME',
          rut: '1-9',
          is_generador_carga: opts.generador ?? false,
          is_transportista: opts.transportista ?? false,
          status: 'activa' as const,
        },
      };
  return {
    needs_onboarding: false,
    user: { id: 'u', email: 'a@b.cl', full_name: 'X', is_platform_admin: false, status: 'activo' },
    memberships: [membership],
    active_membership: membership,
  } as MeOnboarded;
}

function labels(sections: ReturnType<typeof navSectionsForMe>): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.label));
}

describe('navSectionsForMe', () => {
  it('generador → Inicio + Crear carga/Mis cargas/Sucursales/Certificados', () => {
    const l = labels(navSectionsForMe(buildMe({ generador: true })));
    expect(l).toEqual(['Inicio', 'Crear carga', 'Mis cargas', 'Sucursales', 'Certificados']);
  });

  it('transportista dueño → Inicio + 7 items de transporte + Dispositivos', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true, role: 'dueno' })));
    expect(l).toContain('Ofertas');
    expect(l).toContain('Liquidaciones');
    expect(l).toContain('Dispositivos'); // admin
    expect(l).not.toContain('Mis cargas'); // no es generador
  });

  it('transportista NO admin (despachador) → sin Dispositivos', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true, role: 'despachador' })));
    expect(l).toContain('Ofertas');
    expect(l).not.toContain('Dispositivos');
  });

  it('empresa dual (transportista + generador) → ambas secciones', () => {
    const sections = navSectionsForMe(buildMe({ transportista: true, generador: true }));
    const l = labels(sections);
    expect(l).toContain('Ofertas');
    expect(l).toContain('Mis cargas');
    expect(sections.some((s) => s.heading === 'Transporte')).toBe(true);
    expect(sections.some((s) => s.heading === 'Generador')).toBe(true);
  });

  it('stakeholder → solo Inicio + Zonas', () => {
    const l = labels(navSectionsForMe(buildMe({ stakeholder: true })));
    expect(l).toEqual(['Inicio', 'Zonas']);
  });
});
