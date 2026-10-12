import { describe, expect, it } from 'vitest';
import {
  CONFIGURACION_COMERCIAL_INICIAL,
  configuracionComercialSchema,
  serviciosPublicosSchema,
} from './configuracion-comercial.js';

const conComisiones = (comisiones: Record<string, number>) => ({
  ...CONFIGURACION_COMERCIAL_INICIAL,
  comisiones,
});

describe('configuracionComercialSchema (ADR-079 §3)', () => {
  it('los valores iniciales de ADR-079 son válidos', () => {
    expect(configuracionComercialSchema.parse(CONFIGURACION_COMERCIAL_INICIAL)).toEqual(
      CONFIGURACION_COMERCIAL_INICIAL,
    );
    expect(CONFIGURACION_COMERCIAL_INICIAL.comisiones).toEqual({
      spot_pct: 20,
      programada_pct: 10,
      retorno_programada_pct: 12,
    });
    expect(CONFIGURACION_COMERCIAL_INICIAL.impuestos.iva_pct).toBe(19);
  });

  it('invariante contractual: spot > programada (igual o menor → rechazo)', () => {
    expect(
      configuracionComercialSchema.safeParse(conComisiones({ spot_pct: 10, programada_pct: 10 }))
        .success,
    ).toBe(false);
    expect(
      configuracionComercialSchema.safeParse(conComisiones({ spot_pct: 9, programada_pct: 10 }))
        .success,
    ).toBe(false);
    expect(
      configuracionComercialSchema.safeParse(conComisiones({ spot_pct: 18, programada_pct: 10 }))
        .success,
    ).toBe(true);
  });

  it('el retorno programado queda entre programada y spot', () => {
    const r = (retorno: number) =>
      configuracionComercialSchema.safeParse(
        conComisiones({ spot_pct: 20, programada_pct: 10, retorno_programada_pct: retorno }),
      ).success;
    expect(r(9)).toBe(false);
    expect(r(21)).toBe(false);
    expect(r(10)).toBe(true);
    expect(r(20)).toBe(true);
  });

  it('porcentajes en 0–100 con a lo más dos decimales', () => {
    expect(
      configuracionComercialSchema.safeParse(conComisiones({ spot_pct: 101, programada_pct: 10 }))
        .success,
    ).toBe(false);
    expect(
      configuracionComercialSchema.safeParse(
        conComisiones({ spot_pct: 20.125, programada_pct: 10 }),
      ).success,
    ).toBe(false);
    expect(
      configuracionComercialSchema.safeParse(
        conComisiones({ spot_pct: 19.99, programada_pct: 9.5 }),
      ).success,
    ).toBe(true);
  });

  it('originación en 0,3–0,5 % y precios UF positivos', () => {
    const fin = (originacion_pct: number) =>
      configuracionComercialSchema.safeParse({
        ...CONFIGURACION_COMERCIAL_INICIAL,
        financiamiento: { ...CONFIGURACION_COMERCIAL_INICIAL.financiamiento, originacion_pct },
      }).success;
    expect(fin(0.2)).toBe(false);
    expect(fin(0.6)).toBe(false);
    expect(fin(0.3)).toBe(true);
    expect(
      configuracionComercialSchema.safeParse({
        ...CONFIGURACION_COMERCIAL_INICIAL,
        servicios: {
          ...CONFIGURACION_COMERCIAL_INICIAL.servicios,
          suscripcion_generador_uf_empresa_mes: 0,
        },
      }).success,
    ).toBe(false);
  });

  it('serviciosPublicosSchema no admite claves de comisión (proyección pública, T10-29)', () => {
    expect(serviciosPublicosSchema.parse(CONFIGURACION_COMERCIAL_INICIAL.servicios)).toEqual(
      CONFIGURACION_COMERCIAL_INICIAL.servicios,
    );
    expect(
      serviciosPublicosSchema.safeParse({
        ...CONFIGURACION_COMERCIAL_INICIAL.servicios,
        spot_pct: 20,
      }).success,
    ).toBe(false);
  });
});
