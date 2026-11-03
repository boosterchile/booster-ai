/**
 * HC-004 / QA #873 — «ojo con los márgenes» (Felipe). Ningún texto ni caja
 * sale del área útil en ninguna página, y los valores largos no pisan la
 * segunda columna. Texto: posiciones de pdfjs (transform x/y + width/height).
 * Cajas (sello, badge, recuadros, reglas): bbox que registra el propio
 * generador (`generarPdfConCajas`). No hay QR en esta plantilla (T4).
 */
import { describe, expect, it } from 'vitest';
import { AREA_UTIL, generarPdfConCajas } from '../src/generar-pdf-base.js';
import { CARGA_EXTREMA, CASOS, DIRECCION_112 } from './casos-pdf.js';
import { suitePdf } from './pdf-suite.js';
import { itemsPorPagina, plano, textoPorPagina } from './texto-pdf.js';

suitePdf();
const TOL = 0.5;

describe.each(Object.keys(CASOS))('márgenes — caso %s', (caso) => {
  it('todo el texto y todas las cajas quedan dentro del área útil, en todas las páginas', async () => {
    const { bytes, cajas } = await generarPdfConCajas(CASOS[caso] as (typeof CASOS)['normal']);
    const items = await itemsPorPagina(bytes);
    expect(items.length).toBeGreaterThan(50);
    for (const it of items) {
      const donde = `p${it.pagina + 1} «${it.str}» x=${it.x.toFixed(1)}..${(it.x + it.w).toFixed(1)} y=${it.y.toFixed(1)}`;
      expect(it.x, donde).toBeGreaterThanOrEqual(AREA_UTIL.x0 - TOL);
      expect(it.x + it.w, donde).toBeLessThanOrEqual(AREA_UTIL.x1 + TOL);
      expect(it.y, donde).toBeGreaterThanOrEqual(AREA_UTIL.y0 - TOL);
      expect(it.y + it.h, donde).toBeLessThanOrEqual(AREA_UTIL.y1 + TOL);
    }
    expect(cajas.length).toBeGreaterThan(3);
    for (const c of cajas) {
      const donde = `caja p${c.pagina + 1} ${JSON.stringify(c)}`;
      expect(c.x, donde).toBeGreaterThanOrEqual(AREA_UTIL.x0 - TOL);
      expect(c.x + c.w, donde).toBeLessThanOrEqual(AREA_UTIL.x1 + TOL);
      expect(c.y, donde).toBeGreaterThanOrEqual(AREA_UTIL.y0 - TOL);
      expect(c.y + c.h, donde).toBeLessThanOrEqual(AREA_UTIL.y1 + TOL);
    }
  });
});

describe('valores largos', () => {
  it('la dirección de 112 caracteres sale completa (sin cortarse en el borde)', async () => {
    const { bytes } = await generarPdfConCajas(CASOS.largo as (typeof CASOS)['normal']);
    const todo = plano((await textoPorPagina(bytes)).join(' '));
    expect(DIRECCION_112).toHaveLength(112);
    expect(todo).toContain(`${DIRECCION_112} (Región XIII)`.split(' ').slice(-4).join(' '));
    for (const palabra of DIRECCION_112.split(' ')) {
      expect(todo).toContain(palabra);
    }
  });

  it.each(Object.keys(CASOS))('caso %s: ningún título de sección queda huérfano', async (caso) => {
    const { bytes } = await generarPdfConCajas(CASOS[caso] as (typeof CASOS)['normal']);
    const items = await itemsPorPagina(bytes);
    for (const [titulo, siguiente] of [
      ['Metodología', 'Estos resultados'],
      ['Trayecto', 'Origen'],
      ['Partes', 'Generador de carga'],
    ] as const) {
      // Items en orden de dibujo: el bloque que sigue al título es el primero tras él.
      const ia = items.findIndex((i) => i.str === titulo);
      const b = items
        .slice(ia + 1)
        .find((i) => i.str === siguiente || i.str.startsWith(`${siguiente} `));
      expect(ia, titulo).toBeGreaterThanOrEqual(0);
      expect(items[ia]?.pagina, `${titulo} y ${siguiente}`).toBe(b?.pagina);
    }
  });

  it('un tipo de carga extremo no pisa la columna «Peso»', async () => {
    const { bytes } = await generarPdfConCajas(CASOS.raro as (typeof CASOS)['normal']);
    const items = await itemsPorPagina(bytes);
    const peso = items.find((i) => i.str === 'Peso');
    expect(peso).toBeDefined();
    const xPeso = peso?.x ?? 0;
    const fila = items.filter(
      (i) =>
        i.pagina === peso?.pagina &&
        i.x < xPeso &&
        i.y < (peso?.y ?? 0) &&
        i.y > (peso?.y ?? 0) - 120,
    );
    expect(fila.length).toBeGreaterThan(1);
    for (const it of fila) {
      expect(it.x + it.w, `«${it.str}»`).toBeLessThanOrEqual(xPeso - 6);
    }
    expect(CARGA_EXTREMA.length).toBeGreaterThan(150);
  });
});
