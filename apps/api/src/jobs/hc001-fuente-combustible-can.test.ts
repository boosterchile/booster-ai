import { describe, expect, it } from 'vitest';
import { destinoDe, formatoDestino } from './hc001-fuente-combustible-can.js';

describe('destinoDe (destino real de pg, sin DB)', () => {
  it.each([
    ['postgresql://u:p%40w@localhost:5436/booster_ai', 'localhost:5436/booster_ai'],
    ['postgresql://u@127.0.0.1/test', '127.0.0.1:5432/test'],
    ['postgresql://u@localhost:55433/%74est', 'localhost:55433/test'],
    [
      'postgresql://u@localhost:5436/booster_ai?host=localhost&port=5436',
      'localhost:5436/booster_ai',
    ],
  ])('%s → %s', (url, esperado) => {
    expect(formatoDestino(destinoDe(url))).toBe(esperado);
  });

  it.each([
    'postgresql:///booster_ai',
    'postgresql://u@localhost:5436/',
    'socket:/var/run/postgresql?db=booster_ai',
    'postgresql://u@localhost/booster_ai?host=10.9.9.9',
    'postgresql://u@localhost/booster_ai?host=/cloudsql/x',
    'postgresql://u@localhost:5432/test?port=5433',
    'postgresql://u@a,b/booster_ai',
  ])('ambiguo: %s → lanza', (url) => {
    expect(() => destinoDe(url)).toThrow();
  });
});
