import { describe, expect, it } from 'vitest';
import type { MeRegistered } from '../hooks/use-me.js';
import { ctxDesdeMe, flagsDe } from './capacidades.js';

function me(opts: {
  role: MeRegistered['memberships'][number]['role'];
  carrier?: boolean;
  shipper?: boolean;
  ficha?: boolean;
  flag?: boolean;
}): MeRegistered {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      email: 'persona@example.com',
      full_name: 'Persona Sintética',
      phone: null,
      whatsapp_e164: null,
      rut: '11.111.111-1',
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [],
    active_membership: {
      id: 'm',
      role: opts.role,
      status: 'activa',
      joined_at: null,
      puede_aceptar_ofertas: opts.flag === true,
      empresa: {
        id: 'e',
        legal_name: 'Transporte Ejemplo',
        rut: '11.111.111-1',
        is_generador_carga: opts.shipper === true,
        is_transportista: opts.carrier !== false,
        status: 'activa',
      },
    },
    ficha_conductor_mismo_rut: opts.ficha === true,
  };
}

describe('flagsDe', () => {
  it('el dueño transportista ve la plata y acepta ofertas', () => {
    const flags = flagsDe(me({ role: 'dueno' }));
    expect(flags.verFinanzas).toBe(true);
    expect(flags.aceptarOferta).toBe(true);
    expect(flags.aceptarPorVoz).toBe(false);
  });

  it('el dueño con ficha del mismo RUT abre el panel y la voz', () => {
    const flags = flagsDe(me({ role: 'dueno', ficha: true }));
    expect(flags.panelConductor).toBe(true);
    expect(flags.aceptarPorVoz).toBe(true);
    expect(flags.menuGestion).toBe(true);
  });

  it('despachador, conductor y visualizador no ven la plata', () => {
    for (const role of ['despachador', 'conductor', 'visualizador'] as const) {
      expect(flagsDe(me({ role })).verFinanzas).toBe(false);
    }
  });

  it('el despachador asigna y solo acepta con el flag', () => {
    expect(flagsDe(me({ role: 'despachador' })).asignar).toBe(true);
    expect(flagsDe(me({ role: 'despachador' })).aceptarOferta).toBe(false);
    expect(flagsDe(me({ role: 'despachador', flag: true })).aceptarOferta).toBe(true);
  });

  it('el conductor no acepta aunque el flag esté encendido', () => {
    const flags = flagsDe(me({ role: 'conductor', flag: true }));
    expect(flags.aceptarOferta).toBe(false);
    expect(flags.menuGestion).toBe(false);
    expect(flags.panelConductor).toBe(true);
  });

  it('el visualizador generador no publica ni cancela', () => {
    const flags = flagsDe(me({ role: 'visualizador', shipper: true, carrier: false }));
    expect(flags.publicarCarga).toBe(false);
    expect(flags.cancelarCarga).toBe(false);
    expect(flags.invitar).toBe(false);
  });

  it('sin empresa no hay contexto', () => {
    const vacio = me({ role: 'dueno' });
    if (vacio.active_membership) {
      vacio.active_membership.empresa = null;
    }
    expect(ctxDesdeMe(vacio)).toBeNull();
  });
});
