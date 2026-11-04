import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import {
  abrirDisputa,
  calcularFloatActual,
  conciliarMandatoCobro,
  leerPagoDelGenerador,
  leerPagoViaje,
  listarPagosMandato,
  registrarEventoPago,
  registrarRecepcionConforme,
} from './eventos-pago.js';

/**
 * Fake de Drizzle por cola: cada `select()` toma el siguiente resultado de la
 * cola y la cadena (from/where/join/orderBy/limit/for) es "thenable". Cubre
 * la lógica del servicio; el SQL real (trigger, índices, joins) lo verifica
 * `test/integration/mandato-cobro.integration.test.ts` contra Postgres.
 */
function fakeDb(resultados: unknown[][]) {
  const cola = [...resultados];
  const insertados: unknown[] = [];
  const cadena = (valor: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for']) {
      c[m] = () => c;
    }
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(valor).then(resolve, reject);
    return c;
  };
  const db = {
    insertados,
    pendientes: () => cola.length,
    select: vi.fn(() => cadena(cola.shift() ?? [])),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertados.push(v);
        return Promise.resolve([]);
      },
    })),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => await cb(db)),
  };
  return db;
}

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const ASG = '11111111-1111-4111-8111-111111111111';
const ADELANTO = '22222222-2222-4222-8222-222222222222';
const DIA = 86_400_000;
const T0 = new Date('2026-10-01T12:00:00Z');

const LIQ_MANDATO = {
  modoFlujo: 'mandato_cobro',
  precioTransportistaClp: 1_000_000,
  totalFacturaGeneradorClp: 238_000,
  configFila: CONFIGURACION_COMERCIAL_INICIAL,
};
const LIQ_CONECTOR = { ...LIQ_MANDATO, modoFlujo: 'conector' };

const fila = (tipo: string, dia: number, montoClp: number | null = null) => ({
  tipo,
  montoClp,
  ocurridoEn: new Date(T0.getTime() + dia * DIA),
  evidenciaTipo: 'x',
  evidenciaRef: 'ref',
  detalle: null,
  registradoPor: 'admin@x.cl',
});
const RECEPCION = fila('recepcion_conforme', 0);

const deps = (db: ReturnType<typeof fakeDb>, topeFloatClp = 0) => ({
  db: db as never,
  logger,
  topeFloatClp,
});

const input = (over: Partial<Parameters<typeof registrarEventoPago>[1]> = {}) => ({
  asignacionId: ASG,
  tipo: 'cobro_registrado' as const,
  montoClp: 1_238_000,
  evidenciaRef: 'abono-1',
  ocurridoEn: new Date(T0.getTime() + 30 * DIA),
  registradoPor: 'admin@x.cl',
  ...over,
});

describe('registrarEventoPago', () => {
  it('sin liquidación → liquidacion_no_encontrada', async () => {
    const db = fakeDb([[], []]);
    expect(await registrarEventoPago(deps(db), input())).toEqual({
      ok: false,
      code: 'liquidacion_no_encontrada',
    });
  });

  it('liquidación conector → no_es_mandato, sin insertar', async () => {
    const db = fakeDb([[], [LIQ_CONECTOR], []]);
    expect(await registrarEventoPago(deps(db), input())).toEqual({
      ok: false,
      code: 'no_es_mandato',
    });
    expect(db.insertados).toEqual([]);
  });

  it('cobro con el monto esperado: inserta con evidencia fija y devuelve la vista', async () => {
    const db = fakeDb([
      [],
      [LIQ_MANDATO],
      [RECEPCION],
      [LIQ_MANDATO],
      [RECEPCION, fila('cobro_registrado', 30, 1_238_000)],
      [],
    ]);
    const r = await registrarEventoPago(deps(db), input());
    expect(r.ok).toBe(true);
    expect(db.insertados[0]).toMatchObject({
      tipo: 'cobro_registrado',
      evidenciaTipo: 'abono_bancario',
      evidenciaRef: 'abono-1',
      montoClp: 1_238_000,
    });
    if (r.ok) {
      expect(r.pago.cobro.estado).toBe('cobrado');
      expect(r.pago.montos_esperados).toEqual({ cobro_clp: 1_238_000, liberacion_clp: 1_000_000 });
      expect(r.pago.cobro.vence_en).toBe(new Date(T0.getTime() + 30 * DIA).toISOString());
    }
  });

  it('transición inválida → código de la máquina de estados', async () => {
    const db = fakeDb([[], [LIQ_MANDATO], []]);
    expect(await registrarEventoPago(deps(db), input())).toEqual({
      ok: false,
      code: 'sin_recepcion_conforme',
    });
  });

  it('liberación sobre el tope → tope_float_excedido con el disponible; toma el lock global', async () => {
    const db = fakeDb([[], [LIQ_MANDATO], [RECEPCION], []]);
    const r = await registrarEventoPago(
      deps(db, 500_000),
      input({ tipo: 'liberacion_booster', montoClp: 1_000_000, evidenciaRef: 'trf-1' }),
    );
    expect(r).toEqual({ ok: false, code: 'tope_float_excedido', disponibleClp: 500_000 });
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.insertados).toEqual([]);
  });

  it('liberación dentro del tope → inserta y publica el float', async () => {
    const db = fakeDb([
      [],
      [LIQ_MANDATO],
      [RECEPCION],
      [],
      [LIQ_MANDATO],
      [RECEPCION, fila('liberacion_booster', 5, 1_000_000)],
      [
        { asignacionId: ASG, tipo: 'recepcion_conforme', montoClp: null, ocurridoEn: T0 },
        {
          asignacionId: ASG,
          tipo: 'liberacion_booster',
          montoClp: 1_000_000,
          ocurridoEn: new Date(T0.getTime() + 5 * DIA),
        },
      ],
    ]);
    const r = await registrarEventoPago(
      deps(db, 2_000_000),
      input({
        tipo: 'liberacion_booster',
        montoClp: 1_000_000,
        evidenciaRef: 'trf-1',
        ocurridoEn: new Date(T0.getTime() + 5 * DIA),
      }),
    );
    expect(r.ok).toBe(true);
    expect(db.pendientes()).toBe(0);
  });

  it('anticipo: referencia que no es uuid o adelanto no desembolsado → adelanto_invalido', async () => {
    const noUuid = fakeDb([[], [LIQ_MANDATO], [RECEPCION]]);
    expect(
      await registrarEventoPago(
        deps(noUuid),
        input({ tipo: 'anticipo_operador', montoClp: 900_000, evidenciaRef: 'no-uuid' }),
      ),
    ).toEqual({ ok: false, code: 'adelanto_invalido' });
    const sinFila = fakeDb([[], [LIQ_MANDATO], [RECEPCION], []]);
    expect(
      await registrarEventoPago(
        deps(sinFila),
        input({ tipo: 'anticipo_operador', montoClp: 900_000, evidenciaRef: ADELANTO }),
      ),
    ).toEqual({ ok: false, code: 'adelanto_invalido' });
  });

  it('anticipo con el monto del adelanto desembolsado → anticipado_por_operador', async () => {
    const db = fakeDb([
      [],
      [LIQ_MANDATO],
      [RECEPCION],
      [{ montoAdelantadoClp: 900_000 }],
      [LIQ_MANDATO],
      [RECEPCION, fila('anticipo_operador', 2, 900_000)],
    ]);
    const r = await registrarEventoPago(
      deps(db),
      input({
        tipo: 'anticipo_operador',
        montoClp: 900_000,
        evidenciaRef: ADELANTO,
        ocurridoEn: new Date(T0.getTime() + 2 * DIA),
      }),
    );
    expect(r.ok && r.pago.liberacion.estado).toBe('anticipado_por_operador');
  });

  it('liquidación v2 sin precios v3: montos esperados en 0 y plazos por omisión', async () => {
    const db = fakeDb([
      [{ ...LIQ_MANDATO, precioTransportistaClp: null, configFila: null }],
      [RECEPCION],
    ]);
    const pago = await leerPagoViaje(db as never, ASG);
    expect(pago?.montos_esperados).toEqual({ cobro_clp: 0, liberacion_clp: 0 });
    expect(pago?.liberacion.vence_en).toBe(new Date(T0.getTime() + 5 * DIA).toISOString());
  });

  it('si la liquidación desaparece dentro de la transacción, lanza', async () => {
    const db = fakeDb([[], [LIQ_MANDATO], [RECEPCION], [], []]);
    await expect(
      registrarEventoPago(deps(db), input({ tipo: 'disputa_abierta', montoClp: null })),
    ).rejects.toThrow(/desapareció/);
  });
});

describe('registrarRecepcionConforme', () => {
  const base = {
    tripId: 'trip-1',
    generadorEmpresaId: 'gen-1',
    registradoPor: 'g@x.cl',
  };

  it('viaje ajeno, sin asignación o no entregado', async () => {
    const asegurar = vi.fn(async () => undefined);
    expect(
      await registrarRecepcionConforme(deps(fakeDb([[]])), {
        ...base,
        asegurarLiquidacion: asegurar,
      }),
    ).toEqual({ ok: false, code: 'viaje_no_encontrado' });
    expect(
      await registrarRecepcionConforme(
        deps(fakeDb([[{ status: 'entregado', asignacionId: null }]])),
        {
          ...base,
          asegurarLiquidacion: asegurar,
        },
      ),
    ).toEqual({ ok: false, code: 'sin_asignacion' });
    expect(
      await registrarRecepcionConforme(
        deps(fakeDb([[{ status: 'en_proceso', asignacionId: ASG }]])),
        {
          ...base,
          asegurarLiquidacion: asegurar,
        },
      ),
    ).toEqual({ ok: false, code: 'viaje_no_entregado' });
    expect(asegurar).not.toHaveBeenCalled();
  });

  it('asegura la liquidación; sin liquidación o conector no registra', async () => {
    const asegurar = vi.fn(async () => undefined);
    const sinLiq = fakeDb([[{ status: 'entregado', asignacionId: ASG }], []]);
    expect(
      await registrarRecepcionConforme(deps(sinLiq), { ...base, asegurarLiquidacion: asegurar }),
    ).toEqual({ ok: false, code: 'liquidacion_no_encontrada' });
    expect(asegurar).toHaveBeenCalledTimes(1);
    const conector = fakeDb([[{ status: 'entregado', asignacionId: ASG }], [LIQ_CONECTOR], []]);
    expect(
      await registrarRecepcionConforme(deps(conector), { ...base, asegurarLiquidacion: asegurar }),
    ).toEqual({ ok: false, code: 'no_es_mandato' });
  });

  it('ya recibida → idempotente; sin documento → sin_documento', async () => {
    const asegurar = vi.fn(async () => undefined);
    const yaRecibida = fakeDb([
      [{ status: 'entregado', asignacionId: ASG }],
      [LIQ_MANDATO],
      [RECEPCION],
    ]);
    const r = await registrarRecepcionConforme(deps(yaRecibida), {
      ...base,
      asegurarLiquidacion: asegurar,
    });
    expect(r.ok).toBe(true);
    expect(yaRecibida.insertados).toEqual([]);
    const sinDoc = fakeDb([[{ status: 'entregado', asignacionId: ASG }], [LIQ_MANDATO], [], []]);
    expect(
      await registrarRecepcionConforme(deps(sinDoc), { ...base, asegurarLiquidacion: asegurar }),
    ).toEqual({ ok: false, code: 'sin_documento' });
  });

  it('con documento: registra la recepción con el documento como evidencia', async () => {
    const db = fakeDb([
      [{ status: 'entregado', asignacionId: ASG }],
      [LIQ_MANDATO],
      [],
      [{ id: 'doc-1' }],
      [],
      [LIQ_MANDATO],
      [],
      [LIQ_MANDATO],
      [RECEPCION],
    ]);
    const r = await registrarRecepcionConforme(deps(db), {
      ...base,
      asegurarLiquidacion: async () => undefined,
    });
    expect(r.ok).toBe(true);
    expect(db.insertados[0]).toMatchObject({
      tipo: 'recepcion_conforme',
      evidenciaTipo: 'confirmacion_generador',
      evidenciaRef: 'doc-1',
    });
  });

  it('carrera: otra confirmación ganó → devuelve el estado vigente', async () => {
    const db = fakeDb([
      [{ status: 'entregado', asignacionId: ASG }],
      [LIQ_MANDATO],
      [],
      [{ id: 'doc-1' }],
      [],
      [LIQ_MANDATO],
      [RECEPCION],
      [LIQ_MANDATO],
      [RECEPCION],
    ]);
    const r = await registrarRecepcionConforme(deps(db), {
      ...base,
      asegurarLiquidacion: async () => undefined,
    });
    expect(r.ok).toBe(true);
    expect(db.insertados).toEqual([]);
  });
});

describe('vistas del generador y disputa', () => {
  it('leerPagoDelGenerador: null si el viaje no es suyo o no tiene asignación', async () => {
    expect(await leerPagoDelGenerador(fakeDb([[]]) as never, 't', 'g')).toBeNull();
    expect(
      await leerPagoDelGenerador(
        fakeDb([[{ status: 'asignado', asignacionId: null }]]) as never,
        't',
        'g',
      ),
    ).toBeNull();
    const pago = await leerPagoDelGenerador(
      fakeDb([[{ status: 'entregado', asignacionId: ASG }], [LIQ_MANDATO], [RECEPCION]]) as never,
      't',
      'g',
    );
    expect(pago?.liberacion.estado).toBe('pendiente');
  });

  it('abrirDisputa: viaje ajeno, sin asignación, o registra la objeción con el motivo', async () => {
    const d = { tripId: 't', generadorEmpresaId: 'g', userId: 'u-1', motivo: 'Llegó dañada' };
    expect(await abrirDisputa(deps(fakeDb([[]])), d)).toEqual({
      ok: false,
      code: 'viaje_no_encontrado',
    });
    expect(
      await abrirDisputa(deps(fakeDb([[{ status: 'entregado', asignacionId: null }]])), d),
    ).toEqual({ ok: false, code: 'sin_asignacion' });
    const db = fakeDb([
      [{ status: 'entregado', asignacionId: ASG }],
      [],
      [LIQ_MANDATO],
      [RECEPCION],
      [LIQ_MANDATO],
      [RECEPCION, fila('disputa_abierta', 1)],
    ]);
    const r = await abrirDisputa(deps(db), d);
    expect(r.ok && r.pago.liberacion.estado).toBe('disputa');
    expect(db.insertados[0]).toMatchObject({
      tipo: 'disputa_abierta',
      evidenciaTipo: 'objecion_generador',
      evidenciaRef: 'u-1',
      detalle: 'Llegó dañada',
    });
  });
});

describe('float, conciliación y listado', () => {
  it('calcularFloatActual agrupa por viaje y suma lo liberado sin cobro', async () => {
    const db = fakeDb([
      [
        { asignacionId: 'a', tipo: 'recepcion_conforme', montoClp: null, ocurridoEn: T0 },
        { asignacionId: 'a', tipo: 'liberacion_booster', montoClp: 700_000, ocurridoEn: T0 },
        { asignacionId: 'b', tipo: 'recepcion_conforme', montoClp: null, ocurridoEn: T0 },
      ],
    ]);
    expect(await calcularFloatActual(db as never)).toBe(700_000);
  });

  it('listarPagosMandato adjunta código y empresas; omite filas sin liquidación', async () => {
    const db = fakeDb([
      [
        { asignacionId: ASG, trackingCode: 'ABC', generador: 'Gen', transportista: 'Tra' },
        { asignacionId: 'otra', trackingCode: 'XYZ', generador: 'G', transportista: 'T' },
      ],
      [LIQ_MANDATO],
      [RECEPCION],
      [],
    ]);
    const filas = await listarPagosMandato(db as never);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tracking_code: 'ABC',
      generador: 'Gen',
      transportista: 'Tra',
    });
  });

  it('conciliación: registra mora vencida, cuenta liberaciones vencidas y porcentajes del mes', async () => {
    const ahora = new Date('2026-10-31T23:00:00Z');
    const recepcion = { ...RECEPCION, ocurridoEn: new Date('2026-10-01T00:00:00Z') };
    const db = fakeDb([
      [{ asignacionId: ASG }, { asignacionId: 'sin-liq' }],
      // viaje ASG: contexto
      [LIQ_MANDATO],
      [recepcion],
      // registrarEventoPago(mora): lock, contexto, re-lectura
      [],
      [LIQ_MANDATO],
      [recepcion],
      [LIQ_MANDATO],
      [recepcion, { ...fila('mora_registrada', 30), ocurridoEn: ahora }],
      // viaje sin liquidación
      [],
      // float final
      [],
    ]);
    const r = await conciliarMandatoCobro({ ...deps(db), ahora: () => ahora });
    expect(r).toEqual({
      morasRegistradas: 1,
      liberacionesVencidas: 1,
      floatClp: 0,
      moraPctMes: 100,
      anticiposPctMes: 0,
      viajesEnMandato: 2,
    });
    expect(db.insertados[0]).toMatchObject({
      tipo: 'mora_registrada',
      evidenciaTipo: 'vencimiento_plazo',
      registradoPor: 'sistema',
    });
  });

  it('conciliación sin viajes: porcentajes en 0', async () => {
    const db = fakeDb([[], []]);
    expect(await conciliarMandatoCobro({ ...deps(db) })).toMatchObject({
      morasRegistradas: 0,
      moraPctMes: 0,
      anticiposPctMes: 0,
      viajesEnMandato: 0,
    });
  });
});
