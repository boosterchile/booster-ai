import { describe, expect, it } from 'vitest';
import {
  CONECTADO_HASTA_S,
  coincideBusqueda,
  coincideFiltro,
  contarFiltros,
  estadoDispositivo,
  etiquetaDispositivo,
} from './estado-dispositivo.js';

const AHORA = Date.parse('2026-09-23T12:00:00.000Z');

describe('estadoDispositivo', () => {
  it('sin IMEI es sin dispositivo aunque haya un punto fresco', () => {
    expect(
      estadoDispositivo({
        teltonikaImei: null,
        timestampDevice: new Date(AHORA).toISOString(),
        ahoraMs: AHORA,
      }),
    ).toBe('sin_dispositivo');
    expect(
      estadoDispositivo({
        teltonikaImei: '   ',
        timestampDevice: new Date(AHORA).toISOString(),
        ahoraMs: AHORA,
      }),
    ).toBe('sin_dispositivo');
  });

  it('con IMEI y sin punto, o punto inválido, es sin señal', () => {
    expect(
      estadoDispositivo({
        teltonikaImei: '356307042441013',
        timestampDevice: null,
        ahoraMs: AHORA,
      }),
    ).toBe('sin_senal');
    expect(
      estadoDispositivo({
        teltonikaImei: '356307042441013',
        timestampDevice: 'no-es-fecha',
        ahoraMs: AHORA,
      }),
    ).toBe('sin_senal');
  });

  it('conectado solo si el punto tiene menos de 30 minutos', () => {
    const fresco = new Date(AHORA - (CONECTADO_HASTA_S - 1) * 1000).toISOString();
    const justo = new Date(AHORA - CONECTADO_HASTA_S * 1000).toISOString();
    expect(
      estadoDispositivo({
        teltonikaImei: '356307042441013',
        timestampDevice: fresco,
        ahoraMs: AHORA,
      }),
    ).toBe('conectado');
    expect(
      estadoDispositivo({
        teltonikaImei: '356307042441013',
        timestampDevice: justo,
        ahoraMs: AHORA,
      }),
    ).toBe('sin_senal');
  });

  it('las etiquetas no incluyen el IMEI', () => {
    expect(etiquetaDispositivo('sin_dispositivo')).toBe('Sin dispositivo');
    expect(etiquetaDispositivo('conectado')).toBe('Conectado');
    expect(etiquetaDispositivo('sin_senal')).toBe('Sin señal');
  });
});

describe('filtros de la lista', () => {
  const enMantencion = { status: 'mantenimiento' as const, dispositivo: 'sin_senal' as const };
  const pendiente = { status: 'retirado' as const, dispositivo: 'pendiente' as const };
  const items = [
    { status: 'activo' as const, dispositivo: 'sin_dispositivo' as const },
    enMantencion,
    { status: 'activo' as const, dispositivo: 'conectado' as const },
    pendiente,
  ];

  it('cuenta cada chip sobre la flota, sin mezclar pendiente con sin señal', () => {
    expect(contarFiltros(items)).toEqual({
      todos: 4,
      activos: 2,
      mantencion: 1,
      retirados: 1,
      sin_dispositivo: 1,
      sin_senal: 1,
    });
  });

  it('el chip es excluyente y pendiente no entra en sin señal', () => {
    expect(coincideFiltro('mantencion', enMantencion)).toBe(true);
    expect(coincideFiltro('sin_senal', pendiente)).toBe(false);
    expect(coincideFiltro('todos', pendiente)).toBe(true);
  });

  it('la búsqueda ignora separadores de patente', () => {
    expect(coincideBusqueda('ab·cd·12', ['ABCD12', 'Volvo'])).toBe(true);
    expect(coincideBusqueda('volvo fh', ['ABCD12', 'Volvo FH', 'Camión'])).toBe(true);
    expect(coincideBusqueda('   ', ['ABCD12'])).toBe(true);
    expect(coincideBusqueda('zzzz', ['ABCD12', 'Volvo'])).toBe(false);
  });
});
