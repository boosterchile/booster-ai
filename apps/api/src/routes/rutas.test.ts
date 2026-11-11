import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El recorrido contra PostgreSQL está en
// test/integration/rutas-api.integration.test.ts; aquí, el router: flag,
// permisos, validación y traducción de los fallos.
const s = vi.hoisted(() => ({
  listarRutas: vi.fn(),
  verRuta: vi.fn(),
  agruparServicio: vi.fn(),
  quitarServicioDeRuta: vi.fn(),
  reordenarParadasDeRuta: vi.fn(),
  declararConfiguracionDeRuta: vi.fn(),
}));
vi.mock('../services/operar-ruta.js', () => s);
const estimarHuellaDeRuta = vi.hoisted(() =>
  vi.fn(async (_opts: { rutaId: string }) => ({ estado: 'estimada' })),
);
vi.mock('../services/estimar-huella-de-ruta.js', () => ({ estimarHuellaDeRuta }));

const { createRutasRoutes } = await import('./rutas.js');

const RUTA = '11111111-1111-4111-8111-111111111111';
const ASIG = '22222222-2222-4222-8222-222222222222';
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function app(
  cfg: {
    rol?: string;
    activada?: boolean;
    sinUsuario?: boolean;
    sinEmpresa?: boolean;
    transportista?: boolean;
    estado?: string;
  } = {},
) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (!cfg.sinUsuario) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'oficina' },
        activeMembership: cfg.sinEmpresa
          ? null
          : {
              membership: { role: cfg.rol ?? 'despachador' },
              empresa: {
                id: 'empresa-1',
                isTransportista: cfg.transportista ?? true,
                isGeneradorCarga: false,
                status: cfg.estado ?? 'activa',
              },
            },
      });
    }
    await next();
  });
  a.route('/rutas', createRutasRoutes({ db: {} as never, logger, activada: cfg.activada ?? true }));
  return a;
}
const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const CONFIG = { vehiculo_id: RUTA, unidad_arrastre_id: null, conductor_id: null };

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of Object.values(s)) {
    f.mockResolvedValue({
      ok: true,
      ruta: { id: RUTA },
      rutaNuevaId: 'nueva',
      rutaOrigenId: 'origen',
    });
  }
  s.listarRutas.mockResolvedValue([{ id: RUTA }]);
});

describe('/rutas — flag y permisos', () => {
  it('apagada responde 404 sin tocar nada', async () => {
    const res = await app({ activada: false }).request('/rutas');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(s.listarRutas).not.toHaveBeenCalled();
  });

  it.each([
    [{ sinUsuario: true }, 401, undefined],
    [{ sinEmpresa: true }, 403, 'no_active_empresa'],
    [{ transportista: false }, 403, 'not_a_carrier'],
    [{ estado: 'suspendida' }, 403, 'empresa_not_active'],
    [{ rol: 'conductor' }, 403, 'capability_denied'],
    [{ rol: 'inventado' }, 403, 'capability_denied'],
  ])('%j → %i', async (cfg, status, code) => {
    const res = await app(cfg).request('/rutas');
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code?: string }).code).toBe(code);
  });

  it('el visualizador lee, pero ninguna escritura le pasa', async () => {
    const a = app({ rol: 'visualizador' });
    expect((await a.request(`/rutas/${RUTA}`)).status).toBe(200);
    for (const [path, init] of [
      [
        `/rutas/${RUTA}/servicios`,
        json('POST', { asignacion_id: ASIG, posicion: { recogida: 0, entrega: 1 } }),
      ],
      [`/rutas/${RUTA}/servicios/${ASIG}`, { method: 'DELETE' }],
      [`/rutas/${RUTA}/paradas`, json('PUT', { paradas: [RUTA, ASIG] })],
      [`/rutas/${RUTA}/configuracion`, json('PUT', CONFIG)],
    ] as const) {
      const res = await a.request(path, init);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ capability: 'puedeAsignarViaje' });
    }
    expect(s.agruparServicio).not.toHaveBeenCalled();
  });
});

describe('/rutas — operaciones', () => {
  it('listar: estados por defecto y estados pedidos', async () => {
    const res = await app().request('/rutas');
    expect(await res.json()).toEqual({ rutas: [{ id: RUTA }] });
    expect(s.listarRutas).toHaveBeenCalledWith(expect.anything(), {
      empresaId: 'empresa-1',
      estados: ['planificada', 'en_curso'],
    });
    await app().request('/rutas?estado=cerrada,%20cancelada');
    expect(s.listarRutas.mock.calls[1]?.[1].estados).toEqual(['cerrada', 'cancelada']);
    expect((await app().request('/rutas?estado=volando')).status).toBe(400);
  });

  it('pasa la empresa del usuario, nunca una del cliente', async () => {
    await app().request(
      `/rutas/${RUTA}/servicios`,
      json('POST', {
        asignacion_id: ASIG,
        posicion: { recogida: 1, entrega: 2 },
        empresa_id: 'otra',
      }),
    );
    expect(s.agruparServicio).toHaveBeenCalledWith(expect.anything(), {
      empresaId: 'empresa-1',
      rutaId: RUTA,
      asignacionId: ASIG,
      posicion: { recogida: 1, entrega: 2 },
      userId: 'oficina',
    });
  });

  it('quitar responde la ruta y la ruta nueva', async () => {
    const res = await app().request(`/rutas/${RUTA}/servicios/${ASIG}`, { method: 'DELETE' });
    expect(await res.json()).toEqual({ ruta: { id: RUTA }, ruta_nueva_id: 'nueva' });
  });

  it('reordenar y declarar pasan el cuerpo validado', async () => {
    await app().request(`/rutas/${RUTA}/paradas`, json('PUT', { paradas: [RUTA, ASIG] }));
    expect(s.reordenarParadasDeRuta.mock.calls[0]?.[1]).toMatchObject({ paradaIds: [RUTA, ASIG] });
    await app().request(
      `/rutas/${RUTA}/configuracion`,
      json('PUT', { ...CONFIG, conductor_id: ASIG }),
    );
    expect(s.declararConfiguracionDeRuta.mock.calls[0]?.[1]).toMatchObject({
      vehiculoId: RUTA,
      unidadArrastreId: null,
      conductorId: ASIG,
    });
  });

  it('un id que no es uuid es una ruta que no existe; un cuerpo inválido es 400', async () => {
    const res = await app().request('/rutas/abc');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'ruta_not_found', code: 'ruta_not_found' });
    expect((await app().request(`/rutas/${RUTA}/servicios/abc`, { method: 'DELETE' })).status).toBe(
      404,
    );
    for (const [path, init] of [
      [
        `/rutas/${RUTA}/servicios`,
        json('POST', { asignacion_id: ASIG, posicion: { recogida: -1, entrega: 1 } }),
      ],
      [`/rutas/${RUTA}/paradas`, json('PUT', { paradas: [RUTA] })],
      [`/rutas/${RUTA}/configuracion`, json('PUT', { vehiculo_id: RUTA })],
    ] as const) {
      expect((await app().request(path, init)).status).toBe(400);
    }
  });
});

describe('/rutas — fallos del servicio', () => {
  it.each([
    [
      { ok: false, code: 'ruta_not_found' },
      404,
      { error: 'ruta_not_found', code: 'ruta_not_found' },
    ],
    [
      { ok: false, code: 'asignacion_not_found' },
      404,
      { error: 'asignacion_not_found', code: 'asignacion_not_found' },
    ],
    [
      {
        ok: false,
        code: 'ruta_invalida',
        violaciones: [
          { motivo: 'capacidad_peso_excedida', tramo: 1, masaKg: 6000, capacidadKg: 5000 },
          { motivo: 'servicio_ya_recogido', servicioId: 'viaje-1' },
        ],
      },
      422,
      {
        error: 'ruta_invalida',
        code: 'ruta_invalida',
        violaciones: [
          { motivo: 'capacidad_peso_excedida', tramo: 1, masa_kg: 6000, capacidad_kg: 5000 },
          { motivo: 'servicio_ya_recogido', viaje_id: 'viaje-1' },
        ],
      },
    ],
    [
      { ok: false, code: 'vehiculo_no_asignable', unidad: 'vehiculo', motivo: 'no_es_motriz' },
      422,
      {
        error: 'vehiculo_no_asignable',
        code: 'vehiculo_no_asignable',
        unidad: 'vehiculo',
        motivo: 'no_es_motriz',
      },
    ],
    [
      { ok: false, code: 'conductor_no_asignable' },
      422,
      { error: 'conductor_no_asignable', code: 'conductor_no_asignable' },
    ],
  ])('%j', async (fallo, status, cuerpo) => {
    s.declararConfiguracionDeRuta.mockResolvedValueOnce(fallo);
    const res = await app().request(`/rutas/${RUTA}/configuracion`, json('PUT', CONFIG));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(cuerpo);
  });

  it('un error inesperado del servicio se propaga (lo responde el manejador global)', async () => {
    s.verRuta.mockRejectedValueOnce(new Error('db caída'));
    const a = app();
    a.onError((err, c) => c.json({ error: err.message }, 500));
    const res = await a.request(`/rutas/${RUTA}`);
    expect(res.status).toBe(500);
  });
});

/**
 * huella-consolidada §3.9: la estimación de cada carga sigue a su ruta. Cada
 * operación que cambia una ruta vuelve a estimar las rutas que tocó.
 */
describe('/rutas — la estimación sigue a la ruta', () => {
  const estimadas = () => estimarHuellaDeRuta.mock.calls.map(([o]) => o.rutaId);
  const agrupar = () =>
    app().request(
      `/rutas/${RUTA}/servicios`,
      json('POST', { asignacion_id: ASIG, posicion: { recogida: 1, entrega: 2 } }),
    );

  it('agrupar estima la ruta de destino y la de origen', async () => {
    expect((await agrupar()).status).toBe(200);
    expect(estimadas()).toEqual([RUTA, 'origen']);
  });

  it('quitar estima la ruta y la ruta nueva del servicio', async () => {
    await app().request(`/rutas/${RUTA}/servicios/${ASIG}`, { method: 'DELETE' });
    expect(estimadas()).toEqual([RUTA, 'nueva']);
  });

  it('reordenar y declarar estiman la ruta', async () => {
    await app().request(`/rutas/${RUTA}/paradas`, json('PUT', { paradas: [RUTA, ASIG] }));
    await app().request(`/rutas/${RUTA}/configuracion`, json('PUT', CONFIG));
    expect(estimadas()).toEqual([RUTA, RUTA]);
  });

  it('leer no estima, y una operación rechazada tampoco', async () => {
    await app().request('/rutas');
    await app().request(`/rutas/${RUTA}`);
    s.agruparServicio.mockResolvedValueOnce({ ok: false, code: 'ruta_not_found' });
    expect((await agrupar()).status).toBe(404);
    expect(estimarHuellaDeRuta).not.toHaveBeenCalled();
  });

  it('si la estimación falla, la operación ya hecha responde igual', async () => {
    estimarHuellaDeRuta.mockRejectedValueOnce(new Error('Routes caído'));
    const res = await agrupar();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ruta: { id: RUTA } });
    // La segunda ruta se estima aunque la primera haya fallado.
    expect(estimadas()).toEqual([RUTA, 'origen']);
  });
});
