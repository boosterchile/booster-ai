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
