/**
 * Invariante de layout del header del PDF: el título (izquierda) nunca debe
 * pisar la marca "Booster Chile SpA" (derecha), para los tres niveles de
 * certificación (ADR-028). El ancho del texto depende del font real, así que
 * se mide con pdf-lib (HelveticaBold), el mismo que usa `generarPdfBase`.
 *
 * Contexto: el título secundario ("REPORTE ESTIMATIVO…") es más largo que el
 * primario y a 16 pt terminaba en x≈426,8 mientras la marca empieza en
 * x=415,28 (A4) → solape de ~11,5 pt en TODO cert secundario — que hoy es el
 * único tipo que prod emite. Con 14 pt termina en x≈378,5.
 *
 * La geometría (x del título, offset y tamaño de la marca, separación mínima)
 * se lee de HEADER_LAYOUT — la misma fuente que usa el renderer — para que el
 * test no pueda drifter respecto del PDF real.
 */

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HEADER_LAYOUT,
  type NivelCertificacion,
  posicionXMarcaHeader,
  tamanoTitulo,
  tituloHeader,
} from '../src/render-helpers.js';

/** Ancho de página A4 en pt — el único formato que produce `generarPdfBase`. */
const A4_WIDTH_PT = 595.28;

const NIVELES: readonly NivelCertificacion[] = [
  'primario_verificable',
  'secundario_modeled',
  'secundario_default',
];

describe('header del PDF — el título no pisa la marca (3 niveles)', () => {
  let anchoTexto: (texto: string, tamano: number) => number;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    anchoTexto = (texto, tamano) => bold.widthOfTextAtSize(texto, tamano);
  });

  it.each(NIVELES)('%s: fin del título + separación mínima ≤ inicio de la marca', (nivel) => {
    const finTitulo = HEADER_LAYOUT.tituloX + anchoTexto(tituloHeader(nivel), tamanoTitulo(nivel));
    const inicioMarca = posicionXMarcaHeader(A4_WIDTH_PT);
    expect(
      finTitulo + HEADER_LAYOUT.separacionMinimaTituloMarca,
      `título "${tituloHeader(nivel)}" @${tamanoTitulo(nivel)}pt termina en x=${finTitulo.toFixed(1)}; la marca empieza en x=${inicioMarca.toFixed(1)}`,
    ).toBeLessThanOrEqual(inicioMarca);
  });

  it('la marca cabe dentro de la página con el mismo margen derecho que el título a la izquierda', () => {
    const finMarca =
      posicionXMarcaHeader(A4_WIDTH_PT) +
      anchoTexto(HEADER_LAYOUT.marcaTexto, HEADER_LAYOUT.marcaTamano);
    expect(finMarca).toBeLessThanOrEqual(A4_WIDTH_PT - HEADER_LAYOUT.tituloX);
  });

  it('la separación mínima exigida es al menos 12 pt (no se puede relajar por accidente)', () => {
    expect(HEADER_LAYOUT.separacionMinimaTituloMarca).toBeGreaterThanOrEqual(12);
  });
});
