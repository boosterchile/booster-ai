import { describe, expect, it } from 'vitest';
import { tarjetaGpsHub } from './tarjeta-gps-hub.js';

const base = {
  conImei: true,
  pendiente: false,
  fetching: false,
  error: false,
  hayCuerpo: false,
};

describe('tarjetaGpsHub', () => {
  it('pendiente sin fetch todavía es carga, no sin datos', () => {
    expect(tarjetaGpsHub({ ...base, pendiente: true, fetching: false })).toBe('cargando');
  });

  it('fetch en curso sin cuerpo es carga', () => {
    expect(tarjetaGpsHub({ ...base, fetching: true })).toBe('cargando');
  });

  it('error ya asentado es error, no sin datos', () => {
    expect(tarjetaGpsHub({ ...base, error: true })).toBe('error');
  });

  it('reintento después de un error vuelve a carga', () => {
    expect(tarjetaGpsHub({ ...base, error: true, fetching: true })).toBe('cargando');
  });

  it('respuesta vacía es sin datos', () => {
    expect(tarjetaGpsHub(base)).toBe('sin_datos');
  });

  it('sin IMEI es sin datos aunque la query figure pendiente', () => {
    expect(tarjetaGpsHub({ ...base, conImei: false, pendiente: true })).toBe('sin_datos');
  });

  it('cuerpo recibido es posición resuelta', () => {
    expect(tarjetaGpsHub({ ...base, hayCuerpo: true })).toBe('resuelta');
  });
});
