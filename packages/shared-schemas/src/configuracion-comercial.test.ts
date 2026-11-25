import { describe, expect, it } from 'vitest';
import {
  CLAVES_PRIVADAS_GENERADOR,
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

  it('ADR-094 §2: no hay invariante entre tasas; el PO fija cada una con libertad', () => {
    const ok = (comisiones: Parameters<typeof conComisiones>[0]) =>
      configuracionComercialSchema.safeParse(conComisiones(comisiones)).success;
    expect(ok({ spot_pct: 5, programada_pct: 5 })).toBe(true);
    expect(ok({ spot_pct: 4, programada_pct: 6 })).toBe(true);
    expect(ok({ spot_pct: 18, programada_pct: 10 })).toBe(true);
    expect(ok({ spot_pct: 20, programada_pct: 10, retorno_programada_pct: 25 })).toBe(true);
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

describe('CLAVES_PRIVADAS_GENERADOR (ADR-079 §5, ADR-094 §3)', () => {
  it('veda al transportista el precio del viaje y lo que paga el generador', () => {
    expect(CLAVES_PRIVADAS_GENERADOR).toEqual(
      expect.arrayContaining(['precio_viaje_clp', 'iva_viaje_clp', 'total_generador_clp']),
    );
  });
});
