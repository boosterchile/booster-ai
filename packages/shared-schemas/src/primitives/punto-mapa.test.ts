import { describe, expect, it } from 'vitest';
import { clasificarTextoPunto, tieneComaDecimal } from './punto-mapa.js';

describe('clasificarTextoPunto', () => {
  it('lee coordenadas con coma', () => {
    expect(clasificarTextoPunto('-33.4372, -70.6506')).toEqual({
      tipo: 'punto',
      punto: { latitude: -33.4372, longitude: -70.6506 },
    });
  });

  it('lee lat/lng etiquetados', () => {
    expect(clasificarTextoPunto('lat -33.45 lng -70.66')).toEqual({
      tipo: 'punto',
      punto: { latitude: -33.45, longitude: -70.66 },
    });
  });

  it('rechaza null island y texto de una calle', () => {
    expect(clasificarTextoPunto('0, 0')).toEqual({ tipo: 'texto' });
    expect(clasificarTextoPunto('Compañía 4425')).toEqual({ tipo: 'texto' });
    expect(clasificarTextoPunto('')).toEqual({ tipo: 'texto' });
  });

  it('saca el pin de un link largo de Google Maps', () => {
    const url =
      'https://www.google.com/maps/place/Compa%C3%B1%C3%ADa/@-33.4378,-70.6502,17z/data=!3d-33.4391!4d-70.6488';
    expect(clasificarTextoPunto(url)).toEqual({
      tipo: 'punto',
      punto: { latitude: -33.4391, longitude: -70.6488 },
    });
  });

  it('saca coordenadas de q= y de @', () => {
    expect(clasificarTextoPunto('https://www.google.com/maps?q=-33.45,-70.66')).toEqual({
      tipo: 'punto',
      punto: { latitude: -33.45, longitude: -70.66 },
    });
    expect(clasificarTextoPunto('https://maps.google.com/@-41.47,-72.94,14z')).toEqual({
      tipo: 'punto',
      punto: { latitude: -41.47, longitude: -72.94 },
    });
  });

  it('marca el link corto para resolverlo en el servidor', () => {
    expect(clasificarTextoPunto('https://maps.app.goo.gl/cFmSSGQDfS2tzWex7')).toEqual({
      tipo: 'enlace',
      url: 'https://maps.app.goo.gl/cFmSSGQDfS2tzWex7',
    });
  });

  it('no trata goo.gl genérico como link de Maps', () => {
    expect(clasificarTextoPunto('https://goo.gl/maps/abcDEF123')).toEqual({ tipo: 'texto' });
  });

  it('avisa la coma decimal y no la confunde con el separador del par', () => {
    expect(tieneComaDecimal('-33,45, -70,66')).toBe(true);
    expect(tieneComaDecimal('-33.45, -70.66')).toBe(false);
    expect(tieneComaDecimal('Compañía 4425')).toBe(false);
  });

  it('no trata un https ajeno ni un link con usuario como punto', () => {
    expect(clasificarTextoPunto('https://example.com/maps?q=-33.4,-70.6')).toEqual({
      tipo: 'texto',
    });
    expect(clasificarTextoPunto('https://user:pass@maps.app.goo.gl/abc')).toEqual({
      tipo: 'texto',
    });
  });
});
