import { describe, expect, it } from 'vitest';
import { assertTestDbUrl } from '../helpers/test-db-guard.js';

describe('assertTestDbUrl', () => {
  it.each([
    'postgresql://test:test@localhost:5432/test',
    'postgresql://test:test@127.0.0.1:55433/test_integration',
    'postgresql://test:test@[::1]:5432/testdb',
  ])('acepta %s', (url) => expect(() => assertTestDbUrl(url)).not.toThrow());

  it.each([
    ['host remoto', 'postgresql://u:secreto@db.example.com:5432/test'],
    ['IP privada', 'postgresql://u:secreto@10.0.0.1:5432/testdb'],
    ['socket cloudsql', 'postgresql://u:secreto@localhost/test?host=/cloudsql/proj:region:inst'],
    ['DB sin prefijo test', 'postgresql://u:secreto@127.0.0.1:5432/booster'],
    ['URL inválida', 'no-es-url'],
    ['userinfo con #@', 'postgresql://u:secreto#@evil.com/testdb'],
    ['varios hosts', 'postgresql://u:secreto@localhost,evil.com/testdb'],
    ['path con ../ hacia otra DB', 'postgresql://u:secreto@localhost/test/../prod'],
    ['path con ../ normalizable', 'postgresql://u:secreto@localhost/../test'],
  ])('rechaza %s sin exponer el password', (_caso, url) => {
    expect(() => assertTestDbUrl(url)).toThrow(/Aborto sin conectar/);
    expect(() => assertTestDbUrl(url)).not.toThrow(/secreto/);
  });
});
