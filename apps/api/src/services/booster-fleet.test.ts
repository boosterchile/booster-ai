import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { armarPanelBoosterFleet, cerrarMantencion, programarMantencion } from './booster-fleet.js';
import type { LecturaTrayectosFlota } from './listar-trayectos-teltonika.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const VEHICULO = '11111111-1111-4111-8111-111111111111';
const MANTENCION = '33333333-3333-4333-8333-333333333333';
const AHORA = new Date('2026-11-17T15:00:00.000Z');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

function cadena(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const metodo of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[metodo] = vi.fn(self);
  }
  chain.then = (resolve: (valor: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function dbCon(selects: unknown[][], extras: Record<string, unknown> = {}) {
  let i = 0;
  return {
    select: vi.fn(() => {
      const rows = selects[i] ?? [];
      i += 1;
      return cadena(rows);
    }),
    ...extras,
  };
}

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: MANTENCION,
    empresaId: EMPRESA,
    vehiculoId: VEHICULO,
    tipo: 'preventiva',
    titulo: 'Cambio de aceite',
    programadaPara: '2026-11-01',
    kilometrajeObjetivo: null,
    realizadaEn: null,
    kilometrajeRealizado: null,
    canceladaEn: null,
    notas: 'taller',
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

describe('armarPanelBoosterFleet', () => {
  it('arma el panel con la flota, sin leer telemetría dos veces', async () => {
    const db = dbCon([
      [{ timezone: 'America/Santiago' }],
      [{ id: VEHICULO, patente: 'AAAA11', estado: 'activo', teltonikaImei: null }],
      [],
      [],
      [],
      [],
    ]);
    const leer = vi.fn(async () => ({
      empresaId: EMPRESA,
      desde: '2026-11-10T15:00:00.000Z',
      hasta: AHORA.toISOString(),
      vehiculosTeltonika: 0,
      truncado: false,
      cta: 'vincular_teltonika' as const,
      ctaSensor: false,
      ctaCapacidadEstanque: false,
      vehiculos: [],
      trayectos: [],
      resumenVehiculo: null,
      coberturaDesde: '2026-11-15T12:00:00.000Z',
      puntosLeidos: 0,
      puntosEnVentana: null,
    }));
    const panel = await armarPanelBoosterFleet({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      ahora: AHORA,
      leerCombustible: leer,
    });
    expect(panel.configuracion.nombre).toBe('Booster Fleet');
    expect(panel.combustible.vehiculos[0]).toMatchObject({
      patente: 'AAAA11',
      senal: 'sin_telemetria',
    });
    expect(panel.documental.vehiculos[0]?.al_dia).toBe(false);
    expect(leer).toHaveBeenCalledOnce();
    expect(leer).toHaveBeenCalledWith(
      expect.objectContaining({ reparto: 'por_vehiculo', maxPuntos: 400_000 }),
    );
    // Sin recorte, el panel no dice desde cuándo aunque la lectura lo traiga.
    expect('cobertura_desde' in panel.combustible).toBe(false);
  });

  it('sin zona guardada usa America/Santiago y marca el tope de mantenciones', async () => {
    const db = dbCon([
      [],
      [],
      [],
      [],
      [],
      new Array(501).fill({ mantencion: fila(), patente: 'AAAA11' }),
    ]);
    const panel = await armarPanelBoosterFleet({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      ahora: AHORA,
      leerCombustible: vi.fn(async () => ({
        empresaId: EMPRESA,
        desde: AHORA.toISOString(),
        hasta: AHORA.toISOString(),
        vehiculosTeltonika: 0,
        truncado: true,
        cta: null,
        ctaSensor: false,
        ctaCapacidadEstanque: false,
        vehiculos: [],
        trayectos: [],
        resumenVehiculo: null,
        coberturaDesde: '2026-11-16T03:00:00.000Z',
        puntosLeidos: 0,
        puntosEnVentana: null,
      })),
    });
    expect(panel.mantenciones.truncadas).toBe(true);
    expect(panel.mantenciones.items).toHaveLength(500);
    expect(panel.combustible.truncado).toBe(true);
    expect(panel.combustible.cobertura_desde).toBe('2026-11-16T03:00:00.000Z');
  });

  it('traduce fechas de documentos y trayectos, y lee el combustible por defecto', async () => {
    const db = dbCon([
      [{ timezone: 'America/Santiago' }],
      [
        {
          id: VEHICULO,
          patente: 'AAAA11',
          estado: 'mantenimiento',
          teltonikaImei: 'imei',
        },
      ],
      [
        {
          duenoId: VEHICULO,
          tipo: 'revision_tecnica',
          fechaVencimiento: '2027-06-01',
        },
        {
          duenoId: VEHICULO,
          tipo: 'soap',
          fechaVencimiento: new Date(Number.NaN),
        },
      ],
      [
        {
          id: '55555555-5555-4555-8555-555555555555',
          nombre: 'Ana',
          rut: null,
          licenciaVencimiento: '2027-06-01',
        },
      ],
      [
        {
          duenoId: '55555555-5555-4555-8555-555555555555',
          tipo: 'licencia_conducir',
          fechaVencimiento: new Date('2027-06-01T12:00:00.000Z'),
        },
      ],
      [],
    ]);
    const panel = await armarPanelBoosterFleet({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      ahora: AHORA,
      leerCombustible: vi.fn(async () => ({
        empresaId: EMPRESA,
        desde: AHORA.toISOString(),
        hasta: AHORA.toISOString(),
        vehiculosTeltonika: 1,
        truncado: false,
        cta: null,
        ctaSensor: false,
        ctaCapacidadEstanque: false,
        vehiculos: [],
        trayectos: [
          {
            id: 'trayecto-1',
            inicio: '2026-11-16T10:00:00.000Z',
            fin: '2026-11-16T14:00:00.000Z',
            vehiculoId: VEHICULO,
            litrosConsumidos: 12,
            kmCubiertos: 40,
            kmPorLitro: 3,
            notaCombustible: null,
            posibleRoboCombustible: true,
            posibleRoboHormiga: false,
            eventoDesde: '2026-11-16T12:00:00.000Z',
            eventoHasta: '2026-11-16T12:04:00.000Z',
            eventoLitros: 30,
            eventLat: -33.4,
            eventLon: -70.6,
            ctaCapacidadEstanque: false,
            fuenteCombustible: 'nivel_litros',
          } as LecturaTrayectosFlota['trayectos'][number],
        ],
        resumenVehiculo: null,
        coberturaDesde: null,
        puntosLeidos: 0,
        puntosEnVentana: null,
      })),
    });
    expect(panel.combustible.litros).toBe(12);
    expect(panel.combustible.vehiculos[0]?.desviacion).toEqual({
      trayecto_id: 'trayecto-1',
      inicio: '2026-11-16T10:00:00.000Z',
      fin: '2026-11-16T14:00:00.000Z',
      tipo: 'golpe',
      desde: '2026-11-16T12:00:00.000Z',
      hasta: '2026-11-16T12:04:00.000Z',
      litros: 30,
      lat: -33.4,
      lon: -70.6,
      total: 1,
    });
    expect(panel.mantenciones.en_taller).toEqual([{ vehiculo_id: VEHICULO, patente: 'AAAA11' }]);
    expect(panel.documental.conductores[0]?.rut).toBe('');

    const porDefecto = await armarPanelBoosterFleet({
      db: dbCon([[], [], [], [], [], []]) as never,
      logger,
      empresaId: EMPRESA,
      ahora: AHORA,
    });
    expect(porDefecto.combustible.vehiculos).toEqual([]);
  });
});

describe('programarMantencion', () => {
  it('rechaza un vehículo que no es de la empresa', async () => {
    const db = dbCon([[]]);
    const resultado = await programarMantencion({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      input: {
        vehiculo_id: VEHICULO,
        tipo: 'preventiva',
        titulo: 'Aceite',
        programada_para: '2026-12-01',
        notas: undefined,
      },
      ahora: AHORA,
    });
    expect(resultado).toEqual({ ok: false, code: 'vehiculo_no_encontrado' });
  });

  it('guarda la mantención y la devuelve clasificada', async () => {
    const db = dbCon([[{ id: VEHICULO, plate: 'AAAA11' }], [{ timezone: 'America/Santiago' }]], {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [fila({ programadaPara: '2026-12-20' })]),
        })),
      })),
    });
    const resultado = await programarMantencion({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      input: {
        vehiculo_id: VEHICULO,
        tipo: 'correctiva',
        titulo: 'Freno',
        programada_para: '2026-12-20',
        kilometraje_objetivo: 10,
        notas: undefined,
      },
      ahora: AHORA,
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.mantencion).toMatchObject({
        patente: 'AAAA11',
        estado: 'programada',
        notas: 'taller',
      });
    }
  });

  it('si el insert no devuelve fila, falla en voz alta', async () => {
    const db = dbCon([[{ id: VEHICULO, plate: 'AAAA11' }]], {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
      })),
    });
    await expect(
      programarMantencion({
        db: db as never,
        logger,
        empresaId: EMPRESA,
        input: {
          vehiculo_id: VEHICULO,
          tipo: 'inspeccion',
          titulo: 'Frenos',
          programada_para: '2026-12-20',
          notas: undefined,
        },
        ahora: AHORA,
      }),
    ).rejects.toThrow(/no volvió/);
  });

  it('una fila recién creada y ya cancelada no se clasifica', async () => {
    const db = dbCon([[{ id: VEHICULO, plate: 'AAAA11' }]], {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [fila({ canceladaEn: AHORA })]),
        })),
      })),
    });
    await expect(
      programarMantencion({
        db: db as never,
        logger,
        empresaId: EMPRESA,
        input: {
          vehiculo_id: VEHICULO,
          tipo: 'preventiva',
          titulo: 'Aceite',
          programada_para: '2026-12-01',
          notas: undefined,
        },
        ahora: AHORA,
      }),
    ).rejects.toThrow(/cancelada/);
  });
});

describe('cerrarMantencion', () => {
  it('marcar realizada deja la mantención hecha', async () => {
    const db = dbCon([[{ plate: 'AAAA11' }], [{ timezone: '' }]], {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [fila({ realizadaEn: AHORA })]),
          })),
        })),
      })),
    });
    const resultado = await cerrarMantencion({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      mantencionId: MANTENCION,
      accion: 'realizar',
      kilometrajeRealizado: 80_000,
      ahora: AHORA,
    });
    expect(resultado).toMatchObject({
      ok: true,
      mantencion: { estado: 'realizada', patente: 'AAAA11' },
    });
  });

  it('cancelar la saca del panel', async () => {
    const db = dbCon([[{ plate: 'AAAA11' }], [{ timezone: 'America/Santiago' }]], {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [fila({ canceladaEn: AHORA })]),
          })),
        })),
      })),
    });
    const resultado = await cerrarMantencion({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      mantencionId: MANTENCION,
      accion: 'cancelar',
      ahora: AHORA,
    });
    expect(resultado).toEqual({ ok: true, mantencion: null });
  });

  it('distingue ya cerrada de inexistente', async () => {
    const cerrada = dbCon([[{ id: MANTENCION }]], {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
    });
    const ninguna = dbCon([[]], {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
    });
    await expect(
      cerrarMantencion({
        db: cerrada as never,
        logger,
        empresaId: EMPRESA,
        mantencionId: MANTENCION,
        accion: 'realizar',
        ahora: AHORA,
      }),
    ).resolves.toEqual({ ok: false, code: 'ya_cerrada' });
    await expect(
      cerrarMantencion({
        db: ninguna as never,
        logger,
        empresaId: EMPRESA,
        mantencionId: MANTENCION,
        accion: 'cancelar',
        ahora: AHORA,
      }),
    ).resolves.toEqual({ ok: false, code: 'no_encontrada' });
  });

  it('sin patente conocida deja el campo vacío', async () => {
    const db = dbCon([[], [{ timezone: 'America/Santiago' }]], {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [fila({ realizadaEn: AHORA })]),
          })),
        })),
      })),
    });
    const resultado = await cerrarMantencion({
      db: db as never,
      logger,
      empresaId: EMPRESA,
      mantencionId: MANTENCION,
      accion: 'realizar',
    });
    expect(resultado).toMatchObject({ ok: true, mantencion: { patente: '' } });
  });
});
