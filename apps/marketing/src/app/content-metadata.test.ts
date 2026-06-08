import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';
import { metadata as esg } from './esg/page.js';
import { metadata as home } from './page.js';
import { metadata as precios } from './precios/page.js';
import { metadata as generadores } from './soluciones/generadores/page.js';
import { metadata as soluciones } from './soluciones/page.js';
import { metadata as stakeholders } from './soluciones/stakeholders-esg/page.js';
import { metadata as transportistas } from './soluciones/transportistas/page.js';

/**
 * SC6 — cada ruta de contenido exporta `metadata` con title + description no
 * vacíos (SEO). Cubre las rutas de conversión de T7.
 */
const ROUTES: Array<[string, Metadata]> = [
  ['/', home],
  ['/soluciones', soluciones],
  ['/soluciones/transportistas', transportistas],
  ['/soluciones/generadores', generadores],
  ['/soluciones/stakeholders-esg', stakeholders],
  ['/precios', precios],
  ['/esg', esg],
];

describe('metadata de rutas de contenido (T7, SC6)', () => {
  it.each(ROUTES)('%s exporta title + description no vacíos', (_route, meta) => {
    expect(typeof meta.title).toBe('string');
    expect((meta.title as string).length).toBeGreaterThan(0);
    expect(typeof meta.description).toBe('string');
    expect((meta.description as string).length).toBeGreaterThan(0);
  });
});
