import {
  puedeAceptarOferta,
  puedePublicarCarga,
  puedeVerFinanzas,
  veSoloSuViaje,
} from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { ctxDeUserContext } from '../../src/auth/capacidades.js';

function sesion(opts: {
  role?: string;
  flag?: boolean;
  carrier?: boolean;
  shipper?: boolean;
  sinMembresia?: boolean;
}) {
  if (opts.sinMembresia) {
    return {
      activeMembership: {
        empresa: { id: 'e', isTransportista: true, isGeneradorCarga: false },
      },
    };
  }
  return {
    activeMembership: {
      membership: { role: opts.role, puedeAceptarOfertas: opts.flag === true },
      empresa: {
        id: 'e',
        isTransportista: opts.carrier !== false,
        isGeneradorCarga: opts.shipper === true,
      },
    },
  };
}

function exigir(ctx: ReturnType<typeof ctxDeUserContext>) {
  if (!ctx) {
    throw new Error('se esperaba contexto de capacidades');
  }
  return ctx;
}

describe('ctxDeUserContext', () => {
  it('dueño transportista ve finanzas y acepta ofertas', () => {
    const ctx = exigir(ctxDeUserContext(sesion({ role: 'dueno' })));
    expect(puedeVerFinanzas(ctx)).toBe(true);
    expect(puedeAceptarOferta(ctx)).toBe(true);
  });

  it('admin ve finanzas; despachador, conductor y visualizador no', () => {
    expect(puedeVerFinanzas(exigir(ctxDeUserContext(sesion({ role: 'admin' }))))).toBe(true);
    for (const role of ['despachador', 'conductor', 'visualizador'] as const) {
      expect(puedeVerFinanzas(exigir(ctxDeUserContext(sesion({ role }))))).toBe(false);
    }
  });

  it('el flag de ofertas no alcanza para el conductor ni el visualizador', () => {
    expect(
      puedeAceptarOferta(exigir(ctxDeUserContext(sesion({ role: 'conductor', flag: true })))),
    ).toBe(false);
    expect(
      puedeAceptarOferta(exigir(ctxDeUserContext(sesion({ role: 'visualizador', flag: true })))),
    ).toBe(false);
    expect(
      puedeAceptarOferta(exigir(ctxDeUserContext(sesion({ role: 'despachador', flag: false })))),
    ).toBe(false);
    expect(
      puedeAceptarOferta(exigir(ctxDeUserContext(sesion({ role: 'despachador', flag: true })))),
    ).toBe(true);
  });

  it('visualizador generador no publica; el dueño sí', () => {
    const visor = exigir(
      ctxDeUserContext(sesion({ role: 'visualizador', shipper: true, carrier: false })),
    );
    const dueno = exigir(
      ctxDeUserContext(sesion({ role: 'dueno', shipper: true, carrier: false })),
    );
    expect(puedePublicarCarga(visor)).toBe(false);
    expect(puedePublicarCarga(dueno)).toBe(true);
  });

  it('solo el conductor empleado queda en su viaje', () => {
    expect(veSoloSuViaje(exigir(ctxDeUserContext(sesion({ role: 'conductor' }))))).toBe(true);
    expect(veSoloSuViaje(exigir(ctxDeUserContext(sesion({ role: 'dueno' }))))).toBe(false);
  });

  it('sin membership o con rol desconocido no hay contexto', () => {
    expect(ctxDeUserContext(sesion({ sinMembresia: true }))).toBeNull();
    expect(ctxDeUserContext(sesion({ role: 'operador' }))).toBeNull();
    expect(ctxDeUserContext(null)).toBeNull();
  });
});

describe('denegarEditarCarga y denegarResponderCambioCarga (editar-anular-cargas §6)', () => {
  async function responder(
    denegar: (c: never, uc: unknown) => Response | null,
    uc: unknown,
  ): Promise<{ status: number; code?: string } | null> {
    const { Hono } = await import('hono');
    const app = new Hono();
    let resultado: Response | null = null;
    app.get('/', (c) => {
      resultado = denegar(c as never, uc);
      return resultado ?? c.json({ ok: true });
    });
    const res = await app.request('/');
    if (resultado === null) {
      return null;
    }
    return { status: res.status, ...((await res.json()) as { code?: string }) };
  }

  it('editar: el gestor del generador pasa, el visualizador recibe read_only', async () => {
    const { denegarEditarCarga } = await import('../../src/auth/capacidades.js');
    expect(
      await responder(denegarEditarCarga, sesion({ role: 'dueno', carrier: false, shipper: true })),
    ).toBeNull();
    expect(
      await responder(
        denegarEditarCarga,
        sesion({ role: 'visualizador', carrier: false, shipper: true }),
      ),
    ).toMatchObject({ status: 403, code: 'read_only' });
    expect(await responder(denegarEditarCarga, sesion({ role: 'dueno' }))).toMatchObject({
      status: 403,
      code: 'capability_denied',
    });
  });

  it('responder un cambio: dueño del transportista pasa; conductor y despachador sin permiso no', async () => {
    const { denegarResponderCambioCarga } = await import('../../src/auth/capacidades.js');
    expect(await responder(denegarResponderCambioCarga, sesion({ role: 'dueno' }))).toBeNull();
    expect(
      await responder(denegarResponderCambioCarga, sesion({ role: 'despachador', flag: true })),
    ).toBeNull();
    for (const role of ['conductor', 'despachador', 'visualizador']) {
      expect(await responder(denegarResponderCambioCarga, sesion({ role }))).toMatchObject({
        status: 403,
        code: 'capability_denied',
      });
    }
  });
});
