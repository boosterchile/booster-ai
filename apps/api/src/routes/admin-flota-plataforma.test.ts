import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `.specs/flota-plataforma`: la flota de todas las empresas, solo para quien
 * tiene acceso al panel de plataforma.
 */
const ADMIN_EMAIL = 'dev@boosterchile.com';
const VEHICULO = '22222222-2222-4222-8222-222222222222';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never as Logger;

const posiciones = vi.fn(async () => new Map<string, unknown>());
vi.mock('../services/ultimas-posiciones-vehiculos.js', () => ({
  ultimasPosicionesDeVehiculos: posiciones,
}));
const counterAdd = vi.fn();
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: counterAdd }),
}));

/** Cada `select` resuelve con la siguiente fila de la cola, termine donde termine la cadena. */
function makeDb(selects: unknown[][] = []) {
  const cola = [...selects];
  const select = vi.fn(() => {
    const filas = () => Promise.resolve(cola.shift() ?? []);
    const chain: Record<string, unknown> = {};
    for (const paso of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
      chain[paso] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(filas);
    return chain;
  });
  return { db: { select } as never, select };
}

async function app(db: unknown, usuario: { email: string } | null = { email: ADMIN_EMAIL }) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({ config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] } }));
  const mod = await import('./admin-flota-plataforma.js');
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (usuario) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: usuario.email },
      });
    }
    await next();
  });
  a.route('/', mod.createAdminFlotaPlataformaRoutes({ db: db as never, logger }));
  return a;
}

const FILA = {
  id: VEHICULO,
  plate: 'KZXB64',
  empresaId: 'emp-1',
  empresaNombre: 'Transportes Andes Ltda.',
  vehicleType: 'camion_pesado',
  capacityKg: 28000,
  vehicleStatus: 'activo',
  teltonika_imei: '861234567890123',
  teltonika_imei_espejo: null,
  fuenteCombustibleCan: '83',
};

beforeEach(() => {
  vi.clearAllMocks();
  posiciones.mockResolvedValue(new Map());
});

describe('acceso: solo el panel de plataforma', () => {
  it.each(['/', `/${VEHICULO}`])('%s sin sesión responde 401 y no lee nada', async (ruta) => {
    const { db, select } = makeDb();
    const res = await (await app(db, null)).request(ruta);
    expect(res.status).toBe(401);
    expect(select).not.toHaveBeenCalled();
  });

  it.each(['/', `/${VEHICULO}`])(
    '%s con una cuenta sin acceso al panel responde 403 y no lee nada',
    async (ruta) => {
      const { db, select } = makeDb();
      const res = await (await app(db, { email: 'dueno@transportes.cl' })).request(ruta);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden_platform_admin' });
      expect(select).not.toHaveBeenCalled();
      expect(posiciones).not.toHaveBeenCalled();
    },
  );
});

describe('GET / — la flota de todas las empresas', () => {
  it('trae cada vehículo con su empresa y su posición, de la fuente que corresponde', async () => {
    const otro = {
      ...FILA,
      id: 'v-2',
      plate: 'ABCD12',
      empresaId: 'emp-2',
      empresaNombre: 'Otra SpA',
    };
    const espejo = { ...FILA, id: 'v-3', teltonika_imei: null, teltonika_imei_espejo: '86999' };
    const movil = { ...FILA, id: 'v-4', teltonika_imei: null, fuenteCombustibleCan: 'sin_sensor' };
    const punto = {
      timestamp_device: new Date('2026-11-12T01:20:00Z'),
      latitude: '-33.4500000',
      longitude: '-70.6600000',
      speed_kmh: 62,
      angle_deg: 90,
    };
    posiciones.mockResolvedValue(
      new Map([
        [VEHICULO, punto],
        ['v-3', punto],
        ['v-4', punto],
      ]),
    );
    const { db } = makeDb([[FILA, otro, espejo, movil]]);

    const res = await (await app(db)).request('/');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { vehiculos: Record<string, unknown>[]; truncada?: boolean };
    expect(json.truncada).toBeUndefined();
    expect(json.vehiculos[0]).toEqual({
      id: VEHICULO,
      patente: 'KZXB64',
      empresa: { id: 'emp-1', nombre: 'Transportes Andes Ltda.' },
      tipo: 'camion_pesado',
      capacidad_kg: 28000,
      estado: 'activo',
      teltonika_imei: '861234567890123',
      fuente_combustible_can: '83',
      posicion: {
        latitud: -33.45,
        longitud: -70.66,
        velocidad_kmh: 62,
        registrada_en: '2026-11-12T01:20:00.000Z',
        fuente: 'teltonika',
      },
    });
    expect(json.vehiculos[1]).toMatchObject({
      empresa: { id: 'emp-2', nombre: 'Otra SpA' },
      posicion: null,
    });
    expect(json.vehiculos[2]).toMatchObject({
      teltonika_imei: '86999',
      posicion: { fuente: 'espejo' },
    });
    expect(json.vehiculos[3]).toMatchObject({
      teltonika_imei: null,
      posicion: { fuente: 'movil' },
    });
  });

  it('una posición sin coordenadas no es una posición', async () => {
    posiciones.mockResolvedValue(
      new Map([[VEHICULO, { timestamp_device: new Date(), latitude: null, longitude: null }]]),
    );
    const { db } = makeDb([[FILA]]);
    const json = (await (await (await app(db)).request('/')).json()) as {
      vehiculos: { posicion: unknown }[];
    };
    expect(json.vehiculos[0]?.posicion).toBeNull();
  });

  it('avisa si la lista llegó al tope', async () => {
    const muchas = Array.from({ length: 2001 }, (_, i) => ({ ...FILA, id: `v-${i}` }));
    const { db } = makeDb([muchas]);
    const json = (await (await (await app(db)).request('/')).json()) as {
      vehiculos: unknown[];
      truncada: boolean;
    };
    expect(json.vehiculos).toHaveLength(2000);
    expect(json.truncada).toBe(true);
  });

  it('deja registro de quién consultó', async () => {
    const { db } = makeDb([[FILA]]);
    await (await app(db)).request('/');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ adminEmail: ADMIN_EMAIL, vehiculos: 1 }),
      expect.any(String),
    );
    expect(counterAdd).toHaveBeenCalledWith(1, { vista: 'lista' });
  });
});

describe('GET /:id — la ficha de un vehículo', () => {
  const DETALLE = {
    ...FILA,
    empresaRut: '77.111.222-3',
    brand: 'Scania',
    model: 'R450',
    year: 2021,
    fuelType: 'diesel',
    curbWeightKg: 9000,
    consumptionLPer100kmBaseline: '32.00',
    capacidadEstanqueL: 400,
  };
  const can = (extra: object = {}) => [
    {
      puntos: 24216,
      con83: 24039,
      con84: 24038,
      con89: 24040,
      ultima: new Date('2026-11-12T01:20:00Z'),
      ...extra,
    },
  ];
  const viaje = (codigo: string, estado: string, extra: object = {}) => ({
    trackingCode: codigo,
    status: estado,
    deliveredAt: estado === 'entregado' ? new Date('2026-10-20T18:00:00Z') : null,
    certificationLevel: null,
    routeDataSource: null,
    coveragePct: null,
    certificateIssuedAt: null,
    ...extra,
  });
  const ficha = async (selects: unknown[][]) => {
    const { db } = makeDb(selects);
    const res = await (await app(db)).request(`/${VEHICULO}`);
    return { res, json: (await res.json()) as Record<string, unknown> };
  };

  it('un id que no existe o no es uuid responde 404', async () => {
    expect((await ficha([[]])).res.status).toBe(404);
    const { db, select } = makeDb();
    const res = await (await app(db)).request('/no-es-uuid');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'vehiculo_not_found', code: 'vehiculo_not_found' });
    expect(select).not.toHaveBeenCalled();
  });

  it('trae los datos del vehículo, su empresa y lo que el equipo envía por CAN', async () => {
    const { res, json } = await ficha([[DETALLE], can(), []]);
    expect(res.status).toBe(200);
    expect(json.vehiculo).toEqual({
      id: VEHICULO,
      patente: 'KZXB64',
      empresa: { id: 'emp-1', nombre: 'Transportes Andes Ltda.', rut: '77.111.222-3' },
      tipo: 'camion_pesado',
      marca: 'Scania',
      modelo: 'R450',
      anio: 2021,
      combustible: 'diesel',
      capacidad_kg: 28000,
      peso_vacio_kg: 9000,
      consumo_l_por_100km_base: 32,
      capacidad_estanque_l: 400,
      estado: 'activo',
      teltonika_imei: '861234567890123',
      teltonika_imei_espejo: null,
    });
    expect(json.can).toEqual({
      fuente_configurada: '83',
      ventana_dias: 3,
      puntos: 24216,
      con_combustible_83: 24039,
      con_nivel_84: 24038,
      con_nivel_89: 24040,
      ultima_lectura_en: '2026-11-12T01:20:00.000Z',
      aviso: null,
    });
  });

  it('no avisa cuando el equipo envía el 83 sin estar marcado: la huella lo lee igual', async () => {
    const { json } = await ficha([
      [{ ...DETALLE, fuenteCombustibleCan: 'sin_sensor' }],
      can({ con83: 9808 }),
      [],
    ]);
    expect(json.can).toMatchObject({
      fuente_configurada: 'sin_sensor',
      con_combustible_83: 9808,
      aviso: null,
    });
  });

  it('avisa cuando está configurado el 83 y el equipo no lo envía', async () => {
    const { json } = await ficha([[DETALLE], can({ con83: 0 }), []]);
    expect(json.can).toMatchObject({ aviso: 'configurado_83_sin_lecturas' });
  });

  it('sin datos del equipo en la ventana: puntos en cero y sin última lectura', async () => {
    const { json } = await ficha([[{ ...DETALLE, fuenteCombustibleCan: 'sin_sensor' }], [], []]);
    expect(json.can).toMatchObject({ puntos: 0, ultima_lectura_en: null, aviso: null });
  });

  it('un vehículo sin equipo Teltonika propio no tiene lectura de CAN', async () => {
    const { json } = await ficha([[{ ...DETALLE, teltonika_imei: null }], []]);
    expect(json.can).toBeNull();
  });

  it('cuenta los viajes y sus certificados por nivel', async () => {
    const emitido = { certificateIssuedAt: new Date('2026-10-20T18:05:00Z') };
    const { json } = await ficha([
      [DETALLE],
      can(),
      [
        viaje('BOO-1', 'asignado'),
        viaje('BOO-2', 'recogido'),
        viaje('BOO-3', 'entregado', { ...emitido, certificationLevel: 'primario_verificable' }),
        viaje('BOO-4', 'entregado', { ...emitido, certificationLevel: 'secundario_modeled' }),
        viaje('BOO-5', 'entregado', { ...emitido, certificationLevel: 'secundario_modeled' }),
        viaje('BOO-6', 'entregado', { ...emitido, certificationLevel: 'secundario_default' }),
        viaje('BOO-7', 'entregado', { certificationLevel: 'secundario_modeled' }),
        viaje('BOO-8', 'cancelado'),
      ],
    ]);
    expect(json.viajes).toMatchObject({
      entregados: 5,
      en_curso: 2,
      certificados: {
        primario_verificable: 1,
        secundario_modeled: 2,
        secundario_default: 1,
        sin_certificado: 1,
      },
    });
    const ultimos = (json.viajes as { ultimos: Record<string, unknown>[] }).ultimos;
    expect(ultimos).toHaveLength(8);
    expect(ultimos[2]).toEqual({
      codigo_seguimiento: 'BOO-3',
      estado: 'entregado',
      entregado_en: '2026-10-20T18:00:00.000Z',
      nivel_certificacion: 'primario_verificable',
      certificado_emitido: true,
      presentacion_certificado: 'primario',
    });
  });

  it('cuenta los certificados por presentación: quién midió la distancia (ADR-091)', async () => {
    const emitido = { certificateIssuedAt: new Date('2026-10-20T18:05:00Z') };
    const modelado = { ...emitido, certificationLevel: 'secundario_modeled' };
    const { json } = await ficha([
      [DETALLE],
      can(),
      [
        viaje('BOO-1', 'entregado', { ...emitido, certificationLevel: 'primario_verificable' }),
        viaje('BOO-2', 'entregado', {
          ...modelado,
          routeDataSource: 'teltonika_gps',
          coveragePct: '96.40',
        }),
        viaje('BOO-3', 'entregado', {
          ...modelado,
          routeDataSource: 'teltonika_gps',
          coveragePct: '80.00',
        }),
        viaje('BOO-4', 'entregado', {
          ...modelado,
          routeDataSource: 'teltonika_gps',
          coveragePct: '79.99',
        }),
        viaje('BOO-5', 'entregado', {
          ...modelado,
          routeDataSource: 'maps_directions',
          coveragePct: '0.00',
        }),
        viaje('BOO-6', 'entregado', {
          ...modelado,
          routeDataSource: 'movil_gps',
          coveragePct: '99.00',
        }),
        viaje('BOO-7', 'entregado', { ...modelado }),
        viaje('BOO-8', 'entregado', {
          certificationLevel: 'secundario_modeled',
          routeDataSource: 'teltonika_gps',
          coveragePct: '99.00',
        }),
      ],
    ]);
    const viajes = json.viajes as {
      certificados: Record<string, unknown>;
      ultimos: { codigo_seguimiento: string; presentacion_certificado: string | null }[];
    };
    expect(viajes.certificados.por_presentacion).toEqual({
      primario: 1,
      medido_teltonika: 2,
      estimado: 4,
    });
    expect(viajes.certificados.sin_certificado).toBe(1);
    expect(viajes.ultimos.map((u) => u.presentacion_certificado)).toEqual([
      'primario',
      'medido_teltonika',
      'medido_teltonika',
      'estimado',
      'estimado',
      'estimado',
      'estimado',
      null,
    ]);
  });

  it('muestra solo los 10 viajes más recientes, y los cuenta todos', async () => {
    const quince = Array.from({ length: 15 }, (_, i) => viaje(`BOO-${i}`, 'entregado'));
    const { json } = await ficha([[DETALLE], can(), quince]);
    const viajes = json.viajes as { entregados: number; ultimos: unknown[] };
    expect(viajes.entregados).toBe(15);
    expect(viajes.ultimos).toHaveLength(10);
  });

  it('deja registro de quién consultó la ficha', async () => {
    await ficha([[DETALLE], can(), []]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ adminEmail: ADMIN_EMAIL, vehiculoId: VEHICULO }),
      expect.any(String),
    );
    expect(counterAdd).toHaveBeenCalledWith(1, { vista: 'ficha' });
  });
});
