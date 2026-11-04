import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Texto extraído del PDF (vía ToUnicode), una entrada por página. */
export async function textoPorPagina(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const contenido = await (await doc.getPage(i)).getTextContent();
    paginas.push(
      contenido.items
        .map((it) => ('str' in it ? `${it.str}${it.hasEOL ? '\n' : ''}` : ''))
        .join('\n'),
    );
  }
  return paginas;
}

/** Normaliza espacios para buscar frases que el PDF partió en varias líneas. */
export const plano = (s: string): string => s.replace(/\s+/g, ' ');

export interface ItemPdf {
  pagina: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cada item de texto con su posición (transform e/f) y su tamaño, en pt PDF. */
export async function itemsPorPagina(bytes: Uint8Array): Promise<ItemPdf[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const items: ItemPdf[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const contenido = await (await doc.getPage(i)).getTextContent();
    for (const it of contenido.items) {
      if ('str' in it && it.str.trim() !== '') {
        items.push({
          pagina: i - 1,
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
          h: it.height,
        });
      }
    }
  }
  return items;
}
