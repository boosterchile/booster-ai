import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const crearViajePropio = vi.hoisted(() => vi.fn());

vi.mock('../services/crear-viaje-propio.js', async () => {
  const actual = await vi.importActual<typeof import('../services/crear-viaje-propio.js')>(
    '../services/crear-viaje-propio.js',
  );
  return {
    ...actual,
    crearViajePropio,
  };
});

vi.mock('../auth/capacidades.js', () => ({
  ctxDeUserContext: () => ({
    role: 'despachador',
    isTransportista: true,
    isGeneradorCarga: false,
    fichaConductorMismoRut: false,
    puedeAceptarOfertas: true,
  }),
}));

import {
  GeneradorSinVinculoError,
  ViajePropioValidacionError,
} from '../services/crear-viaje-propio.js';
import { createViajesPropiosRoutes } from './viajes-propios.js';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

function appConUsuario(
  over: {
    isTransportista?: boolean;
    status?: string;
    role?: string;
  } = {},
) {
  const route = createViajesPropiosRoutes({ db: {} as never, logger });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userContext', {
      user: { id: 'u1' },
      activeMembership: {
        membership: { role: over.role ?? 'despachador', puedeAceptarOfertas: true },
        empresa: {
          id: 'carrier-1',
          isTransportista: over.isTransportista ?? true,
          isGeneradorCarga: false,
          status: over.status ?? 'activa',
        },
      },
    } as never);
    await next();
  });
  app.route('/', route);
  return app;
}

const bodyExterno = {
  origen: { address_raw: 'Calle Uno 123, Santiago', region_code: '13' },
  destino: { address_raw: 'Calle Dos 456, Valparaíso', region_code: '05' },
  cargo_type: 'carga_seca',
  pickup_date_raw: '2026-11-20',
  cliente: { tipo: 'externo', nombre: 'Cliente SPA' },
};

describe('POST /viajes-propios', () => {
  beforeEach(() => {
    crearViajePropio.mockReset();
  });

  it('201 con cliente externo', async () => {
    crearViajePropio.mockResolvedValue({
      trip: {
        id: 't1',
        trackingCode: 'BOO-ABC123',
        status: 'asignado',
        origenAlta: 'propio_transportista',
      },
      assignment: {
        id: 'a1',
        tripId: 't1',
        status: 'asignado',
        agreedPriceClp: 0,
        acceptedAt: new Date('2026-11-16T12:00:00.000Z'),
      },
      rutaId: 'r1',
    });
    const res = await appConUsuario().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyExterno),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { origen: string; ruta_id: string };
    expect(json.origen).toBe('propio_transportista');
    expect(json.ruta_id).toBe('r1');
  });

  it('403 generador_sin_vinculo cuando el service rechaza IDOR', async () => {
    crearViajePropio.mockRejectedValue(new GeneradorSinVinculoError('gen-1'));
    const res = await appConUsuario().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...bodyExterno,
        cliente: { tipo: 'generador', empresa_id: '11111111-1111-4111-8111-111111111111' },
      }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'generador_sin_vinculo' });
  });

  it('400 validation_error en body inválido', async () => {
    crearViajePropio.mockRejectedValue(new ViajePropioValidacionError({ formErrors: ['x'] }));
    // Body inválido lo corta zValidator antes del service.
    const res = await appConUsuario().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...bodyExterno, origen: { address_raw: 'x', region_code: '13' } }),
    });
    expect(res.status).toBe(400);
    expect(crearViajePropio).not.toHaveBeenCalled();
  });
});
