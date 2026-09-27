import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { AVL_ID_CAN } from '../../src/avl-ids/can-lvcan.js';
import { extraerCapacidadesMaximas } from '../../src/avl-ids/equipo-telemetria.js';

describe('extraerCapacidadesMaximas', () => {
  it('el FMC150 declara el techo del catálogo: Codec 8, 4 Dallas y CAN', () => {
    const capacidades = extraerCapacidadesMaximas({
      fabricante: 'Teltonika',
      modelo: 'FMC150',
    });

    expect(capacidades.modelo).toBe('FMC150');
    expect(capacidades.protocolo).toBe('codec8_extended');
    expect(capacidades.gnss).toBe(true);
    expect(capacidades.codec8).toBe(true);
    expect(capacidades.codec8Extended).toBe(true);
    expect(capacidades.dallas).toEqual({ sensores: 4, minC: -55, maxC: 125 });
    expect(capacidades.can?.ids).toEqual(
      expect.arrayContaining([
        AVL_ID_CAN.CAN_VEHICLE_SPEED,
        AVL_ID_CAN.CAN_FUEL_CONSUMED_L,
        AVL_ID_CAN.CAN_FUEL_LEVEL_L,
        AVL_ID_CAN.CAN_ENGINE_RPM,
        AVL_ID_CAN.CAN_TOTAL_MILEAGE,
        AVL_ID_CAN.CAN_FUEL_LEVEL_PCT,
      ]),
    );
    expect(capacidades.puedeCertificacionPrimaria).toBe(true);
    expect(capacidades.eventos.length).toBeGreaterThan(0);
  });

  it('acepta el nombre con espacios o guion', () => {
    const conGuion = extraerCapacidadesMaximas({
      fabricante: 'Teltonika',
      modelo: 'fmc-150',
    });
    const conMarca = extraerCapacidadesMaximas({
      fabricante: 'otro',
      modelo: 'Teltonika FMC150',
    });

    expect(conGuion.modelo).toBe('FMC150');
    expect(conMarca.modelo).toBe('FMC150');
    expect(conMarca.fabricante).toBe('Teltonika');
  });

  it('el GPS del móvil llega a GNSS y no a CAN ni a Dallas', () => {
    const capacidades = extraerCapacidadesMaximas({
      fabricante: 'Booster',
      modelo: 'gps_movil',
      tieneCan: true,
      sensoresDallas: 4,
    });

    expect(capacidades.protocolo).toBe('gps_movil');
    expect(capacidades.gnss).toBe(true);
    expect(capacidades.can).toBeNull();
    expect(capacidades.dallas).toBeNull();
    expect(capacidades.puedeCertificacionPrimaria).toBe(false);
  });

  it('un equipo desconocido queda en el techo de lo que Booster sabe leer', () => {
    const capacidades = extraerCapacidadesMaximas({
      fabricante: 'Otro',
      modelo: 'X100',
      protocolo: 'codec8',
      sensoresDallas: 9,
      tieneCan: true,
      tieneGnss: true,
    });

    expect(capacidades.modelo).toBe('X100');
    expect(capacidades.codec8).toBe(true);
    expect(capacidades.codec8Extended).toBe(false);
    expect(capacidades.dallas?.sensores).toBe(4);
    expect(capacidades.can?.ids).toContain(AVL_ID_CAN.CAN_ENGINE_RPM);
    expect(capacidades.eventos).toEqual([]);
  });

  it('sin CAN declarado no aparece el catálogo LVCAN', () => {
    const capacidades = extraerCapacidadesMaximas({
      fabricante: 'Otro',
      modelo: 'SoloGps',
      protocolo: 'codec8',
      tieneGnss: true,
    });

    expect(capacidades.gnss).toBe(true);
    expect(capacidades.can).toBeNull();
    expect(capacidades.puedeCertificacionPrimaria).toBe(false);
  });

  it('un detalle inválido no arma capacidades', () => {
    expect(() => extraerCapacidadesMaximas({ fabricante: '', modelo: 'FMC150' })).toThrow(ZodError);
  });
});
