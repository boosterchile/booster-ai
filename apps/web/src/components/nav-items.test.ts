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
  it('generador → Inicio + Empresa + Crear carga/Mis cargas/Sucursales/Certificados/Equipo', () => {
    const l = labels(navSectionsForMe(buildMe({ generador: true })));
    expect(l).toEqual([
      'Inicio',
      'Empresa',
      'Crear carga',
      'Mis cargas',
      'Sucursales',
      'Certificados',
      'Equipo',
    ]);
  });

  it('transportista dueño → Inicio + transporte + Zonas de matching + Dispositivos', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true, role: 'dueno' })));
    expect(l).toContain('Ofertas');
    expect(l).toContain('Liquidaciones');
    expect(l).toContain('Zonas de matching');
    expect(l).toContain('Dispositivos'); // admin
    expect(l).toContain('Trayectos');
    expect(l).not.toContain('Mis cargas'); // no es generador
  });

  // El despachador no tenía dónde ver las cargas que ya aceptó: la pantalla
  // que asigna conductor solo se alcanzaba desde Cobra Hoy y Liquidaciones.
  // En prod eso dejó 0 asignaciones con conductor (medido 2026-08-03).
  it('transportista → "Servicios" está en el menú, justo después de Ofertas', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true, role: 'despachador' })));
    expect(l).toContain('Servicios');
    expect(l.indexOf('Servicios')).toBe(l.indexOf('Ofertas') + 1);
  });

  it('generador puro NO ve Servicios (no despacha nada)', () => {
    const l = labels(navSectionsForMe(buildMe({ generador: true })));
    expect(l).not.toContain('Servicios');
  });

  it('dueño/admin ve Empresa; despachador no', () => {
    expect(labels(navSectionsForMe(buildMe({ generador: true, role: 'dueno' })))).toContain(
      'Empresa',
    );
    expect(labels(navSectionsForMe(buildMe({ generador: true, role: 'admin' })))).toContain(
      'Empresa',
    );
    expect(
      labels(navSectionsForMe(buildMe({ generador: true, role: 'despachador' }))),
    ).not.toContain('Empresa');
  });

  it('transportista NO admin (despachador) → sin Dispositivos ni Zonas de matching', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true, role: 'despachador' })));
    expect(l).toContain('Ofertas');
    expect(l).not.toContain('Dispositivos');
    expect(l).not.toContain('Trayectos');
    expect(l).not.toContain('Zonas de matching');
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

/**
 * acceso-usuarios-empresa-panel SC8 — el backend deja a dueño y admin de
 * cualquier empresa dar de alta a su gente; la generadora también necesita
 * llegar a «Equipo».
 */
describe('navSectionsForMe — Equipo (SC8)', () => {
  function seccionDe(sections: ReturnType<typeof navSectionsForMe>, label: string) {
    return sections.filter((s) => s.items.some((i) => i.label === label)).map((s) => s.heading);
  }

  it.each(['dueno', 'admin', 'despachador', 'visualizador'] as const)(
    'generadora pura, rol %s → «Equipo» en la sección Generador',
    (role) => {
      const sections = navSectionsForMe(buildMe({ generador: true, role }));
      expect(seccionDe(sections, 'Equipo')).toEqual(['Generador']);
      const item = sections.flatMap((s) => s.items).find((i) => i.label === 'Equipo');
      expect(item?.to).toBe('/app/equipo');
    },
  );

  it('transportista → «Equipo» una sola vez, en Transporte', () => {
    const l = labels(navSectionsForMe(buildMe({ transportista: true })));
    expect(l.filter((x) => x === 'Equipo')).toHaveLength(1);
    expect(seccionDe(navSectionsForMe(buildMe({ transportista: true })), 'Equipo')).toEqual([
      'Transporte',
    ]);
  });

  it('mixta → «Equipo» una sola vez, en Transporte', () => {
    const sections = navSectionsForMe(buildMe({ transportista: true, generador: true }));
    expect(labels(sections).filter((x) => x === 'Equipo')).toHaveLength(1);
    expect(seccionDe(sections, 'Equipo')).toEqual(['Transporte']);
  });
});
