/**
 * HC-004 — Inter estática (SIL OFL 1.1, assets/fonts/OFL.txt), embebida en
 * subset con @pdf-lib/fontkit (MIT). Cubre ₂ ✓ ± · ≥ — y tildes; reemplaza a
 * Helvetica/WinAnsi, que no podía codificar CO₂e.
 *
 * Se resuelve por nombre de paquete (export `./assets/fonts/*`) para que
 * funcione igual desde src (tests) y desde el bundle de apps/api, donde
 * `pnpm deploy` deja el paquete en node_modules.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

const ARCHIVOS = {
  regular: 'Inter-Regular.ttf',
  semibold: 'Inter-SemiBold.ttf',
  bold: 'Inter-Bold.ttf',
} as const;
type Peso = keyof typeof ARCHIVOS;
export type FuentesCert = Record<Peso, PDFFont>;

const cache = new Map<Peso, Uint8Array>();
const requerir = createRequire(import.meta.url);

function bytesFuente(peso: Peso): Uint8Array {
  let b = cache.get(peso);
  if (!b) {
    b = readFileSync(
      requerir.resolve(`@booster-ai/certificate-generator/assets/fonts/${ARCHIVOS[peso]}`),
    );
    cache.set(peso, b);
  }
  return b;
}

export async function embeberFuentes(doc: PDFDocument): Promise<FuentesCert> {
  doc.registerFontkit(fontkit);
  const [regular, semibold, bold] = await Promise.all(
    (['regular', 'semibold', 'bold'] as const).map((p) =>
      doc.embedFont(bytesFuente(p), { subset: true }),
    ),
  );
  return { regular: regular as PDFFont, semibold: semibold as PDFFont, bold: bold as PDFFont };
}
