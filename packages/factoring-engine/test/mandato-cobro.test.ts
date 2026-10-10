import { describe, expect, it } from 'vitest';
import {
  ESTADO_PAGO_INICIAL,
  type EventoPago,
  TransicionPagoInvalidaError,
  calcularFloat,
  diasEntre,
  montosEsperados,
  reducirPagoViaje,
  revisarVencimientos,
  validarEvento,
  vencimientos,
  verificarTopeFloat,
} from '../src/index.js';

const DIA = 86_400_000;
const T0 = new Date('2026-10-01T15:00:00Z');
const dias = (n: number) => new Date(T0.getTime() + n * DIA);

const ev = (tipo: EventoPago['tipo'], dia: number, montoClp: number | null = null): EventoPago => ({
  tipo,
  ocurridoEn: dias(dia),
  montoClp,
});

const LIQ = { precioTransportistaClp: 1_000_000, totalFacturaGeneradorClp: 238_000 };

describe('montosEsperados (ADR-080 §1)', () => {
  it('el generador paga flete + comisión + IVA; el transportista recibe su precio íntegro', () => {
    expect(montosEsperados(LIQ)).toEqual({ cobroClp: 1_238_000, liberacionClp: 1_000_000 });
  });
});

describe('reducirPagoViaje', () => {
  it('sin eventos: ninguna línea arrancó', () => {
    expect(reducirPagoViaje([])).toEqual(ESTADO_PAGO_INICIAL);
    expect(ESTADO_PAGO_INICIAL.cobro.estado).toBe('sin_recepcion');
    expect(ESTADO_PAGO_INICIAL.liberacion.estado).toBe('sin_recepcion');
  });

  it('la recepción conforme arranca las dos líneas en pendiente', () => {
    const p = reducirPagoViaje([ev('recepcion_conforme', 0)]);
    expect(p.recepcionConformeEn).toEqual(T0);
    expect(p.cobro.estado).toBe('pendiente');
    expect(p.liberacion.estado).toBe('pendiente');
  });

  it('camino feliz: liberación por Booster al día 5 y cobro al día 30', () => {
    const p = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('liberacion_booster', 5, 1_000_000),
      ev('cobro_registrado', 30, 1_238_000),
    ]);
    expect(p.liberacion).toEqual({
      estado: 'liberado_por_booster',
      en: dias(5),
      montoClp: 1_000_000,
    });
    expect(p.cobro).toEqual({ estado: 'cobrado', en: dias(30), montoClp: 1_238_000 });
  });

  it('mora y cobro tardío; anticipo del operador', () => {
    const p = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('anticipo_operador', 2, 900_000),
      ev('mora_registrada', 30),
      ev('cobro_registrado', 41, 1_238_000),
    ]);
    expect(p.liberacion.estado).toBe('anticipado_por_operador');
    expect(p.cobro.estado).toBe('cobrado');
  });

  it('la disputa congela la liberación, no el cobro; resuelta vuelve a pendiente', () => {
    const enDisputa = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('disputa_abierta', 1),
      ev('cobro_registrado', 20, 1_238_000),
    ]);
    expect(enDisputa.liberacion.estado).toBe('disputa');
    expect(enDisputa.cobro.estado).toBe('cobrado');
    const resuelta = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('disputa_abierta', 1),
      ev('disputa_resuelta', 3),
    ]);
    expect(resuelta.liberacion.estado).toBe('pendiente');
  });

  it('una secuencia almacenada inválida no se oculta: lanza', () => {
    expect(() => reducirPagoViaje([ev('cobro_registrado', 1, 1)])).toThrow(
      TransicionPagoInvalidaError,
    );
    expect(() =>
      reducirPagoViaje([ev('recepcion_conforme', 0), ev('recepcion_conforme', 1)]),
    ).toThrow(/recepcion_duplicada/);
  });
});

describe('validarEvento', () => {
  const recibido = reducirPagoViaje([ev('recepcion_conforme', 0)]);
  const ctx = { cobroVenceEn: dias(30), montoEsperadoClp: 1_238_000 };

  it('sin recepción conforme no hay cobro, liberación, anticipo ni disputa', () => {
    for (const tipo of [
      'cobro_registrado',
      'mora_registrada',
      'liberacion_booster',
      'anticipo_operador',
      'disputa_abierta',
      'disputa_resuelta',
    ] as const) {
      expect(validarEvento(ESTADO_PAGO_INICIAL, ev(tipo, 1, 1), ctx)).toEqual({
        ok: false,
        code: 'sin_recepcion_conforme',
      });
    }
  });

  it('recepción conforme solo una vez', () => {
    expect(validarEvento(ESTADO_PAGO_INICIAL, ev('recepcion_conforme', 0), {})).toEqual({
      ok: true,
    });
    expect(validarEvento(recibido, ev('recepcion_conforme', 1), {})).toEqual({
      ok: false,
      code: 'recepcion_duplicada',
    });
  });

  it('ningún evento puede ser anterior a la recepción conforme', () => {
    expect(validarEvento(recibido, ev('cobro_registrado', -1, 1_238_000), ctx)).toEqual({
      ok: false,
      code: 'fecha_anterior_a_recepcion',
    });
  });

  it('el cobro exige el monto esperado exacto y una línea pendiente o en mora', () => {
    expect(validarEvento(recibido, ev('cobro_registrado', 10, 1_238_000), ctx)).toEqual({
      ok: true,
    });
    expect(validarEvento(recibido, ev('cobro_registrado', 10, 1_000_000), ctx)).toEqual({
      ok: false,
      code: 'monto_invalido',
    });
    expect(validarEvento(recibido, ev('cobro_registrado', 10, null), ctx)).toEqual({
      ok: false,
      code: 'monto_invalido',
    });
    const cobrado = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('cobro_registrado', 10, 1_238_000),
    ]);
    expect(validarEvento(cobrado, ev('cobro_registrado', 11, 1_238_000), ctx)).toEqual({
      ok: false,
      code: 'cobro_no_pendiente',
    });
    const enMora = reducirPagoViaje([ev('recepcion_conforme', 0), ev('mora_registrada', 30)]);
    expect(validarEvento(enMora, ev('cobro_registrado', 35, 1_238_000), ctx)).toEqual({ ok: true });
  });

  it('la mora solo después del vencimiento y sobre un cobro pendiente', () => {
    expect(validarEvento(recibido, ev('mora_registrada', 29), ctx)).toEqual({
      ok: false,
      code: 'mora_antes_de_vencer',
    });
    expect(validarEvento(recibido, ev('mora_registrada', 30), ctx)).toEqual({ ok: true });
    const enMora = reducirPagoViaje([ev('recepcion_conforme', 0), ev('mora_registrada', 30)]);
    expect(validarEvento(enMora, ev('mora_registrada', 31), ctx)).toEqual({
      ok: false,
      code: 'cobro_no_pendiente',
    });
    expect(validarEvento(recibido, ev('mora_registrada', 31), {})).toEqual({
      ok: false,
      code: 'mora_antes_de_vencer',
    });
  });

  it('liberación y anticipo: pendiente, sin disputa y con el monto esperado', () => {
    const ctxLib = { montoEsperadoClp: 1_000_000 };
    expect(validarEvento(recibido, ev('liberacion_booster', 5, 1_000_000), ctxLib)).toEqual({
      ok: true,
    });
    expect(validarEvento(recibido, ev('anticipo_operador', 5, 999), ctxLib)).toEqual({
      ok: false,
      code: 'monto_invalido',
    });
    const enDisputa = reducirPagoViaje([ev('recepcion_conforme', 0), ev('disputa_abierta', 1)]);
    expect(validarEvento(enDisputa, ev('liberacion_booster', 5, 1_000_000), ctxLib)).toEqual({
      ok: false,
      code: 'liberacion_en_disputa',
    });
    const liberado = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('liberacion_booster', 5, 1_000_000),
    ]);
    expect(validarEvento(liberado, ev('anticipo_operador', 6, 1_000_000), ctxLib)).toEqual({
      ok: false,
      code: 'liberacion_no_pendiente',
    });
  });

  it('disputa: se abre solo con la liberación pendiente; se resuelve solo si está abierta', () => {
    expect(validarEvento(recibido, ev('disputa_abierta', 1), {})).toEqual({ ok: true });
    expect(validarEvento(recibido, ev('disputa_resuelta', 1), {})).toEqual({
      ok: false,
      code: 'sin_disputa_abierta',
    });
    const enDisputa = reducirPagoViaje([ev('recepcion_conforme', 0), ev('disputa_abierta', 1)]);
    expect(validarEvento(enDisputa, ev('disputa_abierta', 2), {})).toEqual({
      ok: false,
      code: 'liberacion_en_disputa',
    });
    const liberado = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('liberacion_booster', 5, 1_000_000),
    ]);
    expect(validarEvento(liberado, ev('disputa_abierta', 6), {})).toEqual({
      ok: false,
      code: 'liberacion_no_pendiente',
    });
  });
});

describe('vencimientos y revisarVencimientos', () => {
  const plazos = { pagoGeneradorDias: 30, liberacionTransportistaDias: 5 };

  it('cuentan desde la recepción conforme', () => {
    expect(vencimientos(T0, plazos)).toEqual({
      cobroVenceEn: dias(30),
      liberacionVenceEn: dias(5),
    });
  });

  it('marca mora pendiente y liberación vencida según el reloj', () => {
    const p = reducirPagoViaje([ev('recepcion_conforme', 0)]);
    expect(revisarVencimientos(p, plazos, dias(4))).toEqual({
      requiereMora: false,
      liberacionVencida: false,
    });
    expect(revisarVencimientos(p, plazos, dias(6))).toEqual({
      requiereMora: false,
      liberacionVencida: true,
    });
    expect(revisarVencimientos(p, plazos, dias(30))).toEqual({
      requiereMora: true,
      liberacionVencida: true,
    });
    const cerrado = reducirPagoViaje([
      ev('recepcion_conforme', 0),
      ev('anticipo_operador', 1, 1),
      ev('cobro_registrado', 2, 1),
    ]);
    expect(revisarVencimientos(cerrado, plazos, dias(90))).toEqual({
      requiereMora: false,
      liberacionVencida: false,
    });
    expect(revisarVencimientos(ESTADO_PAGO_INICIAL, plazos, dias(90))).toEqual({
      requiereMora: false,
      liberacionVencida: false,
    });
  });
});

describe('float de terceros y tope (ADR-080 §6.3, Verificación 4)', () => {
  const liberadoNoCobrado = reducirPagoViaje([
    ev('recepcion_conforme', 0),
    ev('liberacion_booster', 5, 1_000_000),
  ]);
  const liberadoYCobrado = reducirPagoViaje([
    ev('recepcion_conforme', 0),
    ev('liberacion_booster', 5, 400_000),
    ev('cobro_registrado', 30, 500_000),
  ]);
  const anticipado = reducirPagoViaje([
    ev('recepcion_conforme', 0),
    ev('anticipo_operador', 5, 700_000),
  ]);

  it('float = Σ liberado por Booster con el cobro no cobrado; el anticipo del operador no cuenta', () => {
    expect(calcularFloat([liberadoNoCobrado, liberadoYCobrado, anticipado])).toBe(1_000_000);
    expect(calcularFloat([])).toBe(0);
  });

  it('tope 0 por omisión: sin decisión del PO, Booster no adelanta caja propia', () => {
    expect(
      verificarTopeFloat({ floatActualClp: 0, montoClp: 1, topeClp: 0, cobroYaCobrado: false }),
    ).toEqual({ ok: false, code: 'tope_float_excedido', disponibleClp: 0 });
  });

  it('dentro del tope pasa; sobre el tope, error explícito con el disponible', () => {
    expect(
      verificarTopeFloat({
        floatActualClp: 4_000_000,
        montoClp: 1_000_000,
        topeClp: 5_000_000,
        cobroYaCobrado: false,
      }),
    ).toEqual({ ok: true });
    expect(
      verificarTopeFloat({
        floatActualClp: 4_500_000,
        montoClp: 1_000_000,
        topeClp: 5_000_000,
        cobroYaCobrado: false,
      }),
    ).toEqual({ ok: false, code: 'tope_float_excedido', disponibleClp: 500_000 });
  });

  it('una liberación con el cobro ya cobrado no mueve el float y no se limita', () => {
    expect(
      verificarTopeFloat({
        floatActualClp: 9_000_000,
        montoClp: 1_000_000,
        topeClp: 0,
        cobroYaCobrado: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe('diasEntre', () => {
  it('días con dos decimales', () => {
    expect(diasEntre(T0, dias(5))).toBe(5);
    expect(diasEntre(T0, new Date(T0.getTime() + 1.5 * DIA))).toBe(1.5);
    expect(diasEntre(T0, new Date(T0.getTime() + DIA / 3))).toBe(0.33);
  });
});
