/**
 * HC-004 / QA #873 — «ojo con los márgenes» (Felipe). Ningún texto ni caja
 * sale del área útil ni baja a la zona del pie, en ninguna página.
 *
 * Dos fuentes de verdad, a propósito:
 *  - El registro del generador (`generarPdfConCajas`): cada drawText /
 *    drawRectangle / drawLine / rectRedondeado anota su bbox con los MISMOS
 *    argumentos que recibe pdf-lib (sello, badge, recuadros, reglas, textos).
 *  - pdfjs sobre los bytes (transform x/y + width/height). pdfjs omite el
 *    texto dibujado entero fuera de la hoja, así que además se exige que cada
 *    texto registrado aparezca en el texto extraído de su página.
 * No hay QR en esta plantilla (T4).
 */
import { describe, expect, it } from 'vitest';
import {
  AREA_UTIL,
  type CajaDibujada,
  TOPE_PIE,
  generarPdfConCajas,
} from '../src/generar-pdf-base.js';
import {
  CARGA_EXTREMA,
  CASOS,
  DIRECCION_112,
  DIRECCION_MULTILINEA,
  URL_LARGA,
  casosLlenos,
} from './casos-pdf.js';
import { suitePdf } from './pdf-suite.js';
import { type ItemPdf, itemsPorPagina, plano, textoPorPagina } from './texto-pdf.js';

suitePdf();
const TOL = 0.5;
type Bbox = Pick<CajaDibujada, 'x' | 'y' | 'w' | 'h'>;

function dentro(b: Bbox, donde: string, piso: number): void {
  expect(b.x, donde).toBeGreaterThanOrEqual(AREA_UTIL.x0 - TOL);
  expect(b.x + b.w, donde).toBeLessThanOrEqual(AREA_UTIL.x1 + TOL);
  expect(b.y, donde).toBeGreaterThanOrEqual(piso - TOL);
  expect(b.y + b.h, donde).toBeLessThanOrEqual(AREA_UTIL.y1 + TOL);
}
// Sin espacios ni controles/formatos invisibles (pdfjs no los devuelve).
const sinEspacios = (t: string) => t.replace(/[\s\p{Cc}\p{Cf}]+/gu, '');

async function revisar(params: (typeof CASOS)['normal']): Promise<ItemPdf[]> {
  const { bytes, cajas, textos } = await generarPdfConCajas(params);
  const items = await itemsPorPagina(bytes);
  const paginas = (await textoPorPagina(bytes)).map(sinEspacios);
  expect(cajas.length).toBeGreaterThan(5);
  expect(textos.length).toBeGreaterThan(40);
  for (const c of cajas) {
    dentro(c, `caja p${c.pagina + 1} ${JSON.stringify(c)}`, c.pie ? AREA_UTIL.y0 : TOPE_PIE);
  }
  for (const t of textos) {
    const donde = `texto p${t.pagina + 1} «${t.texto.slice(0, 40)}» ${JSON.stringify({ ...t, texto: undefined })}`;
    dentro(t, donde, t.pie ? AREA_UTIL.y0 : TOPE_PIE);
    expect(t.texto, `${donde}: sin saltos ni tabs`).not.toMatch(/[\n\r\t]/);
    // Punto ciego de pdfjs: texto entero fuera de la hoja no aparece.
    expect(paginas[t.pagina], `${donde}: pdfjs lo ve`).toContain(sinEspacios(t.texto));
  }
  // Conteo: pdfjs ve al menos tantos items no vacíos como drawText con texto.
  expect(items.length).toBeGreaterThanOrEqual(textos.filter((t) => t.texto.trim()).length);
  for (const it of items) {
    dentro(it, `pdfjs p${it.pagina + 1} «${it.str}»`, AREA_UTIL.y0);
  }
  return items;
}

function solapan(a: ItemPdf, b: ItemPdf): boolean {
  return (
    a.pagina === b.pagina &&
    a.x < b.x + b.w - TOL &&
    b.x < a.x + a.w - TOL &&
    a.y < b.y + b.h - TOL &&
    b.y < a.y + a.h - TOL
  );
}

describe.each(Object.keys(CASOS))('márgenes — caso %s', (caso) => {
  it('texto y cajas dentro del área útil y sobre el pie; pdfjs ve todo lo dibujado; nada se monta', async () => {
    const items = await revisar(CASOS[caso] as (typeof CASOS)['normal']);
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i] as ItemPdf;
        const b = items[j] as ItemPdf;
        expect(solapan(a, b), `«${a.str}» se monta con «${b.str}» (p${a.pagina + 1})`).toBe(false);
      }
    }
  });
});

describe('contenido hasta el pie', () => {
  it('con el origen creciendo de a una línea, ningún bloque baja de TOPE_PIE', async () => {
    let minimo = Number.POSITIVE_INFINITY;
    for (const params of casosLlenos()) {
      const { textos, cajas } = await generarPdfConCajas(params);
      for (const b of [...textos, ...cajas].filter((x) => !x.pie)) {
        expect(b.y, JSON.stringify(b)).toBeGreaterThanOrEqual(TOPE_PIE - TOL);
        minimo = Math.min(minimo, b.y);
      }
    }
    // Que algún caso de verdad llegue cerca del pie (si no, el test no prueba
    // nada): con PISO=56 el bloque más bajo queda en y≈82.
    expect(minimo).toBeLessThan(TOPE_PIE + 45);
  });
});

describe('valores largos', () => {
  it('la dirección de 112 caracteres y la URL larga salen completas', async () => {
    const { bytes } = await generarPdfConCajas(CASOS.largo as (typeof CASOS)['normal']);
    const todo = sinEspacios((await textoPorPagina(bytes)).join(''));
    expect(DIRECCION_112).toHaveLength(112);
    expect(todo).toContain(sinEspacios(DIRECCION_112));
    expect(URL_LARGA.length).toBeGreaterThan(200);
    expect(todo).toContain(sinEspacios(URL_LARGA));
  });

  it('los saltos de línea del usuario se aplanan a espacios', async () => {
    const { bytes } = await generarPdfConCajas(CASOS.multilinea as (typeof CASOS)['normal']);
    const todo = plano((await textoPorPagina(bytes)).join(' '));
    expect(todo).toContain(DIRECCION_MULTILINEA.replace(/\s+/g, ' '));
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
});
