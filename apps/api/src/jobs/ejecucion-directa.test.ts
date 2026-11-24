import { describe, expect, it } from 'vitest';
import { esEjecucionDirecta } from './ejecucion-directa.js';

const JOB = 'reap-orphan-onboarding-firebase';

describe('esEjecucionDirecta', () => {
  it('es verdadero cuando el proceso se lanzó ejecutando el archivo del job', () => {
    const ruta = `/repo/apps/api/src/jobs/${JOB}.ts`;
    expect(esEjecucionDirecta(`file://${ruta}`, ruta, JOB)).toBe(true);
  });

  it('es verdadero también con el job compilado a .js', () => {
    const ruta = `/app/dist/jobs/${JOB}.js`;
    expect(esEjecucionDirecta(`file://${ruta}`, ruta, JOB)).toBe(true);
  });

  it('es falso dentro del bundle del api: import.meta.url y argv[1] son main.js', () => {
    const ruta = '/app/dist/main.js';
    expect(esEjecucionDirecta(`file://${ruta}`, ruta, JOB)).toBe(false);
  });

  it('es falso si el archivo ejecutado es otro job', () => {
    const propio = `file:///repo/apps/api/src/jobs/${JOB}.ts`;
    expect(esEjecucionDirecta(propio, '/repo/apps/api/src/jobs/otro-job.ts', JOB)).toBe(false);
  });

  it('es falso sin argv[1]', () => {
    expect(esEjecucionDirecta(`file:///repo/apps/api/src/jobs/${JOB}.ts`, undefined, JOB)).toBe(
      false,
    );
  });

  it('acepta rutas con espacios, que en una URL van codificados', () => {
    const ruta = `/Users/una persona/repo/apps/api/src/jobs/${JOB}.ts`;
    const url = `file:///Users/una%20persona/repo/apps/api/src/jobs/${JOB}.ts`;
    expect(esEjecucionDirecta(url, ruta, JOB)).toBe(true);
  });
});
