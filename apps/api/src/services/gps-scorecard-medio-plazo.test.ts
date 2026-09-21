import { describe, expect, it } from 'vitest';
import {
  type AsignacionCerradaFila,
  COMPUERTA_FLOTA_TELTONIKA_PCT,
  COMPUERTA_GAPS_LARGOS_PCT,
  COMPUERTA_MEDIANA_COBERTURA_PCT,
  type DualViaje,
  EDAD_MAX_POSICION_MS,
  type EvaluacionTelefonoViaje,
  GAP_LARGO_MS,
  GAP_P0_MS,
  type HechoVehiculoFlota,
  MUESTRA_MIN_VIAJES_PROD,
  PRECISION_MAX_M,
  type PosicionTelefono,
  VENTANA_COBERTURA_MS,
  anclasScorecard,
  armarViajesScorecard,
  coberturaPorMarcas,
  contarGapsSinPosicion,
  decidirScorecardGps,
  edadRecepcionMs,
  emitirMetricasScorecardGps,
  esEmpresaCohorteProd,
  esPosicionTelefonoUsable,
  esPuntoFresco,
  evaluarViajeTelefono,
  intervaloActivoViaje,
  mediana,
  percentilNearestRank,
  resumirEvaluacionesTelefono,
  resumirFlotaTeltonika,
  trocear,
} from './gps-scorecard-medio-plazo.js';

const MIN = 60_000;
const DIA = 86_400_000;

function pos(timestampMs: number, precisionM: number | null, edadMs = 1_000): PosicionTelefono {
  return { timestampMs, precisionM, edadMs };
}

function evaluacion(
  viajeId: string,
  coberturaPct: number,
  gapsSobre5Min = 0,
  gapsSobre15Min = 0,
  dual: DualViaje = { viajeId, estado: 'sin_par' },
): EvaluacionTelefonoViaje {
  return {
    viajeId,
    coberturaPct,
    activoMs: 10 * MIN,
    cubiertoMs: (coberturaPct / 100) * 10 * MIN,
    ventanas: 5,
    ventanasCubiertas: 0,
    gapsSobre5Min,
    gapsSobre15Min,
    tieneGapSobre5Min: gapsSobre5Min > 0,
    tieneGapSobre15Min: gapsSobre15Min > 0,
    dual,
  };
}

describe('intervalo activo', () => {
  it('arranca en la recogida y termina en la entrega o la cancelación, lo que ocurra antes', () => {
    expect(
      intervaloActivoViaje({ recogidoEnMs: 10, entregadoEnMs: 50, canceladoEnMs: null }),
    ).toEqual({ inicioMs: 10, finMs: 50 });
    expect(
      intervaloActivoViaje({ recogidoEnMs: 10, entregadoEnMs: null, canceladoEnMs: 40 }),
    ).toEqual({ inicioMs: 10, finMs: 40 });
    expect(
      intervaloActivoViaje({ recogidoEnMs: 10, entregadoEnMs: 80, canceladoEnMs: 30 }),
    ).toEqual({ inicioMs: 10, finMs: 30 });
  });

  it('no mide un viaje sin recogida, sin cierre, o de duración nula', () => {
    expect(
      intervaloActivoViaje({ recogidoEnMs: null, entregadoEnMs: 10, canceladoEnMs: null }),
    ).toBeNull();
    expect(
      intervaloActivoViaje({ recogidoEnMs: 10, entregadoEnMs: null, canceladoEnMs: null }),
    ).toBeNull();
    expect(
      intervaloActivoViaje({ recogidoEnMs: 10, entregadoEnMs: 10, canceladoEnMs: null }),
    ).toBeNull();
    expect(
      intervaloActivoViaje({ recogidoEnMs: 20, entregadoEnMs: 10, canceladoEnMs: null }),
    ).toBeNull();
  });
});

describe('posición usable del teléfono', () => {
  it('exige precisión en (0, 50] m y edad ≤ 90 s', () => {
    expect(esPosicionTelefonoUsable(pos(0, PRECISION_MAX_M, EDAD_MAX_POSICION_MS))).toBe(true);
    expect(esPosicionTelefonoUsable(pos(0, PRECISION_MAX_M, -1_000))).toBe(true);
    expect(esPosicionTelefonoUsable(pos(0, PRECISION_MAX_M + 0.01, 1))).toBe(false);
    expect(esPosicionTelefonoUsable(pos(0, 0, 1))).toBe(false);
    expect(esPosicionTelefonoUsable(pos(0, null, 1))).toBe(false);
    expect(esPosicionTelefonoUsable(pos(0, 10, EDAD_MAX_POSICION_MS + 1))).toBe(false);
    expect(esPosicionTelefonoUsable(pos(Number.NaN, 10, 1))).toBe(false);
    expect(esPosicionTelefonoUsable(pos(0, Number.NaN, 1))).toBe(false);
  });

  it('la edad de recepción es recibido menos device, y puede ser negativa', () => {
    expect(edadRecepcionMs(1_000, 1_500)).toBe(500);
    expect(edadRecepcionMs(2_000, 1_000)).toBe(-1_000);
  });
});

describe('cobertura por ventanas de 2 min', () => {
  const fin = 10 * MIN;

  it('acredita la ventana que contiene el fix y pesa el tramo parcial por su duración', () => {
    const tres = evaluarViajeTelefono({
      viajeId: 't',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [pos(10_000, 20), pos(130_000, 20), pos(250_000, 20)],
      puntosTeltonika: null,
    });
    expect(tres.ventanas).toBe(5);
    expect(tres.ventanasCubiertas).toBe(3);
    expect(tres.coberturaPct).toBe(60);

    const parcial = coberturaPorMarcas({ inicioMs: 0, finMs: 250_000 }, [245_000]);
    expect(parcial.activoMs).toBe(250_000);
    expect(parcial.cubiertoMs).toBe(10_000);
    expect(parcial.pct).toBe(4);
  });

  it('el borde de ventana cae en la siguiente, y el instante final cae en la última', () => {
    const borde = coberturaPorMarcas({ inicioMs: 0, finMs: 2 * VENTANA_COBERTURA_MS }, [
      VENTANA_COBERTURA_MS,
    ]);
    expect(borde.ventanasCubiertas).toBe(1);
    expect(borde.pct).toBe(50);

    const cierre = coberturaPorMarcas({ inicioMs: 0, finMs: VENTANA_COBERTURA_MS }, [
      VENTANA_COBERTURA_MS,
    ]);
    expect(cierre.pct).toBe(100);
  });

  it('alinea las ventanas al arranque del viaje, no al reloj', () => {
    const inicio = 50_000;
    const cobertura = coberturaPorMarcas(
      { inicioMs: inicio, finMs: inicio + 2 * VENTANA_COBERTURA_MS },
      [inicio + VENTANA_COBERTURA_MS - 1, inicio + VENTANA_COBERTURA_MS],
    );
    expect(cobertura.ventanasCubiertas).toBe(2);
    expect(cobertura.pct).toBe(100);
  });

  it('un fix cada 3 min no se evalúa con el hueco de 60 s del cierre de huella', () => {
    const cobertura = evaluarViajeTelefono({
      viajeId: 'ralo',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [pos(0, 10), pos(180_000, 10), pos(360_000, 10), pos(540_000, 10)],
      puntosTeltonika: null,
    });
    expect(cobertura.coberturaPct).toBe(80);
    expect(cobertura.ventanasCubiertas).toBe(4);
  });

  it('ignora precisión mala, edad vencida y marcas fuera del tramo', () => {
    const cobertura = evaluarViajeTelefono({
      viajeId: 'filtro',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [
        pos(10_000, 20, EDAD_MAX_POSICION_MS),
        pos(130_000, 20, EDAD_MAX_POSICION_MS + 1),
        pos(250_000, null),
        pos(-1, 10),
        pos(fin + 1, 10),
      ],
      puntosTeltonika: null,
    });
    expect(cobertura.coberturaPct).toBe(20);
    expect(cobertura.ventanasCubiertas).toBe(1);
  });

  it('rechaza un intervalo vacío', () => {
    expect(() => coberturaPorMarcas({ inicioMs: 5, finMs: 5 }, [])).toThrow(
      'intervalo activo invalido',
    );
    expect(() => contarGapsSinPosicion({ inicioMs: 5, finMs: 4 }, [])).toThrow(
      'intervalo activo invalido',
    );
  });
});

describe('gaps largos', () => {
  it('cuenta el hueco de punta a punta, y un punto no usable no lo rellena', () => {
    const hueco = evaluarViajeTelefono({
      viajeId: 'hueco',
      intervalo: { inicioMs: 0, finMs: 20 * MIN },
      posicionesTelefono: [pos(0, 10), pos(10 * MIN, 80), pos(20 * MIN, 10)],
      puntosTeltonika: null,
    });
    expect(hueco.gapsSobre5Min).toBe(1);
    expect(hueco.gapsSobre15Min).toBe(1);
    expect(hueco.tieneGapSobre5Min).toBe(true);
    expect(hueco.tieneGapSobre15Min).toBe(true);
  });

  it('el umbral es estricto: 5 min no cuenta, 5 min + 1 ms sí; 15 min es P0', () => {
    const justo = evaluarViajeTelefono({
      viajeId: 'justo',
      intervalo: { inicioMs: 0, finMs: GAP_LARGO_MS },
      posicionesTelefono: [],
      puntosTeltonika: null,
    });
    expect(justo.gapsSobre5Min).toBe(0);

    const pasa = evaluarViajeTelefono({
      viajeId: 'pasa',
      intervalo: { inicioMs: 0, finMs: GAP_LARGO_MS + 1 },
      posicionesTelefono: [],
      puntosTeltonika: null,
    });
    expect(pasa.gapsSobre5Min).toBe(1);
    expect(pasa.gapsSobre15Min).toBe(0);

    const p0 = evaluarViajeTelefono({
      viajeId: 'p0',
      intervalo: { inicioMs: 0, finMs: GAP_P0_MS + 1 },
      posicionesTelefono: [],
      puntosTeltonika: null,
    });
    expect(p0.gapsSobre5Min).toBe(1);
    expect(p0.gapsSobre15Min).toBe(1);
  });

  it('un viaje de 4 min sin puntos no es gap largo, y dos huecos se cuentan aparte', () => {
    const corto = evaluarViajeTelefono({
      viajeId: 'corto',
      intervalo: { inicioMs: 0, finMs: 4 * MIN },
      posicionesTelefono: [],
      puntosTeltonika: null,
    });
    expect(corto.coberturaPct).toBe(0);
    expect(corto.gapsSobre5Min).toBe(0);

    const dos = evaluarViajeTelefono({
      viajeId: 'dos',
      intervalo: { inicioMs: 0, finMs: 22 * MIN },
      posicionesTelefono: [pos(6 * MIN, 10)],
      puntosTeltonika: null,
    });
    expect(dos.gapsSobre5Min).toBe(2);
    expect(dos.gapsSobre15Min).toBe(1);
  });
});

describe('percentiles y compuertas del teléfono', () => {
  it('mediana par/impar y p10 nearest-rank', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([10, 30, 20])).toBe(20);
    expect(mediana([10, 20])).toBe(15);
    expect(percentilNearestRank([], 10)).toBeNull();
    expect(percentilNearestRank([0, 10, 20, 30, 40, 50, 60, 70, 80, 90], 10)).toBe(0);
    const treinta = Array.from({ length: 30 }, (_, i) => i);
    expect(percentilNearestRank(treinta, 10)).toBe(2);
    expect(percentilNearestRank([1, 2, 3], 100)).toBe(3);
    expect(() => percentilNearestRank([1], 0)).toThrow('percentil fuera de rango');
  });

  it('la compuerta de cobertura exige n ≥ 30 y mediana ≥ 85', () => {
    const justo = resumirEvaluacionesTelefono([
      ...Array.from({ length: 15 }, (_, i) => evaluacion(`a${i}`, 80)),
      ...Array.from({ length: 15 }, (_, i) => evaluacion(`b${i}`, 90)),
    ]);
    expect(justo.cobertura.medianaPct).toBe(COMPUERTA_MEDIANA_COBERTURA_PCT);
    expect(justo.cobertura.compuerta).toBe('cumple');
    expect(justo.cobertura.viajes).toBe(MUESTRA_MIN_VIAJES_PROD);

    const debajo = resumirEvaluacionesTelefono([
      ...Array.from({ length: 16 }, (_, i) => evaluacion(`a${i}`, 80)),
      ...Array.from({ length: 14 }, (_, i) => evaluacion(`b${i}`, 90)),
    ]);
    expect(debajo.cobertura.medianaPct).toBe(80);
    expect(debajo.cobertura.compuerta).toBe('no_cumple');

    const chica = resumirEvaluacionesTelefono(
      Array.from({ length: 29 }, (_, i) => evaluacion(`c${i}`, 100)),
    );
    expect(chica.cobertura.compuerta).toBe('muestra_insuficiente');
    expect(chica.cobertura.p10Pct).toBe(100);
  });

  it('la compuerta de gaps es estrictamente < 15 % de viajes, y suma los P0', () => {
    const pasa = resumirEvaluacionesTelefono([
      ...Array.from({ length: 4 }, (_, i) => evaluacion(`g${i}`, 90, 1, 0)),
      ...Array.from({ length: 26 }, (_, i) => evaluacion(`ok${i}`, 90)),
    ]);
    expect(pasa.gaps.pctViajesConGapSobre5Min).toBeCloseTo((4 / 30) * 100);
    expect(pasa.gaps.compuerta).toBe('cumple');

    const falla = resumirEvaluacionesTelefono([
      ...Array.from({ length: 5 }, (_, i) => evaluacion(`g${i}`, 90, 2, 1)),
      ...Array.from({ length: 25 }, (_, i) => evaluacion(`ok${i}`, 90)),
    ]);
    expect(falla.gaps.compuerta).toBe('no_cumple');
    expect(falla.gaps.gapsSobre15Min).toBe(5);
    expect(falla.gaps.viajesConGapSobre15Min).toBe(5);

    const justo = resumirEvaluacionesTelefono([
      ...Array.from({ length: 3 }, (_, i) => evaluacion(`g${i}`, 90, 1)),
      ...Array.from({ length: 17 }, (_, i) => evaluacion(`ok${i}`, 90)),
    ]);
    expect(justo.gaps.pctViajesConGapSobre5Min).toBe(COMPUERTA_GAPS_LARGOS_PCT);
    expect(justo.gaps.compuerta).toBe('no_cumple');

    expect(resumirEvaluacionesTelefono([]).gaps.compuerta).toBe('sin_viajes');
  });
});

describe('flota Teltonika', () => {
  function hecho(
    vehicleId: string,
    teltonikaImei: string | null,
    heartbeats7d: number | null,
    tuvoViaje30d = true,
  ): HechoVehiculoFlota {
    return { vehicleId, teltonikaImei, heartbeats7d, tuvoViaje30d };
  }

  it('el 40 % es device propio con ≥1 fila de telemetría en 7 días', () => {
    const diez: HechoVehiculoFlota[] = [];
    for (let i = 0; i < 10; i += 1) {
      const conDevice = i < 4;
      diez.push(hecho(`v${i}`, conDevice ? `imei-${i}` : null, conDevice ? 2 : 0));
    }
    const cumple = resumirFlotaTeltonika(diez);
    expect(cumple.pct).toBe(COMPUERTA_FLOTA_TELTONIKA_PCT);
    expect(cumple.compuerta).toBe('cumple');
    expect(cumple.vehiculosConViaje30d).toBe(10);

    const tresDeDiez: HechoVehiculoFlota[] = [];
    for (let i = 0; i < 10; i += 1) {
      const conDevice = i < 3;
      tresDeDiez.push(hecho(`t${i}`, conDevice ? `imei-${i}` : null, conDevice ? 1 : 0));
    }
    const tres = resumirFlotaTeltonika(tresDeDiez);
    expect(tres.vehiculosConDeviceYHeartbeat).toBe(3);
    expect(tres.pct).toBe(30);
    expect(tres.compuerta).toBe('no_cumple');
  });

  it('IMEI en blanco, sin viaje, o sin latido no entran al numerador', () => {
    const resumen = resumirFlotaTeltonika([
      hecho('sin-viaje', 'imei', 5, false),
      hecho('blanco', '   ', 9),
      hecho('mudo', 'imei-mudo', 0),
      hecho('vivo', 'imei-vivo', 1),
    ]);
    expect(resumen.vehiculosConViaje30d).toBe(3);
    expect(resumen.vehiculosConDeviceYHeartbeat).toBe(1);
    expect(resumen.compuerta).toBe('no_cumple');
  });

  it('no inventa 0 cuando el latido no se consultó, y no duplica un vehículo', () => {
    const incompleta = resumirFlotaTeltonika([hecho('v', 'imei', null)]);
    expect(incompleta.pct).toBeNull();
    expect(incompleta.compuerta).toBe('medicion_incompleta');
    expect(incompleta.vehiculosSinMedicionHeartbeat).toBe(1);

    const una = resumirFlotaTeltonika([hecho('v', null, null), hecho('v', null, null)]);
    expect(una.vehiculosConViaje30d).toBe(1);
    expect(una.compuerta).toBe('no_cumple');

    expect(resumirFlotaTeltonika([]).compuerta).toBe('sin_flota');
    expect(() => resumirFlotaTeltonika([hecho('v', 'a', 1), hecho('v', 'b', 1)])).toThrow(
      'hechos de flota contradictorios',
    );
    expect(() => resumirFlotaTeltonika([hecho('v', 'a', -1)])).toThrow('heartbeats7d invalido');
  });
});

describe('comparación dual y decisión', () => {
  it('compara solo cuando los dos streams tienen algún punto en el tramo', () => {
    const fin = 10 * MIN;
    const ambos = evaluarViajeTelefono({
      viajeId: 'ambos',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [
        pos(10_000, 10),
        pos(130_000, 10),
        pos(250_000, 10),
        pos(370_000, 10),
        pos(490_000, 10),
      ],
      puntosTeltonika: [
        { timestampMs: 10_000, edadMs: 1_000 },
        { timestampMs: 130_000, edadMs: 1_000 },
        { timestampMs: 250_000, edadMs: EDAD_MAX_POSICION_MS + 5 },
      ],
    });
    expect(ambos.dual.estado).toBe('comparado');
    if (ambos.dual.estado === 'comparado') {
      expect(ambos.dual.pctTiempoTelefonoUsable).toBe(100);
      expect(ambos.dual.pctTiempoTeltonikaFresco).toBe(40);
      expect(ambos.dual.deltaTeltonikaMenosTelefonoPct).toBe(-60);
    }

    const sinDevice = evaluarViajeTelefono({
      viajeId: 'tel',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [pos(10_000, 10)],
      puntosTeltonika: null,
    });
    expect(sinDevice.dual.estado).toBe('sin_par');

    const telefonoViejo = evaluarViajeTelefono({
      viajeId: 'viejo',
      intervalo: { inicioMs: 0, finMs: fin },
      posicionesTelefono: [pos(10_000, 10, EDAD_MAX_POSICION_MS + 1)],
      puntosTeltonika: [{ timestampMs: 10_000, edadMs: 1_000 }],
    });
    expect(telefonoViejo.coberturaPct).toBe(0);
    expect(telefonoViejo.dual.estado).toBe('comparado');

    expect(esPuntoFresco({ timestampMs: 1, edadMs: EDAD_MAX_POSICION_MS })).toBe(true);
    expect(esPuntoFresco({ timestampMs: 1, edadMs: EDAD_MAX_POSICION_MS + 1 })).toBe(false);

    const resumen = resumirEvaluacionesTelefono([ambos, sinDevice]);
    expect(resumen.dual.viajesComparados).toBe(1);
    expect(resumen.dual.viajesSinPar).toBe(1);
    expect(resumen.dual.medianaDeltaPct).toBe(-60);
    expect(resumen.dual.ventajaClara).toBe('lectura_humana');
  });

  it('no cambia el stack: nativo solo se considera con precondición y muestra, Teltonika queda en lectura', () => {
    const buena = resumirEvaluacionesTelefono(
      Array.from({ length: 30 }, (_, i) => evaluacion(`b${i}`, 90)),
    );
    const malaCobertura = resumirEvaluacionesTelefono([
      ...Array.from({ length: 16 }, (_, i) => evaluacion(`a${i}`, 80)),
      ...Array.from({ length: 14 }, (_, i) => evaluacion(`b${i}`, 90)),
    ]);
    const malosGaps = resumirEvaluacionesTelefono([
      ...Array.from({ length: 5 }, (_, i) => evaluacion(`g${i}`, 90, 1)),
      ...Array.from({ length: 25 }, (_, i) => evaluacion(`ok${i}`, 90)),
    ]);
    const chica = resumirEvaluacionesTelefono(
      Array.from({ length: 5 }, (_, i) => evaluacion(`c${i}`, 10, 1)),
    );
    const flotaOk = resumirFlotaTeltonika([
      { vehicleId: 'a', tuvoViaje30d: true, teltonikaImei: '1', heartbeats7d: 1 },
      { vehicleId: 'b', tuvoViaje30d: true, teltonikaImei: null, heartbeats7d: 0 },
    ]);
    const flotaNo = resumirFlotaTeltonika([
      { vehicleId: 'a', tuvoViaje30d: true, teltonikaImei: null, heartbeats7d: 0 },
    ]);

    const sinPrecondicion = decidirScorecardGps({
      cobertura: malaCobertura.cobertura,
      gaps: malaCobertura.gaps,
      flota: flotaOk,
      precondicionNavWakeLockEstable: false,
    });
    expect(sinPrecondicion.cambiaStack).toBe(false);
    expect(sinPrecondicion.sesgoEdad).toBe('subestima_si_la_cola_supera_90s');
    expect(sinPrecondicion.nativo).toBe('no_evaluar_nativo');
    expect(sinPrecondicion.teltonikaPrimero).toBe('umbral_flota_alcanzado_lectura_humana');

    expect(
      decidirScorecardGps({
        cobertura: chica.cobertura,
        gaps: chica.gaps,
        flota: flotaNo,
        precondicionNavWakeLockEstable: true,
      }).nativo,
    ).toBe('muestra_insuficiente');

    expect(
      decidirScorecardGps({
        cobertura: malaCobertura.cobertura,
        gaps: malaCobertura.gaps,
        flota: flotaNo,
        precondicionNavWakeLockEstable: true,
      }).nativo,
    ).toBe('considerar_nativo');
    expect(
      decidirScorecardGps({
        cobertura: buena.cobertura,
        gaps: malosGaps.gaps,
        flota: flotaNo,
        precondicionNavWakeLockEstable: true,
      }).nativo,
    ).toBe('considerar_nativo');
    expect(
      decidirScorecardGps({
        cobertura: buena.cobertura,
        gaps: buena.gaps,
        flota: flotaNo,
        precondicionNavWakeLockEstable: true,
      }),
    ).toMatchObject({ nativo: 'telefono_suficiente', teltonikaPrimero: 'flota_insuficiente' });
    expect(
      decidirScorecardGps({
        cobertura: buena.cobertura,
        gaps: buena.gaps,
        flota: resumirFlotaTeltonika([]),
        precondicionNavWakeLockEstable: true,
      }).teltonikaPrimero,
    ).toBe('sin_flota');
    expect(
      decidirScorecardGps({
        cobertura: buena.cobertura,
        gaps: buena.gaps,
        flota: resumirFlotaTeltonika([
          { vehicleId: 'a', tuvoViaje30d: true, teltonikaImei: '1', heartbeats7d: null },
        ]),
        precondicionNavWakeLockEstable: true,
      }).teltonikaPrimero,
    ).toBe('medicion_incompleta');
  });
});

describe('armado de filas', () => {
  const base: AsignacionCerradaFila = {
    viajeId: 'viaje-1',
    asignacionId: 'asig-1',
    vehicleId: 'veh-1',
    teltonikaImei: '860',
    esDemo: false,
    esUsuarioPrueba: false,
    recogidoEnMs: 0,
    entregadoEnMs: 10 * MIN,
    canceladoEnMs: null,
  };

  it('deja fuera demo, prueba, tramo inválido, null island y el espejo que no es IMEI propio', () => {
    const armado = armarViajesScorecard({
      asignaciones: [
        base,
        { ...base, viajeId: 'demo', asignacionId: 'asig-demo', esDemo: true },
        {
          ...base,
          viajeId: 'prueba',
          asignacionId: 'asig-prueba',
          esUsuarioPrueba: true,
          esDemo: false,
        },
        {
          ...base,
          viajeId: 'roto',
          asignacionId: 'asig-roto',
          entregadoEnMs: 0,
        },
        { ...base, viajeId: 'sin-device', asignacionId: 'asig-sin', teltonikaImei: '  ' },
      ],
      posiciones: [
        {
          asignacionId: 'asig-1',
          timestampDeviceMs: 10_000,
          timestampRecibidoMs: 11_000,
          precisionM: 12,
          lat: -33.04,
          lng: -71.62,
        },
        {
          asignacionId: 'asig-1',
          timestampDeviceMs: 130_000,
          timestampRecibidoMs: 131_000,
          precisionM: 12,
          lat: 0,
          lng: 0,
        },
        {
          asignacionId: 'asig-1',
          timestampDeviceMs: Number.NaN,
          timestampRecibidoMs: 1_000,
          precisionM: 12,
          lat: -33.04,
          lng: -71.62,
        },
        {
          asignacionId: 'asig-1',
          timestampDeviceMs: -5_000,
          timestampRecibidoMs: -4_000,
          precisionM: 12,
          lat: -33.04,
          lng: -71.62,
        },
        {
          asignacionId: 'asig-sin',
          timestampDeviceMs: 10_000,
          timestampRecibidoMs: 11_000,
          precisionM: 12,
          lat: -33.04,
          lng: -71.62,
        },
      ],
      puntosTeltonika: [
        {
          vehicleId: 'veh-1',
          timestampDeviceMs: 10_000,
          timestampRecibidoMs: 12_000,
          lat: -33.04,
          lng: -71.62,
        },
        {
          vehicleId: 'veh-1',
          timestampDeviceMs: 20_000,
          timestampRecibidoMs: 21_000,
          lat: 0,
          lng: -70,
        },
        {
          vehicleId: 'veh-1',
          timestampDeviceMs: 10 * MIN + 5,
          timestampRecibidoMs: 10 * MIN + 6,
          lat: -33.04,
          lng: -71.62,
        },
        {
          vehicleId: 'veh-1',
          timestampDeviceMs: Number.NaN,
          timestampRecibidoMs: 1_000,
          lat: -33.04,
          lng: -71.62,
        },
      ],
    });

    expect(armado.descartados).toBe(1);
    expect(armado.viajes.map((v) => v.viajeId)).toEqual(['viaje-1', 'sin-device']);
    const propio = armado.viajes[0];
    expect(propio?.posicionesTelefono).toEqual([
      { timestampMs: 10_000, precisionM: 12, edadMs: 1_000 },
    ]);
    expect(propio?.puntosTeltonika).toEqual([{ timestampMs: 10_000, edadMs: 2_000 }]);
    expect(armado.viajes[1]?.puntosTeltonika).toBeNull();
  });

  it('la empresa de cohorte es la que no es demo ni de prueba', () => {
    expect(esEmpresaCohorteProd({ esDemo: false, esUsuarioPrueba: false })).toBe(true);
    expect(esEmpresaCohorteProd({ esDemo: true, esUsuarioPrueba: false })).toBe(false);
    expect(esEmpresaCohorteProd({ esDemo: false, esUsuarioPrueba: true })).toBe(false);
  });
});

describe('anclas y troceo', () => {
  it('el piso del teléfono sigue la retención, y flota/latido usan 30 y 7 días', () => {
    const ahora = Date.parse('2026-09-21T12:00:00.000Z');
    const anclas = anclasScorecard(ahora);
    expect(anclas.pisoPosicionesMs).toBe(ahora - 30 * DIA);
    expect(anclas.flotaDesdeMs).toBe(ahora - 30 * DIA);
    expect(anclas.heartbeatDesdeMs).toBe(ahora - 7 * DIA);
    expect(() => anclasScorecard(Number.NaN)).toThrow('ahora invalido');
  });

  it('trocea ids para no armar un IN enorme', () => {
    expect(trocear(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(trocear([], 2)).toEqual([]);
    expect(() => trocear([1], 0)).toThrow('tamano de troceo invalido');
    expect(() => trocear([1], 1.5)).toThrow('tamano de troceo invalido');
  });
});

describe('métricas OTel', () => {
  function instrumentos() {
    const cobertura: number[] = [];
    const viajesGap: Array<{ n: number; umbral: string }> = [];
    const gaps: Array<{ n: number; umbral: string }> = [];
    const flota: number[] = [];
    const dual: number[] = [];
    return {
      cobertura,
      viajesGap,
      gaps,
      flota,
      dual,
      api: {
        coberturaUsablePct: { record: (value: number) => cobertura.push(value) },
        viajesConGap: {
          add: (n: number, attributes: { umbral: string }) =>
            viajesGap.push({ n, umbral: attributes.umbral }),
        },
        gapsDetectados: {
          add: (n: number, attributes: { umbral: string }) =>
            gaps.push({ n, umbral: attributes.umbral }),
        },
        flotaTeltonikaPct: { record: (value: number) => flota.push(value) },
        dualDeltaPct: { record: (value: number) => dual.push(value) },
      },
    };
  }

  it('registra cobertura, gaps y delta solo cuando el dato existe', () => {
    const inst = instrumentos();
    const conGap = evaluacion('g', 40, 2, 1, {
      viajeId: 'g',
      estado: 'comparado',
      pctTiempoTeltonikaFresco: 80,
      pctTiempoTelefonoUsable: 40,
      deltaTeltonikaMenosTelefonoPct: 40,
    });
    const limpio = evaluacion('ok', 95);
    emitirMetricasScorecardGps({ evaluaciones: [conGap, limpio], flotaPct: null }, inst.api);
    expect(inst.cobertura).toEqual([40, 95]);
    expect(inst.viajesGap).toEqual([
      { n: 1, umbral: '5min' },
      { n: 1, umbral: '15min' },
    ]);
    expect(inst.gaps).toEqual([
      { n: 2, umbral: '5min' },
      { n: 1, umbral: '15min' },
    ]);
    expect(inst.dual).toEqual([40]);
    expect(inst.flota).toEqual([]);

    emitirMetricasScorecardGps({ evaluaciones: [], flotaPct: 40 }, inst.api);
    expect(inst.flota).toEqual([40]);
  });

  it('el meter no-op no lanza', () => {
    expect(() =>
      emitirMetricasScorecardGps({
        evaluaciones: [evaluacion('ok', 90)],
        flotaPct: 10,
      }),
    ).not.toThrow();
  });
});
