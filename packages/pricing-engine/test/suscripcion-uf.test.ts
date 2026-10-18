import { describe, expect, it } from 'vitest';
import { type PreciosSuscripcionUf, calcularCobroSuscripcionUf } from '../src/suscripcion-uf.js';

/** Valores iniciales de ADR-079 §4. */
const PRECIOS: PreciosSuscripcionUf = {
  transportistaUfCamionMes: 1,
  transportistaGestionFlotaUfCamionMes: 1.5,
  generadorUfEmpresaMes: 1,
  camionesSinCobro: 1,
};
const UF = 39_485.65;
const HOY = Date.UTC(2026, 9, 1, 12);

const base = {
  esGeneradorCarga: false,
  esTransportista: false,
  camionesActivos: 0,
  gestionFlota: false,
  precios: PRECIOS,
  ufValorClp: UF,
  ivaRate: 0.19,
  hoyMs: HOY,
};

describe('calcularCobroSuscripcionUf — quién paga (ADR-079 §4)', () => {
  it('generador: 1 UF por empresa, neto + IVA', () => {
    const r = calcularCobroSuscripcionUf({ ...base, esGeneradorCarga: true });
    expect(r.status).toBe('facturar');
    if (r.status !== 'facturar') {
      return;
    }
    expect(r.lineas).toEqual([
      { concepto: 'suscripcion_generador', cantidad: 1, ufUnitario: 1, montoUf: 1 },
    ]);
    expect(r.montoUf).toBe(1);
    // subtotal = round(1 × 39.485,65) = 39.486; IVA = round(39.486 × 0,19) = 7.502.
    expect(r.subtotalClp).toBe(39_486);
    expect(r.ivaClp).toBe(7_502);
    expect(r.totalClp).toBe(46_988);
    expect(r.ufValorClp).toBe(UF);
  });

  it('transportista con camiones ≤ umbral sin cobro: exento', () => {
    for (const camionesActivos of [0, 1]) {
      const r = calcularCobroSuscripcionUf({ ...base, esTransportista: true, camionesActivos });
      expect(r).toEqual({ status: 'exenta' });
    }
  });

  it('transportista base: paga los camiones sobre el umbral', () => {
    const r = calcularCobroSuscripcionUf({ ...base, esTransportista: true, camionesActivos: 4 });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.lineas).toEqual([
      { concepto: 'suscripcion_transportista', cantidad: 3, ufUnitario: 1, montoUf: 3 },
    ]);
    expect(r.montoUf).toBe(3);
    expect(r.subtotalClp).toBe(Math.round(3 * UF));
  });

  it('transportista con gestión de flota: 1,5 UF por camión cobrado', () => {
    const r = calcularCobroSuscripcionUf({
      ...base,
      esTransportista: true,
      camionesActivos: 3,
      gestionFlota: true,
    });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.lineas).toEqual([
      {
        concepto: 'suscripcion_transportista_gestion_flota',
        cantidad: 2,
        ufUnitario: 1.5,
        montoUf: 3,
      },
    ]);
  });

  it('empresa con ambos roles: una factura con las dos líneas', () => {
    const r = calcularCobroSuscripcionUf({
      ...base,
      esGeneradorCarga: true,
      esTransportista: true,
      camionesActivos: 2,
    });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.lineas.map((l) => l.concepto)).toEqual([
      'suscripcion_generador',
      'suscripcion_transportista',
    ]);
    expect(r.montoUf).toBe(2);
  });

  it('sin rol comercial: exenta', () => {
    expect(calcularCobroSuscripcionUf(base)).toEqual({ status: 'exenta' });
  });

  it('tarifa de transportista en 0: exenta aunque supere el umbral', () => {
    const r = calcularCobroSuscripcionUf({
      ...base,
      esTransportista: true,
      camionesActivos: 5,
      precios: { ...PRECIOS, transportistaUfCamionMes: 0 },
    });
    expect(r).toEqual({ status: 'exenta' });
  });

  it('precio en 0 configurado: exenta (no emite factura de $0)', () => {
    const r = calcularCobroSuscripcionUf({
      ...base,
      esGeneradorCarga: true,
      precios: { ...PRECIOS, generadorUfEmpresaMes: 0 },
    });
    expect(r).toEqual({ status: 'exenta' });
  });
});

describe('calcularCobroSuscripcionUf — aritmética', () => {
  it('monto UF a 4 decimales sin error de coma flotante', () => {
    const r = calcularCobroSuscripcionUf({
      ...base,
      esTransportista: true,
      camionesActivos: 4,
      precios: { ...PRECIOS, transportistaUfCamionMes: 0.1 },
    });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    // 3 × 0,1 = 0,30000000000000004 en IEEE-754.
    expect(r.montoUf).toBe(0.3);
  });

  it('HALF_UP al convertir a CLP y al calcular IVA', () => {
    const r = calcularCobroSuscripcionUf({ ...base, esGeneradorCarga: true, ufValorClp: 10_000.5 });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.subtotalClp).toBe(10_001);
    // 10.001 × 0,19 = 1.900,19 → 1.900.
    expect(r.ivaClp).toBe(1_900);
  });

  it('IVA parametrizado', () => {
    const r = calcularCobroSuscripcionUf({ ...base, esGeneradorCarga: true, ivaRate: 0 });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.ivaClp).toBe(0);
    expect(r.totalClp).toBe(r.subtotalClp);
  });

  it('vence a los 14 días por defecto', () => {
    const r = calcularCobroSuscripcionUf({ ...base, esGeneradorCarga: true });
    if (r.status !== 'facturar') {
      throw new Error('esperaba facturar');
    }
    expect(r.venceEn.getTime()).toBe(HOY + 14 * 86_400_000);
  });
});

describe('calcularCobroSuscripcionUf — entradas inválidas', () => {
  it.each([
    ['ufValorClp 0', { ufValorClp: 0 }],
    ['ufValorClp NaN', { ufValorClp: Number.NaN }],
    ['ivaRate negativo', { ivaRate: -0.1 }],
    ['ivaRate > 1', { ivaRate: 1.5 }],
    ['camiones negativos', { camionesActivos: -1 }],
    ['camiones no enteros', { camionesActivos: 1.5 }],
    ['hoyMs inválido', { hoyMs: 0 }],
    ['precio negativo', { precios: { ...PRECIOS, generadorUfEmpresaMes: -1 } }],
    ['umbral no entero', { precios: { ...PRECIOS, camionesSinCobro: 0.5 } }],
  ])('%s → lanza', (_n, override) => {
    expect(() =>
      calcularCobroSuscripcionUf({ ...base, esGeneradorCarga: true, ...override }),
    ).toThrow(/calcularCobroSuscripcionUf/);
  });
});
